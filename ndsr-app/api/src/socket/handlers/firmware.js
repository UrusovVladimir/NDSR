// socket/handlers/firmware.js — версии прошивки:
// device:checkMultipleFirmwares, device:getCurrentFW, device:clearFirmwareCache.
//
// Брони не требуют. Кэш версий — state/firmware.js (5 минут для getCurrentFW).
import { on } from '../wrap.js';
import { isRival } from '../../utils/deviceFlags.js';
import { getDeviceById } from '../../devices.js';
import { currentFirmwareVersion } from '../../state/firmware.js';
import {
  isAuthCoolingDown,
  setAuthCooldown,
  clearAuthCooldown,
  getPasswordCandidates,
  getEffectiveDevicePassword,
  tryWithPasswords
} from '../../services/passwordService.js';
import {
  getDeviceUrl,
  getDeviceStatusWithMode,
  executeWithLimit,
  clearFirmwareCache
} from '../../services/statusService.js';
import { keeneticAuth } from '../../actions/athentication.js';

// Одна проверка на устройство. Событие «устройство снова в сети»
// (device:checkFirmware) уходит во ВСЕ вкладки, и каждая присылает свою
// проверку — раньше это давало N одновременных входов на только что
// загрузившийся роутер; пара неудач подряд — и Keenetic блокирует адрес
// портала до перезагрузки. Теперь параллельные запросы получают общий
// результат, а свежий (FIRMWARE_FRESH_MS) отдаётся без входа.
const FIRMWARE_FRESH_MS = 30 * 1000;
const inflightFirmwareChecks = new Map(); // deviceId -> Promise<result>

function checkFirmwareOnce(deviceId, run) {
  const cached = currentFirmwareVersion.get(deviceId);
  if (cached?.version && Date.now() - cached.timestamp < FIRMWARE_FRESH_MS) {
    return Promise.resolve({ deviceId, success: true, version: cached.version });
  }
  const pending = inflightFirmwareChecks.get(deviceId);
  if (pending) return pending;
  const promise = run().finally(() => inflightFirmwareChecks.delete(deviceId));
  inflightFirmwareChecks.set(deviceId, promise);
  return promise;
}

// Проверка версии одного устройства — общая для device:checkMultipleFirmwares
// и device:getCurrentFW (через checkFirmwareOnce: одна на устройство).
// Пароль, присланный браузером, используется, только если у бэкенда нет
// своего: копия в браузере бывает устаревшей, а каждый неверный пароль
// тратит общий лимит Keenetic (5 → бан адреса портала на 15 минут).
async function checkOneFirmware(deviceId, userId, passwords) {
  try {
    const device = getDeviceById(deviceId);

    if (!device) {
      return {
        deviceId,
        success: false,
        error: 'Device not found'
      };
    }

    // Конкурент: версию не определяем (авторизация Keenetic не подходит)
    if (isRival(device)) {
      return {
        deviceId,
        success: false,
        error: 'N/A for rival devices'
      };
    }

    const deviceStatus = await getDeviceStatusWithMode(deviceId);
    if (deviceStatus !== 200) {
      return {
        deviceId,
        success: false,
        error: 'Device is offline'
      };
    }

    // 🛡cooldown после полного провала авторизации —
    // не долбим устройство ndw4-хендшейками
    if (isAuthCoolingDown(deviceId)) {
      return {
        deviceId,
        success: false,
        error: 'Auth cooldown — retry later'
      };
    }

    // 🔑 Перебор кандидатов: устройство может иметь индивидуальный пароль,
    // отличный от daily. Первая успешная авторизация побеждает.
    const authUrl = getDeviceUrl(deviceId, 'auth');
    const explicit = getEffectiveDevicePassword(deviceId) ? {} : passwords;
    const candidates = getPasswordCandidates(deviceId, userId, explicit, 'background');

    if (candidates.length === 0) {
      return {
        deviceId,
        success: false,
        error: 'No password available'
      };
    }

    // 🔒 S5: в лог только источники, не сами пароли
    if (process.env.DEBUG_PASSWORDS === 'true') {
      console.log(`🔑 Password candidates for ${deviceId}:`, candidates.map(c => c.source));
    }

    // сеть/таймаут tryWithPasswords пробрасывает — это не пароль
    const { result: versionData, source: usedSource, lastError } = await tryWithPasswords(
      candidates,
      (password) => keeneticAuth(authUrl, 'admin', password)
    );

    if (!versionData) {
      // 🛡 все кандидаты отвергнуты — включаем cooldown для этого устройства
      setAuthCooldown(deviceId);
      return {
        deviceId,
        success: false,
        error: `Authentication failed: ${lastError?.message || 'no password candidate worked'}`
      };
    }

    // 🛡 успех — сбрасываем cooldown, если был
    clearAuthCooldown(deviceId);

    if (!versionData.release) {
      return {
        deviceId,
        success: false,
        error: 'Invalid firmware response'
      };
    }

    console.log(`🔑 Auth success for ${deviceId} (source: ${usedSource})`);

    const firmwareVersion = versionData.release;

    currentFirmwareVersion.set(deviceId, {
      version: firmwareVersion,
      timestamp: Date.now()
    });

    return {
      deviceId,
      success: true,
      version: firmwareVersion
    };

  } catch (error) {
    console.error(`Error checking firmware for device ${deviceId}:`, error);
    return {
      deviceId,
      success: false,
      error: error.message
    };
  }
}

