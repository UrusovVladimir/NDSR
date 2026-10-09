import axios from 'axios';
import crypto from 'crypto';
import { sessionManager } from './sessionManager.js';



// 🔒 Очередь авторизации per-device. Параллельные authenticate() на одном
// устройстве инвалидируют друг друга: каждый GET /auth выдаёт новый challenge
// и сбрасывает pending-сессию предыдущего потока → оба получают 401.
const authLocks = new Map(); // ip -> Promise последней auth-операции

function withAuthLock(ip, fn) {
  const prev = authLocks.get(ip) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  authLocks.set(ip, next);
  next.finally(() => {
    if (authLocks.get(ip) === next) authLocks.delete(ip);
  }).catch(() => {});
  return next;
}


// 🛡 Защита от блокировки. Keenetic после серии неудачных входов с одного
// адреса перестаёт ему отвечать (запросы висят до тайм-аута) до перезагрузки.
// Бэкенд и браузеры пользователей ходят к устройству через один контейнер —
// блокируется всё сразу. Поэтому:
//   • сбой, при котором пароль не проверялся (сеть, тайм-аут, ndw4 без
//     X-NDM-Data сразу после загрузки), — «транзиентный» (isTransient): перебор
//     паролей на нём останавливается, неверным паролем он не считается;
//   • неверных паролей на устройство — не больше AUTH_MAX_FAILS за
//     AUTH_FAIL_WINDOW_MS, дальше вход не пробуем до конца окна.
// Замер (KN-1012/KN-3812, 5.02, октябрь 2026): бан адреса на 15 минут после
// 5-го неверного входа; успешные входы и 401 на GET /auth не считаются.
// Лимит 5 общий для бэкенда и всех браузеров (один адрес контейнера) —
// бэкенд тратит не больше 2, окно = длительности бана.
const AUTH_MAX_FAILS = Number(process.env.AUTH_MAX_FAILS) || 2;
const AUTH_FAIL_WINDOW_MS = Number(process.env.AUTH_FAIL_WINDOW_MS) || 15 * 60 * 1000;
const authFailures = new Map(); // ip -> [timestamps неверных паролей]

function recentAuthFailures(ip) {
  const since = Date.now() - AUTH_FAIL_WINDOW_MS;
  const list = (authFailures.get(ip) || []).filter(t => t > since);
  if (list.length) authFailures.set(ip, list); else authFailures.delete(ip);
  return list;
}

// Пароль устройства поменяли в портале — прошлые неудачи к нему не относятся
export function clearAuthFailures(deviceUrls = []) {
  const origins = deviceUrls.filter(Boolean).map(u => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean);
  for (const key of authFailures.keys()) {
    try { if (origins.includes(new URL(key).origin)) authFailures.delete(key); } catch {}
  }
}

function transientAuthError(message, cause = null) {
  const err = new Error(message);
  err.isTransient = true;
  if (cause) {
    err.cause = cause;
    err.code = cause.code;   // ECONNREFUSED/ETIMEDOUT — их проверяют вызывающие
  }
  return err;
}

const isAuthenticated = async (ip, sessionCookie = null) => {
  try {
    const headers = {};
    if (sessionCookie) {
      headers['Cookie'] = sessionCookie;
    }

    const response = await axios.get(`${ip}/auth`, {
      headers,
      validateStatus: null,
      timeout: 5000
    });

    return response.status === 200;
  } catch (error) {
    return false;
  }
}

