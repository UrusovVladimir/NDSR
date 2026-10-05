// socket/handlers/power.js — питание и операции над устройством:
// device:getPowerStatus, device:power, device:reboot,
// device:resetConfig, device:resetDslLine.
//
// Всё, кроме getPowerStatus, требует брони владельцем (S7).
// Ответы в status-форме ({ status: 'ok' | 'error' }), кроме getPowerStatus.
import { on } from '../wrap.js';
import { getDeviceById } from '../../devices.js';
import { devicePowerStatus } from '../../state/power.js';
import { requireBooking, requireLinkAccess, requireNotRival } from '../../services/bookingService.js';
import { getActiveLink } from '../../services/linkService.js';
import {
  getDeviceStatusWithMode,
  checkAndUpdateDeviceStatusImmediately
} from '../../services/statusService.js';
import { sendOperationProgress } from '../../services/progress.js';
import { factoryResetDevice } from '../../services/resetService.js';
import { getPortPowerStatus } from '../../actions/getPortPowerStatus.js';
import { powerSetup } from '../../actions/powerOnOff.js';
import { rebootDevice } from '../../actions/rebootDevice.js';
import { resetDslLine } from '../../../resetDslLine.js';

export function register(socket, io) {
  on(socket, 'device:getPowerStatus', async (deviceId, callback) => {
      try {
          console.log(`🔍 Getting power status for device ${deviceId}`);
          
          const status = await getPortPowerStatus(deviceId);
          devicePowerStatus.set(deviceId, status.power);
          
          // Отправляем статус всем клиентам
          io.emit('device:powerStatus', {
              deviceId: deviceId,
              status: status.power,
              timestamp: Date.now(),
              changed: true
          });
          
          callback({ success: true, status: status.power });
      } catch (error) {
          console.error(`❌ Failed to get power status for ${deviceId}:`, error);
          callback({ success: false, error: error.message });
      }
  });

  // 🔒 B4: guard от вечного интервала при невалидном deviceId — раньше
  // TypeError в catch глотался и clearInterval был недостижим
  function startStatusMonitoring(deviceId, callback, operationType = 'reboot', timeout = 120000) {
    const device = getDeviceById(deviceId);
    if (!device) {
      console.error(`❌ startStatusMonitoring: device ${deviceId} not found`);
      callback({ status: 'error', error: `Device ${deviceId} not found` });
      return;
    }

    const startTime = Date.now();
    
    console.log(`🔍 Starting status monitoring for ${deviceId} after ${operationType}, timeout: ${timeout}ms`);
    
    const checkInterval = setInterval(async () => {
      try {
        const status = await getDeviceStatusWithMode(device.id);
        
        io.emit('device:status', {
          deviceId: deviceId,
          status: status
        });
        
        if (status === 200) {
          clearInterval(checkInterval);
          console.log(`✅ Device ${deviceId} is back online after ${operationType}`);
          callback({ 
            status: 'ok', 
            deviceStatus: 'online',
            operation: operationType,
            timeToOnline: Date.now() - startTime 
          });
        }
        
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          console.log(`❌ Device ${deviceId} did not come online within timeout after ${operationType}`);
          callback({ 
            status: 'ok',
            deviceStatus: 'timeout',
            operation: operationType,
            warning: `Device ${operationType} completed but did not come back online within expected time`
          });
        }
      } catch (error) {
        console.log(`⚠️ Status check error for ${deviceId}:`, error.message);
      }
    }, 5000);
  }

  // checkAccess бросает, если операцию делать нельзя (по умолчанию — бронь)
  function setupDeviceOperation(socketEvent, operationType, operationFunction, timeout = 120000,
                                checkAccess = (deviceId) => requireBooking(socket, deviceId)) {
    return (deviceId, callback) => {
      // 🔒 S7: reboot/resetConfig требуют брони, сделанной владельцем
      try {
        checkAccess(deviceId);
        requireNotRival(deviceId);
      } catch (err) {
        return callback({ status: 'error', error: err.message });
      }

      let progress = 0;
      
      sendOperationProgress(io, deviceId, 0, operationType);
      
      const progressInterval = setInterval(() => {
        progress = Math.min(progress + 10, 90);
        sendOperationProgress(io, deviceId, progress, operationType);
      }, 2000);
      
      operationFunction(deviceId)
        .then(() => {
          clearInterval(progressInterval);
          sendOperationProgress(io, deviceId, 100, operationType);
          startStatusMonitoring(deviceId, callback, operationType, timeout);
        })
        .catch(err => {
          clearInterval(progressInterval);
          sendOperationProgress(io, deviceId, 0, operationType);
          callback({ status: 'error', error: err.message });
        });
    };
  }

  on(socket, 'device:reboot', setupDeviceOperation('device:reboot', 'rebooting', rebootDevice, 120000), { errorShape: 'status' });

  on(socket, 'device:power', async (data, callback) => {
    const { deviceId, action } = data || {};
    
    try {
      console.log(`[POWER] Request received: ${action} for device ${deviceId}`);

      // 🔒 S7: проверяем бронь И владельца. Раньше проверялся только факт брони —
      // любой пользователь мог выключить питание устройства, забронированного другим
      requireBooking(socket, deviceId);
      requireNotRival(deviceId);

      const previousStatus = devicePowerStatus.get(deviceId);
      await powerSetup(deviceId, action);
      
      // ✅ ПОЛУЧАЕМ АКТУАЛЬНЫЙ СТАТУС ПОСЛЕ ОПЕРАЦИИ
      let newStatus = action;
      try {
        const actualStatus = await getPortPowerStatus(deviceId);
        if (actualStatus.power) {
          newStatus = actualStatus.power;
        }
      } catch (error) {
        console.error(`[POWER] Failed to verify power status:`, error.message);
      }
      
      devicePowerStatus.set(deviceId, newStatus);
      io.emit('device:powerStatus', {
        deviceId: deviceId,
        status: newStatus,
        timestamp: Date.now(),
        changed: previousStatus !== newStatus
      });
      console.log(`[POWER] Status updated for ${deviceId}: ${previousStatus || 'unknown'} -> ${newStatus}`);
      
      callback({ 
        status: 'ok', 
        message: `Device powered ${action} successfully`,
        powerStatus: newStatus
      });
      
      setTimeout(() => {
        checkAndUpdateDeviceStatusImmediately(io, deviceId);
      }, 5000);
      
    } catch (error) {
      console.error(`[POWER] Error:`, error);
      callback({ 
        status: 'error', 
        error: error.message 
      });
    }
  }, { errorShape: 'status' });

  on(socket, 'device:resetConfig', setupDeviceOperation('device:resetConfig','resetting',
      async (deviceId) => {
        // MWS-связка → WAN off → сброс → чистка пароля/режима/кэша (resetService)
        await factoryResetDevice(io, deviceId);
      },
      180000,
      // подключённый экстендер отвязывается — роутер свободен или в своей брони
      (deviceId) => {
        const routerId = getActiveLink(deviceId)?.routerId;
        requireLinkAccess(socket, deviceId, routerId ? String(routerId) : null, { disconnect: true });
      }
    ), { errorShape: 'status' });

  on(socket, 'device:resetDslLine', (deviceId, callback) => {
    // 🔒 S7: сброс DSL-линии требует брони владельцем
    try {
      requireBooking(socket, deviceId);
      requireNotRival(deviceId);
    } catch (err) {
      return callback({ status: 'error', error: err.message });
    }

    let progress = 0;
    
    sendOperationProgress(io, deviceId, 0, 'resettingDsl');
    
    const progressInterval = setInterval(() => {
      progress = Math.min(progress + 20, 90);
      sendOperationProgress(io, deviceId, progress, 'resettingDsl');
    }, 1000);
    
    resetDslLine(deviceId)
      .then(() => {
        clearInterval(progressInterval);
        sendOperationProgress(io, deviceId, 100, 'resettingDsl');
        
        setTimeout(() => {
          callback({ status: 'ok' });
        }, 500);
      })
      .catch(err => {
        clearInterval(progressInterval);
        sendOperationProgress(io, deviceId, 0, 'resettingDsl');
        callback({ status: 'error', error: err.message });
      });
  }, { errorShape: 'status' });
}
