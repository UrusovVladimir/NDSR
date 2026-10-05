// socket/handlers/admin.js — служебные операции: device:getInitData, cron:*,
// device:reloadConfigs, device:add/remove, user:*.
import { on } from '../wrap.js';
import {
  devices,
  wanTypes,
  users,
  reloadConfigs,
  getUserByIp,
  addUser,
  removeUser,
  updateUserName,
  removeDevice,
  addDevice,
  reloadUsersConfig
} from '../../devices.js';
import { getPortPowerStatus } from '../../actions/getPortPowerStatus.js';
import { currentModes } from '../../state/modes.js';
import { deviceBookings, saveBookings } from '../../state/bookings.js';
import { currentWanTypes } from '../../state/wan.js';
import { getCronStatus, setCronEnabled } from '../../state/runtime.js';
import { devicePowerStatus } from '../../state/power.js';
import { currentFirmwareVersion } from '../../state/firmware.js';
import { consoleUrlCache } from '../../state/consoleUrlCache.js';
import { deviceStatusCache, invalidateStatusCache, markStatusCacheFresh } from '../../state/statusCache.js';
import { buildBookingPayload } from '../../services/bookingService.js';
import { initializeStatusCache, getAllDevicesStatus } from '../../services/statusService.js';
import { sendInitData, syncMwsStatusesToClient } from '../../services/initData.js';

// device:list целиком заменяет список на клиенте (setDevices), поэтому
// без booking/powerStatus после add/remove пропадали все брони в таблице.
const buildDeviceListPayload = () => devices.map(device => ({
  ...device,
  powerStatus: devicePowerStatus.get(device.id) || 'unknown',
  booking: buildBookingPayload(device.id)
}));

