// services/passwordService.js — разрешение паролей устройства, daily-пароли,
// auth-cooldown и единый перебор кандидатов (tryWithPasswords).
import { getDeviceById, getParamRouter } from '../devices.js';
import { generatePassword } from '../actions/generatePassword.js';
import { makeAuthenticatedRequest } from '../actions/athentication.js';
import { currentModes } from '../state/modes.js';
import { deviceBookings } from '../state/bookings.js';
import { dailyPasswords } from '../state/passwords.js';
import { getIO } from '../state/io.js';

const authFailCooldown = new Map();
const AUTH_COOLDOWN_MS = 60 * 1000;
const isAuthCoolingDown = (deviceId) => Date.now() < (authFailCooldown.get(deviceId) || 0);
const setAuthCooldown = (deviceId) => authFailCooldown.set(deviceId, Date.now() + AUTH_COOLDOWN_MS);
const clearAuthCooldown = (deviceId) => authFailCooldown.delete(deviceId);

// 🔑 Синхронизация пароля устройства на фронте: при clear/setPassword
// фронт обязан обновить device.devicePassword немедленно, без F5
function emitPasswordUpdate(deviceId, password) {
  getIO()?.emit('device:passwordUpdated', { deviceId, password: password || null });
}

// 🔑 MWS-PW: у экстендера в extender_connect админ-пароль = пароль роутера
// (Keenetic-adoption синхронизирует креды мастера в слейв). Собственный
// devicePassword слейва после adoption НЕВАЛИДЕН. Единая точка разрешения.
function getEffectiveDevicePassword(deviceId) {
    const modeInfo = currentModes.get(deviceId);
    if (modeInfo?.mode === 'extender_connect' && modeInfo.routerId) {
        const router = getDeviceById(modeInfo.routerId);
        return router?.devicePassword || null;
    }
    return getDeviceById(deviceId)?.devicePassword || null;
}

function getPasswordCandidates(deviceId, userId, explicitPasswords = {}, order = 'interactive') {
  // 🔧 B25: первый цикл сборки был мёртвым (его candidates не возвращался)
  const isRouterPassword = (pw) => {
    const modeInfo = currentModes.get(deviceId);
    return modeInfo?.mode === 'extender_connect' && modeInfo.routerId
      && getDeviceById(modeInfo.routerId)?.devicePassword === pw;
  };

  const interactive = [
    () => explicitPasswords[deviceId],                    // 1. явный пароль от клиента
    () => getEffectiveDevicePassword(deviceId),           // 2. конфиг (MWS-PW: может быть пароль роутера)
    () => {
      const booking = deviceBookings.get(deviceId);
      return (booking && booking.bookedBy === userId) ? booking.accessPassword : null;
    },                                                    // 3. пароль брони
    () => dailyPasswords.today.value,                     // 4. daily сегодня
    () => dailyPasswords.yesterday.value                  // 5. daily вчера
  ];

  const background = [
    () => getEffectiveDevicePassword(deviceId),           // 1. конфиг — источник правды (MWS-PW aware)
    () => explicitPasswords[deviceId],                    // 2. явный (если есть)
    () => {
      const booking = deviceBookings.get(deviceId);
      return (booking && booking.bookedBy === userId) ? booking.accessPassword : null;
    },                                                    // 3. бронь
    () => dailyPasswords.today.value,                     // 4. daily сегодня
    () => dailyPasswords.yesterday.value                  // 5. daily вчера
  ];

  const sources = (order === 'background' ? background : interactive);
  const names = order === 'background'
    ? ['device_config', 'params', 'booking', 'daily_today', 'daily_yesterday']
    : ['params', 'device_config', 'booking', 'daily_today', 'daily_yesterday'];

  const result = [];
  sources.forEach((get, i) => {
    const password = get();
    if (password && !result.some(c => c.password === password)) {
      // 🔑 MWS-PW: диагностика — если «конфиг» это на самом деле пароль роутера
      const source = (names[i] === 'device_config' && isRouterPassword(password))
        ? 'mws_router'
        : names[i];
      result.push({ password, source });
    }
  });
  return result;
}

// keeneticAuth/checkDeviceMode не отдают машиночитаемый код ошибки —
// только текст. Распознаём auth-ошибку по сообщению.
// TODO этап 3: прокинуть statusCode из athentication.js
function isAuthError(error) {
  // Явные признаки из athentication.js важнее текста: транзиентный сбой
  // (пароль не проверялся / пауза против блокировки) — НЕ повод пробовать
  // следующий пароль, иначе устройство заблокирует адрес портала
  if (error?.isTransient) return false;
  if (error?.isAuthError) return true;
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('401')
      || msg.includes('авторизац')
      || msg.includes('аутентифиц')
      || msg.includes('auth');
}

// 🔑 Единый перебор кандидатов: первая успешная попытка побеждает.
// attempt(password, source) бросает при неудаче; auth-ошибка -> следующий
// кандидат, любая другая пробрасывается (сеть/таймаут — перебор бессмыслен).
// result === null — все кандидаты отвергнуты (lastError — последняя auth-ошибка).
async function tryWithPasswords(candidates, attempt) {
  let lastError = null;
  for (const { password, source } of candidates) {
    try {
      const result = await attempt(password, source);
      return { result, password, source, lastError };
    } catch (e) {
      lastError = e;
      if (!isAuthError(e)) throw e;
      console.log(`🔑 Candidate rejected (source: ${source}), trying next`);
    }
  }
  return { result: null, password: null, source: null, lastError };
}

// 🔑 MWS: пароль роутера для подключения экстендера. Источник — только сам
// роутер (его кандидаты: конфиг → бронь пользователя → daily) либо пароль,
// введённый вручную; пароль экстендера сюда не подставляется. Проверяем на
// роутере ДО операции: неверный пароль раньше всплывал посреди MWS-подключения,
// когда коммутатор уже перенастроен. Сеть/таймаут — пробрасываются как есть.
async function resolveRouterPassword(routerId, userId, manualPassword = null) {
  const router = getParamRouter(routerId);
  if (!router?.URL) {
    throw new Error(`Router ${routerId}: URL is not configured`);
  }

  const candidates = manualPassword
    ? [{ password: manualPassword, source: 'manual' }]
    : getPasswordCandidates(routerId, userId);
  if (candidates.length === 0) {
    throw new Error('Router password is unknown — enter it manually');
  }

  const { result, password, source } = await tryWithPasswords(candidates, async (candidate) => {
    await makeAuthenticatedRequest(router.URL, 'admin', candidate, '/rci/show/version', 'GET');
    return true;
  });
  if (!result) {
    throw new Error(manualPassword
      ? 'Router password is incorrect'
      : 'Router password from the router config/booking did not work — enter it manually');
  }

  console.log(`🔑 MWS router ${routerId} password confirmed (source: ${source})`);
  return password;
}

function updateDailyPasswords() {
  const today = new Date().toDateString();
  
  if (dailyPasswords.today.date !== today) {
    dailyPasswords.yesterday = {
      value: dailyPasswords.today.value,
      date: dailyPasswords.today.date
    };
    
    dailyPasswords.today = {
      value: generatePassword(),
      date: today
    };
    
    getIO()?.emit('DAILY_PASSWORDS', dailyPasswords);
  }
}

export {
  isAuthCoolingDown,
  setAuthCooldown,
  clearAuthCooldown,
  emitPasswordUpdate,
  getEffectiveDevicePassword,
  getPasswordCandidates,
  isAuthError,
  tryWithPasswords,
  resolveRouterPassword,
  updateDailyPasswords
};
