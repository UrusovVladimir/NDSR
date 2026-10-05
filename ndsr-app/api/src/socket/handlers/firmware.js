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
  tryWithPasswords
} from '../../services/passwordService.js';
import {
  getDeviceUrl,
  getDeviceStatusWithMode,
  executeWithLimit,
  clearFirmwareCache
} from '../../services/statusService.js';
import { keeneticAuth } from '../../actions/athentication.js';

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
      executeWithLimit(async () => {
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
          const candidates = getPasswordCandidates(deviceId, userId, passwords, 'background');

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
      })
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

      const device = getDeviceById(deviceId);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      const deviceStatus = await getDeviceStatusWithMode(deviceId);
      if (deviceStatus !== 200) {
        throw new Error('Device is offline');
      }

      // 🔑 Цепочка кандидатов: явный пароль + сохранённые
      const authUrl = getDeviceUrl(deviceId, 'auth');
      const explicit = password ? { [deviceId]: password } : {};
      const candidates = getPasswordCandidates(deviceId, socket.clientIp, explicit);

      if (candidates.length === 0) {
        throw new Error('No password available');
      }

      const { result: versionData } = await tryWithPasswords(
        candidates,
        (candidate) => keeneticAuth(authUrl, login || 'admin', candidate)
      );

      if (!versionData) {
        // слово 'Authentication failed' попадёт в вашу таксономию ошибок ниже → auth_error
        throw new Error('Authentication failed - no password candidate worked');
      }

      if (!versionData.release) {
        throw new Error('Invalid firmware version response');
      }

      const firmwareVersion = versionData.release;
      
      currentFirmwareVersion.set(deviceId, {
        version: firmwareVersion,
        timestamp: Date.now()
      });

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