// ============================================================
// x-ndw4-interactive: SCRAM-SHA3-512 + Argon2id (новые прошивки)
// ============================================================
async function ndw4Auth(ip, login, password, sessionCookie) {
  const readData = (r) => {
    const b64 = r.headers['x-ndm-data'];
    if (!b64) throw new Error(`ndw4: нет X-NDM-Data (status ${r.status})`);
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  };

  const post = (obj) => axios.post(`${ip}/auth`, obj, {
    headers: {
      'Cookie': sessionCookie,
      'Content-Type': 'application/json'
    },
    maxRedirects: 0,
    validateStatus: null,
    timeout: 10000
  });

  // ── Фаза 1: запрос challenge ──
  const clientNonce = crypto.randomBytes(16).toString('base64');
  const r1 = await post({ login, nonce: clientNonce });
  // Без X-NDM-Data на фазе 1 пароль ещё не проверялся — так отвечает
  // устройство сразу после загрузки. Не «неверный пароль».
  if (!r1.headers['x-ndm-data']) {
    throw transientAuthError(`ndw4: device not ready (phase 1 status ${r1.status}, no X-NDM-Data)`);
  }
  const d1 = readData(r1);
  if (d1.error || d1.e) throw new Error(`ndw4 phase1: ${d1.error || d1.e}`);
  if (!d1.nonce?.startsWith(clientNonce)) {
    throw new Error('ndw4: nonce mismatch');
  }

  // AuthMessage — raw значения iter/memcost ровно как пришли (могут быть строками)
  const authMessage = `login1=${login},nonce1=${clientNonce};iter2=${d1.iter},memcost2=${d1.memcost},nonce2=${d1.nonce},salt2=${d1.salt};login3=${login},nonce3=${d1.nonce}`;

  // ── Вывод ключей ──
  const { argon2id } = await import('hash-wasm');
  const saltedPassword = await argon2id({
    password,
    salt: Buffer.from(d1.salt, 'base64'),
    iterations: parseInt(d1.iter, 10),
    memorySize: parseInt(d1.memcost, 10),
    parallelism: 1,
    hashLength: 64,
    outputType: 'binary'
  });

  const clientKey = crypto.createHmac('sha3-512', Buffer.from(saltedPassword)).update('NDW4 Interactive Client Key').digest();
  const storedKey = crypto.createHash('sha3-512').update(clientKey).digest();
  const serverKey = crypto.createHmac('sha3-512', Buffer.from(saltedPassword)).update('NDW4 Interactive Server Key').digest();

  const proof = (message) => {
    const mac = crypto.createHmac('sha3-512', storedKey).update(message).digest();
    const xored = Buffer.alloc(clientKey.length);
    for (let i = 0; i < clientKey.length; i++) xored[i] = clientKey[i] ^ mac[i];
    return xored.toString('base64');
  };

  // ── Фаза 2: client proof + верификация сервера (mutual auth) ──
  const r2 = await post({ login, nonce: d1.nonce, proof: proof(authMessage) });
  const d2 = readData(r2);
  if (d2.error || d2.e) {
    // Ошибка на фазе 2 = устройство НЕ подтвердило пароль → неверный пароль
    const err = new Error(`Ошибка авторизации. Статус: ${r2.status}`);
    err.isAuthError = true;   // машиночитаемый признак для isAuthError()
    throw err;
  }

  const expectedSig = crypto.createHmac('sha3-512', serverKey).update(authMessage).digest('base64');
  if (d2.signature !== expectedSig) {
    const err = new Error('ndw4: сервер не подтвердил знание пароля (signature mismatch)');
    err.isAuthError = true;
    throw err;
  }

  // ── Фаза 3: подтверждение ──
  const r3 = await post({
    login,
    nonce: d1.nonce,
    'signature-proof': proof(authMessage + ';signature4=' + d2.signature)
  });
  if (r3.status !== 200) {
    throw new Error(`Ошибка авторизации. Статус: ${r3.status}`);
  }

  // Кука могла ротироваться в ответах фаз — берём последнюю
  return r3.headers['set-cookie']?.[0]?.split(';')[0] || sessionCookie;
}

// ============================================================
// x-ndw2-interactive: классика (старые прошивки)
// ============================================================
async function ndw2Auth(ip, login, password, challengeRes) {
  const realm = challengeRes.headers['x-ndm-realm'];
  const challenge = challengeRes.headers['x-ndm-challenge'];
  const sessionCookie = challengeRes.headers['set-cookie']?.[0]?.split(';')[0];

  if (!sessionCookie || !challenge) {
    throw new Error('Не удалось получить session cookie/challenge');
  }

  const md5Hash = crypto.createHash('md5')
    .update(`${login}:${realm}:${password}`)
    .digest('hex');
  const sha256Hash = crypto.createHash('sha256')
    .update(challenge + md5Hash)
    .digest('hex');

  // ✅ Тело ТОЛЬКО {login, password} — поле cookie в теле запрещено протоколом
  const authRes = await axios.post(`${ip}/auth`, {
    login,
    password: sha256Hash
  }, {
    headers: {
      'Cookie': sessionCookie,
      'Content-Type': 'application/json'
    },
    maxRedirects: 0,
    validateStatus: null,
    timeout: 10000
  });

  if (authRes.status !== 200) {
    const err = new Error(`Ошибка авторизации. Статус: ${authRes.status}`);
    err.isAuthError = true;
    throw err;
  }

  return authRes.headers['set-cookie']?.[0]?.split(';')[0] || sessionCookie;
}