export function register(socket, io) {
  on(socket, 'device:getInitData', (callback) => {
    console.log('📡 Client requested init data')
    sendInitData(socket).then(() => {
      callback({ success: true })
    }).catch(error => {
      callback({ success: false, error: error.message })
    })
  })

  on(socket, 'cron:toggle', (newStatus, callback) => {
    console.log("Статус крона:",newStatus)
    if (typeof newStatus !== 'boolean') {
      if (callback.provided) {
        callback({ success: false, error: 'Invalid status type' });
      } else {
        socket.emit('cron:error', { message: 'Invalid status type' });
      }
      return;
    }
    
    setCronEnabled(newStatus);
    
    callback({ success: true, status: getCronStatus() });
    
    io.emit('cron:status', getCronStatus());
  });

  on(socket, 'cron:get-status', (callback) => {
    if (callback.provided) {
      callback(getCronStatus());
    } else {
      socket.emit('cron:status', getCronStatus());
    }
  });

  on(socket, 'device:reloadConfigs', async (callback) => {
    try {
      console.log('🔄 Starting full config reload...');
      
      // 1. Вызываем reloadConfigs из devices.js
      const result = reloadConfigs();
      
      if (!result.success) {
        throw new Error('Config reload failed');
      }
      
      // 2. Получаем актуальные ID устройств после перезагрузки
      const currentDeviceIds = new Set(devices.map(d => String(d.id)));
      
      // 3. Очищаем ВСЕ кэши и состояния, которые зависят от конфигурации
      const cachesToClean = [
        { name: 'deviceStatusCache', cache: deviceStatusCache },
        { name: 'devicePowerStatus', cache: devicePowerStatus },
        { name: 'currentModes', cache: currentModes },
        { name: 'deviceBookings', cache: deviceBookings },
        { name: 'consoleUrlCache', cache: consoleUrlCache },
        { name: 'currentFirmwareVersion', cache: currentFirmwareVersion },
        { name: 'currentWanTypes', cache: currentWanTypes }
      ];
      
      cachesToClean.forEach(({ name, cache }) => {
        let cleanedCount = 0;
        if (cache instanceof Map) {
          for (const [key] of cache) {
            if (!currentDeviceIds.has(String(key))) {
              cache.delete(key);
              cleanedCount++;
            }
          }
        } else if (typeof cache === 'object' && cache !== null) {
          // Для объектов типа currentWanTypes
          Object.keys(cache).forEach(key => {
            if (!currentDeviceIds.has(String(key))) {
              delete cache[key];
              cleanedCount++;
            }
          });
        }
        console.log(`🧹 Cleaned ${cleanedCount} entries from ${name}`);
      });
      // чистка могла удалить брони несуществующих устройств
      saveBookings();
      // 4. Сбрасываем флаги инициализации
      invalidateStatusCache();
      
      // 5. Отправляем обновленный список устройств ВСЕМ клиентам
      // 🔧 H: booking через единый хелпер buildBookingPayload
      io.emit('device:list', buildDeviceListPayload());
      
      // Отправляем обновленных пользователей
      io.emit('device:users', users);
      
      // Отправляем актуальные WAN типы
      io.emit('device:wanTypes', wanTypes);
      
      // Отправляем обновленные бронирования
      io.emit('device:bookings-list', Object.fromEntries(deviceBookings));
      
      console.log(`✅ Configs reloaded. Devices: ${devices.length}, Users: ${users.length}`);
      
      // 6. Отправляем ответ клиенту
      callback({ 
        success: true, 
        devicesCount: devices.length,
        usersCount: users.length,
        message: 'Configuration reloaded successfully'
      });
      
      // 7. Асинхронно переинициализируем статусы
      setTimeout(async () => {
        try {
          console.log('🔄 Starting background reinitialization after config reload...');
          
          // Переинициализируем кэш статусов
          initializeStatusCache();
          
          // Запускаем полную проверку статусов
          const statuses = await getAllDevicesStatus();
          
          // Отправляем начальные статусы всем клиентам
          io.emit('device:statuses:initial', statuses);
          
          // Переинициализируем статусы питания
          for (const device of devices) {
            if (device.rebootPort) {
              try {
                const powerStatus = await getPortPowerStatus(device.id);
                devicePowerStatus.set(device.id, powerStatus.power);
                
                io.emit('device:powerStatus', {
                  deviceId: device.id,
                  status: powerStatus.power,
                  timestamp: Date.now(),
                  isInitial: true
                });
                
                console.log(`📡 Power status for ${device.id}: ${powerStatus.power}`);
              } catch (error) {
                console.error(`Failed to get power status for ${device.id}:`, error);
                devicePowerStatus.set(device.id, 'unknown');
                
                io.emit('device:powerStatus', {
                  deviceId: device.id,
                  status: 'unknown',
                  timestamp: Date.now(),
                  isInitial: true
                });
              }
            }
          }
          
          // Обновляем флаги
          markStatusCacheFresh();
          
          // Синхронизируем MWS статусы
          syncMwsStatusesToClient(io);
          console.log('✅ Background reinitialization completed after config reload');
          
        } catch (error) {
          console.error('❌ Failed to reinitialize after config reload:', error);
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Config reload failed:', error);
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });


  // Добавление/удаление устройств
  // TODO Этап 5 (S1): add/remove устройств и пользователей — админские операции,
  // требуют ролей после внедрения авторизации socket.io
  on(socket, 'device:add', (deviceData, callback) => {
    try {
      const result = addDevice(deviceData);
      if (result.success) {
        io.emit('device:list', buildDeviceListPayload());
      }
      callback(result);
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  on(socket, 'device:remove', (deviceId, callback) => {
    try {
      const result = removeDevice(deviceId);
      if (result.success) {
        deviceStatusCache.delete(deviceId);
        devicePowerStatus.delete(deviceId);
        currentModes.delete(deviceId);
        deviceBookings.delete(deviceId);
        saveBookings();
        io.emit('device:list', buildDeviceListPayload());
      }
      callback(result);
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

// Управление пользователями
  on(socket, 'user:add', (userData, callback) => {
    try {
      const result = addUser(userData);
      if (result.success) {
        io.emit('device:users', users);
      }
      callback(result);
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  on(socket, 'user:remove', (ip, callback) => {
    try {
      const result = removeUser(ip);
      if (result.success) {
        io.emit('device:users', users);
      }
      callback(result);
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

// Обновление имени пользователя
  on(socket, 'user:updateName', (data, callback) => {
    try {
      console.log('✏️ Updating user name:', data);
      
      const result = updateUserName(data.ip, data.newName);
      
      if (result.success) {
        // Отправляем обновленный список всем клиентам
        io.emit('device:users', users);
      }
      
      callback(result);
    } catch (error) {
      console.error('❌ Error updating user name:', error);
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });

// Получение пользователя по IP
  on(socket, 'user:getByIp', (ip, callback) => {
    try {
      const user = getUserByIp(ip);
      callback({ 
        success: true, 
        user: user || null 
      });
    } catch (error) {
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Перезагрузка конфигурации пользователей
  on(socket, 'user:reload', (callback) => {
    try {
      const result = reloadUsersConfig();
      
      if (result.success) {
        // Отправляем обновленный список всем клиентам
        io.emit('device:users', users);
      }
      
      callback(result);
    } catch (error) {
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });
}