const handleBatchFirmwareCheck = async (socket, io, data, callback) => {
  try {
    const { deviceIds, passwords = {} } = data;
    const userId = socket.clientIp;

    console.log(`🔄 Batch firmware check for ${deviceIds.length} devices by user ${userId}`);

    const checkPromises = deviceIds.map(deviceId =>
      // 🔧 B13: каждая проверка через глобальный ограничитель нагрузки
      // (макс. 15 параллельных, общий семафор с проверками статусов).
      // Раньше map запускал ВСЕ auth-секвенции одновременно:
      // выбор 30 устройств = 30 одновременных ndw4-хендшейков = шторм на железках
      checkFirmwareOnce(deviceId, () => executeWithLimit(() => checkOneFirmware(deviceId, userId, passwords)))
    );

    const results = await Promise.allSettled(checkPromises);

    const successfulChecks = [];
    const failedChecks = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { value } = result;
        if (value.success) {
          successfulChecks.push({
            deviceId: value.deviceId,
            version: value.version
          });
        } else {
          failedChecks.push({
            deviceId: value.deviceId,
            error: value.error
          });
        }
      } else {
        failedChecks.push({
          deviceId: deviceIds[index],
          error: result.reason?.message || 'Unknown error'
        });
      }
    });

    console.log(`✅ Batch firmware check completed: ${successfulChecks.length} successful, ${failedChecks.length} failed`);

    if (successfulChecks.length > 0) {
      // 🔧 R2: io.emit = socket.emit + broadcast.emit одним вызовом
      io.emit('device:batchFirmwareUpdated', {
        action: 'check',
        userId: userId,
        successful: successfulChecks,
        failed: failedChecks,
        timestamp: new Date().toISOString()
      });
    }

    callback({
      success: true,
      checked: successfulChecks.length,
      failed: failedChecks.length,
      details: {
        successful: successfulChecks,
        failed: failedChecks
      }
    });

  } catch (error) {
    console.error('❌ Batch firmware check error:', error);
    callback({
      success: false,
      message: 'Batch firmware check failed',
      error: error.message
    });
  }
};

export function register(socket, io) {
  on(socket, 'device:checkMultipleFirmwares', (data, callback) => {
    return handleBatchFirmwareCheck(socket, io, data, callback);
  });

  on(socket, 'device:getCurrentFW', async ({ deviceId, login, password }, callback) => {
    if (isRival(getDeviceById(deviceId))) {
      return callback({ success: false, errorType: 'not_supported', error: 'N/A for rival devices' });
    }
    const cached = currentFirmwareVersion.get(deviceId);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return callback({ 
        success: true, 
        sessionCookie: { release: cached.version }
      });
    }

    const timeout = setTimeout(() => {
      callback({ success: false, error: 'Timeout' });
    }, 30000);

    try {
      if (!deviceId || !password) {
        throw new Error('Device ID and password are required');
      }

      const check = await checkFirmwareOnce(deviceId, () =>
        executeWithLimit(() => checkOneFirmware(deviceId, socket.clientIp, { [deviceId]: password })));
      if (!check.success) {
        throw new Error(check.error || 'Failed to get firmware version');
      }
      const versionData = { release: check.version };

      const firmwareVersion = versionData.release;
      
      io.emit('device:currentFW', deviceId, { 
        FW: { release: firmwareVersion } 
      });

      clearTimeout(timeout);
      callback({ 
        success: true, 
        sessionCookie: { release: firmwareVersion }
      });

    } catch (error) {
      clearTimeout(timeout);
      
      let errorMessage = error.message;
      let errorType = 'unknown';
      
      const errorLower = error.message.toLowerCase();
      
      if (errorLower.includes('authentication failed') || 
          errorLower.includes('401') || 
          errorLower.includes('wrong password') ||
          errorLower.includes('ошибка авторизации') ||
          errorLower.includes('неверный пароль') ||
          errorLower.includes('авторизация')) {
        errorMessage = 'Authentication failed - incorrect password';
        errorType = 'auth_error';
      } else if (errorLower.includes('timeout') || errorLower.includes('etimeout')) {
        errorMessage = 'Device timeout - may be slow or unresponsive';
        errorType = 'timeout';
      } else if (errorLower.includes('enotfound') || errorLower.includes('econnrefused')) {
        errorMessage = 'Cannot connect to device';
        errorType = 'connection_error';
      } else if (errorLower.includes('invalid firmware version response')) {
        errorMessage = 'Device returned invalid response format';
        errorType = 'invalid_response';
      } else if (errorLower.includes('device is offline')) {
        errorMessage = 'Device is offline';
        errorType = 'offline';
      }

      callback({ 
        success: false, 
        error: errorMessage,
        errorType: errorType,
        deviceId: deviceId
      });
    }
  });

  on(socket, 'device:clearFirmwareCache', (deviceId, callback) => {
    clearFirmwareCache(deviceId);
    callback({ success: true });
  });
}