// ============================================================
// _authenticateCore: выбор схемы по WWW-Authenticate
// ============================================================
const _authenticateCore = async (ip, login, password) => {
  try {
    // Может устройство уже авторизовано?
    const alreadyAuthenticated = await isAuthenticated(ip);
    if (alreadyAuthenticated) {
      console.log('✅ Устройство уже авторизовано, сессия не требуется');
      return 'ALREADY_AUTHENTICATED';
    }

    const failures = recentAuthFailures(ip);
    if (failures.length >= AUTH_MAX_FAILS) {
      const waitSec = Math.ceil((failures[0] + AUTH_FAIL_WINDOW_MS - Date.now()) / 1000);
      throw transientAuthError(
        `Login to ${ip} paused for ${waitSec}s: ${failures.length} wrong passwords recently (protects the device from locking out the portal)`);
    }

    // ndw4 сразу после загрузки — одна повторная попытка через паузу
    for (let attempt = 1; ; attempt++) {
      try {
        return await _authenticateOnce(ip, login, password);
      } catch (error) {
        if (error.isTransient && attempt < 2 && String(error.message).startsWith('ndw4: device not ready')) {
          console.log(`⏳ ${error.message} — retrying in 3s`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    if (error.response?.status === 200) {
      // Гонка: между isAuthenticated и challenge-GET устройство «открылось»
      return 'ALREADY_AUTHENTICATED';
    }

    if (error.isAuthError) {
      // Устройство проверило пароль и отвергло его
      const failures = recentAuthFailures(ip);
      failures.push(Date.now());
      authFailures.set(ip, failures);
      console.error(`❌ Ошибка аутентификации: ${error.message} (неверных паролей за окно: ${failures.length}/${AUTH_MAX_FAILS})`);
      return null;
    }

    // Сеть, тайм-аут, устройство не готово, пауза — пароль не проверялся
    console.error('❌ Вход не выполнен (пароль не проверялся):', error.message);
    throw error.isTransient ? error : transientAuthError(`Login to ${ip} failed: ${error.message}`, error);
  }
};

async function _authenticateOnce(ip, login, password) {
  console.log('🔐 Получаем challenge...');

  const challengeRes = await axios.get(`${ip}/auth`, {
    validateStatus: status => status === 401 || status === 200,
    timeout: 10000
  });

  if (challengeRes.status === 200) {
    console.log('✅ Устройство уже авторизовано (получили 200 на challenge)');
    return 'ALREADY_AUTHENTICATED';
  }

  const sessionCookie = challengeRes.headers['set-cookie']?.[0]?.split(';')[0];
  if (!sessionCookie) {
    throw transientAuthError('Не удалось получить session cookie');
  }

  const wa = challengeRes.headers['www-authenticate'] || '';

  // Приоритет ndw4 (по документации Netcraze), fallback ndw2
  let cookie;
  if (wa.includes('x-ndw4-interactive')) {
    console.log('🔐 Схема: x-ndw4-interactive (SCRAM-SHA3-512 + Argon2id)');
    cookie = await ndw4Auth(ip, login, password, sessionCookie);
  } else if (wa.includes('x-ndw2-interactive')) {
    console.log('🔐 Схема: x-ndw2-interactive (классический хэш)');
    cookie = await ndw2Auth(ip, login, password, challengeRes);
  } else {
    throw transientAuthError(`Неизвестная схема авторизации: ${wa}`);
  }

  sessionManager.setSession(ip, login, cookie);
  authFailures.delete(ip);
  console.log('✅ Авторизация успешна!');
  return cookie;
}

// Публичная authenticate — сериализованная через per-device лок
const authenticate = (ip, login, password) =>
  withAuthLock(ip, () => _authenticateCore(ip, login, password));


// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ ДЛЯ ВЫПОЛНЕНИЯ ЗАПРОСОВ С КЭШИРОВАНИЕМ СЕССИЙ
export const makeAuthenticatedRequest = async (ip, login, password, endpoint, method = 'GET', data = null) => {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };

    // ✅ ПЕРВЫЙ ПРИОРИТЕТ: Пробуем использовать кэшированную сессию
    let sessionCookie = sessionManager.getSession(ip, login);
    let useSessionCookie = false;
    
    if (sessionCookie && sessionCookie !== 'ALREADY_AUTHENTICATED') {
      headers['Cookie'] = sessionCookie;
      useSessionCookie = true;
      console.log(`🔐 Используем кэшированную сессию для ${ip}`);
    }

    // Пробуем выполнить запрос
    const config = {
      method: method,
      url: `${ip}${endpoint}`,
      headers: headers,
      timeout: 10000,
      validateStatus: null // Обрабатываем все статусы
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      config.data = data;
    }

    let response;
    try {
      response = await axios(config);
    } catch (requestError) {
      console.log(`⚠️ Ошибка запроса: ${requestError.message}`);
      throw requestError;
    }

    // ✅ ЕСЛИ ЗАПРОС УСПЕШЕН - возвращаем данные
    if (response.status >= 200 && response.status < 300) {
      return response.data;
    }

    // ✅ ЕСЛИ ПОЛУЧИЛИ 401 И ЕСТЬ ПАРОЛЬ - пробуем аутентифицироваться
    if (response.status === 401 && password) {
      console.log(`🔐 Получили 401, пробуем аутентифицироваться...`);
      
      // Очищаем невалидную сессию
      if (sessionCookie) {
        sessionManager.clearSession(ip, login);
      }
      
      // Пробуем аутентифицироваться
      sessionCookie = await authenticate(ip, login, password);
      
      if (sessionCookie === 'ALREADY_AUTHENTICATED') {
        console.log(`🔐 Устройство уже авторизовано, повторяем запрос без сессии`);
        // Повторяем запрос без сессии
        delete headers['Cookie'];
        config.headers = headers;
        
        const retryResponse = await axios(config);
        if (retryResponse.status >= 200 && retryResponse.status < 300) {
          return retryResponse.data;
        }
      } else if (sessionCookie) {
        // Повторяем запрос с новой сессией
        headers['Cookie'] = sessionCookie;
        config.headers = headers;
        
        const retryResponse = await axios(config);
        
        if (retryResponse.status >= 200 && retryResponse.status < 300) {
          return retryResponse.data;
        } else {
          throw new Error(`Запрос не удался после аутентификации: ${retryResponse.status}`);
        }
      } else {
        const err = new Error('Не удалось аутентифицироваться');
        err.isAuthError = true;
        throw err;
      }
    }

    // ✅ ДРУГИЕ ОШИБКИ HTTP
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  } catch (error) {
    console.error(`❌ Ошибка запроса к ${endpoint}:`, error.message);
    throw error;
  }
}

// ✅ ФУНКЦИЯ ДЛЯ ПРОВЕРКИ И ОБНОВЛЕНИЯ СЕССИИ
export const verifyAndRefreshSession = async (ip, login, password) => {
  try {
    const sessionCookie = sessionManager.getSession(ip, login);
    
    // ✅ ЕСЛИ УСТРОЙСТВО УЖЕ АВТОРИЗОВАНО - ВОЗВРАЩАЕМ СПЕЦИАЛЬНЫЙ МАРКЕР
    if (sessionCookie === 'ALREADY_AUTHENTICATED') {
      console.log(`🔐 Устройство уже авторизовано (из кэша)`);
      return 'ALREADY_AUTHENTICATED';
    }
    
    if (!sessionCookie) {
      console.log(`🔐 Сессия не найдена, требуется проверка аутентификации`);
      return await authenticate(ip, login, password);
    }

    // Проверяем валидность сессии
    const isValid = await isAuthenticated(ip, sessionCookie);
    
    if (!isValid) {
      console.log(`🔐 Сессия устарела, обновляем...`);
      sessionManager.clearSession(ip, login);
      return await authenticate(ip, login, password);
    }

    console.log(`🔐 Сессия валидна`);
    return sessionCookie;
  } catch (error) {
    // Пароль не проверялся — не превращаем в «неверный пароль»
    if (error.isTransient) throw error;
    console.error(`❌ Ошибка проверки сессии:`, error.message);
    return null;
  }
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ
async function keeneticAuth(KEENETIC_IP, LOGIN, PASSWORD) {
  console.log("🔐 Начинаем авторизацию на Keenetic...", KEENETIC_IP, LOGIN);
  try {
    // Используем новую систему сессий
    const sessionCookie = await verifyAndRefreshSession(KEENETIC_IP, LOGIN, PASSWORD);
    
    if (!sessionCookie) {
      const err = new Error('Ошибка авторизации');
      err.isAuthError = true;
      throw err;
    }

    const headers = {};
    
    // ✅ ЕСЛИ НУЖНА СЕССИЯ - ДОБАВЛЯЕМ В ЗАГОЛОВКИ
    if (sessionCookie !== 'ALREADY_AUTHENTICATED') {
      headers['Cookie'] = sessionCookie;
    }

    const showVersionResponse = await axios.get(`${KEENETIC_IP}/rci/show/version`, { 
      headers,
      timeout: 10000 
    });

    console.log('✅ Версия прошивки:', showVersionResponse.data.release);
    return showVersionResponse.data;
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    throw error;
  }
}

export {
  keeneticAuth,
  sessionManager
};