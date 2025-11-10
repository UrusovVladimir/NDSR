import {
  devices,
  getDeviceById,
  getDeviceStatusCode,
  wanTypes,
  users,
  getParamRouter
  
} from "./devices.js";
import MWSConnectionManager from "./actions/mwsConnectionManager.js";
import { changeWanType } from "./actions/changeWanType.js";
import { resetConfig } from "./actions/resetConfig.js";
import { rebootDevice } from "./actions/rebootDevice.js";
import { resetDslLine } from "../resetDslLine.js";
import { connectToMws } from "./actions/connectToMws.js";
import { generatePassword } from "./actions/generatePassword.js";
import { keeneticAuth } from "./actions/athentication.js";
import { getManagmentID } from "./actions/getManagmentID.js";
import { 
  changeSystemMode, 
  checkDeviceMode, 
  disconnectAndChangeToRouter 
} from "./actions/changeModeType.js"; 
import { DisconnectManager } from "./utils/disconnectManager.js";

let currentModes = new Map();
let isCronEnabled = false; 
let deviceBookings = new Map();
let currentWanTypes = {};
let currentMwsRouter = {};
let connectDisconnectAp = {};
let globalIO = null;
let currentFirmwareVersion = new Map();
let chatHistory = []
let onlineUsers = new Set()
let deviceStatusCache = new Map()
const consoleUrlCache = new Map();

// ✅ ГЛОБАЛЬНАЯ СИСТЕМА УПРАВЛЕНИЯ НАГРУЗКОЙ
let activeStatusRequests = 0;
const MAX_CONCURRENT_REQUESTS = 15; // Максимум для ВСЕХ клиентов вместе
const requestQueue = [];
let lastGlobalStatusUpdate = 0;
const STATUS_CACHE_DURATION = 8000; // 8 секунд кэширования
let isBackgroundUpdateRunning = false;

// ✅ КЭШ СТАТУСОВ ДЛЯ БЫСТРОЙ ЗАГРУЗКИ
let lastStatusCheckTime = new Map();
let lastFirmwareTriggerTime = new Map();
let statusCacheInitialized = false;

function initializeStatusCache() {
  devices.forEach(device => {
    deviceStatusCache.set(device.id, 0);
  });
}

let dailyPasswords = {
  today:{
    value: '',
    date: ''
  },
  yesterday: {
    value: '',
    date: ''
  }
};

const universalPromptRegex = /.*[# ]/i;


const syncMwsStatusesToClient = (socket) => {
  console.log('🔄 Syncing MWS statuses to client');
  
  let sentCount = 0;
  currentModes.forEach((modeInfo, deviceId) => {
    if (modeInfo && modeInfo.mode === 'extender_connect' && modeInfo.routerId) {
      socket.emit('device:mwsStatusUpdated', {
        deviceId: deviceId,
        routerId: modeInfo.routerId,
        status: 'connected',
        timestamp: modeInfo.timestamp || Date.now()
      });
      sentCount++;
      console.log(`📡 Sent MWS status for ${deviceId}: connected to ${modeInfo.routerId}`);
    }
  });
  console.log(`✅ Synced ${sentCount} MWS statuses to client`);
};


// ✅ ДОБАВЛЕНО: Функция отправки прогресса операций
function sendOperationProgress(io, deviceId, progress, operationType) {
  console.log(`📤 Sending progress: ${deviceId}, ${operationType}, ${progress}%`)
  io.emit('device:operationProgress', {
    deviceId: deviceId,
    progress: progress,
    operationType: operationType,
    timestamp: Date.now()
  });
}

function getCronStatus() {
  return isCronEnabled;
}

function autoReleaseOldBookings(io) {
  const now = Math.floor(Date.now() / 1000);

  for (const [deviceId, booking] of deviceBookings.entries()) {
    if (booking.expiresAt <= now) {
      deviceBookings.delete(deviceId);
      
      io.emit('device:bookingUpdated', {
        deviceId: deviceId,
        booking: {
          isBooked: false,
          bookedBy: null,
          accessPassword: null,
          expiresAt: null,
          remainingTime: 0
        }
      });
    }
  }
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
    
    globalIO?.emit('DAILY_PASSWORDS', dailyPasswords);
  }
}

function initPasswordSystem(io) {
  globalIO = io;
  initializeStatusCache()
  updateDailyPasswords();
  setInterval(updateDailyPasswords, 5 * 60 * 1000);
}

// ✅ ГЛОБАЛЬНЫЙ ОГРАНИЧИТЕЛЬ ЗАПРОСОВ
async function executeWithLimit(fn) {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      if (activeStatusRequests >= MAX_CONCURRENT_REQUESTS) {
        // ✅ Ставим в очередь если достигли лимита
        requestQueue.push(execute);
        return;
      }

      activeStatusRequests++;
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        activeStatusRequests--;
        // ✅ Запускаем следующий из очереди
        if (requestQueue.length > 0) {
          const next = requestQueue.shift();
          setTimeout(next, 10); // Небольшая задержка для стабильности
        }
      }
    };
    
    execute();
  });
}

// ✅ ОПТИМИЗИРОВАННАЯ ПАРАЛЛЕЛЬНАЯ ПРОВЕРКА СТАТУСОВ С ОГРАНИЧЕНИЕМ
async function getAllDevicesStatus() {
  const statusPromises = devices.map(device => 
    executeWithLimit(async () => {
      try {
        const status = await getDeviceStatusCode(device);
        return {
          deviceId: device.id,
          status: status
        };
      } catch (error) {
        return {
          deviceId: device.id,
          status: 0
        };
      }
    })
  );

  // ✅ Увеличиваем батч, т.к. глобальный лимит защищает от перегрузки
  const batchSize = 8;
  const results = [];
  
  for (let i = 0; i < statusPromises.length; i += batchSize) {
    const batch = statusPromises.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch);
    results.push(...batchResults);
    
    // ✅ Короткая пауза между батчами
    if (i + batchSize < statusPromises.length) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  const statuses = results.map(result => 
    result.status === 'fulfilled' ? result.value : {
      deviceId: 'unknown',
      status: 0
    }
  );

  // ✅ Обновляем кэш
  statuses.forEach(({ deviceId, status }) => {
    deviceStatusCache.set(deviceId, status);
  });

  statusCacheInitialized = true;
  lastGlobalStatusUpdate = Date.now();
  return statuses;
}

// ✅ КЭШИРОВАННОЕ ПОЛУЧЕНИЕ СТАТУСОВ ДЛЯ ВСЕХ КЛИЕНТОВ
async function getCachedDevicesStatus() {
  const now = Date.now();
  
  // ✅ Возвращаем кэш если не старше 8 секунд
  if (statusCacheInitialized && (now - lastGlobalStatusUpdate < STATUS_CACHE_DURATION)) {
    console.log('⚡ Using cached statuses for client');
    return Array.from(deviceStatusCache.entries()).map(([deviceId, status]) => ({
      deviceId,
      status
    }));
  }
  
  // ✅ Обновляем кэш для всех
  console.log('🔄 Updating global status cache');
  const freshStatuses = await getAllDevicesStatus();
  return freshStatuses;
}

async function sendInitData(socket) {
  const startTime = Date.now();
  console.log('🚀 Starting sendInitData...');
  
  try {
    // ✅ Сначала отправляем статические данные мгновенно
    socket.emit('device:users', users);
    socket.emit('cron:status', isCronEnabled);
    socket.emit('device:wanTypes', wanTypes);
    socket.emit('DAILY_PASSWORDS', dailyPasswords);
    socket.emit('device:bookings-list', Object.fromEntries(deviceBookings));
  
    // ✅ Подготавливаем устройства с бронированиями
    const devicesWithBookings = devices.map(device => {
      const booking = deviceBookings.get(device.id);
      if (booking) {
        const remainingTime = Math.max(0, booking.expiresAt - Math.floor(Date.now() / 1000));
        return {
          ...device,
          booking: {
            isBooked: true,
            bookedBy: booking.bookedBy,
            accessPassword: booking.accessPassword,
            expiresAt: booking.expiresAt,
            remainingTime: remainingTime
          }
        };
      }
      return {
        ...device,
        booking: {
          isBooked: false,
          bookedBy: null,
          accessPassword: null,
          expiresAt: null,
          remainingTime: 0
        }
      };
    });
  
    socket.emit('device:list', devicesWithBookings);
  
    // ✅ ОТПРАВЛЯЕМ КЭШИРОВАННЫЕ СТАТУСЫ МГНОВЕННО
    const statuses = await getCachedDevicesStatus();
    socket.emit('device:statuses:initial', statuses);
    console.log('✅ Sent statuses to client');
  
    // ✅ Отправляем остальные данные

// ✅ ОТПРАВЛЯЕМ MWS ПОДКЛЮЧЕНИЯ ПРИ ИНИЦИАЛИЗАЦИИ
devices.forEach(device => {
  const wanInfo = currentWanTypes[device.id] || {};
  socket.emit('device:currentWanType', device.id, {
    vlanId: wanInfo.vlanId || null,
    type: wanInfo.type || null
  });
  
  // ✅ ОТПРАВЛЯЕМ MWS СТАТУС ДЛЯ КАЖДОГО УСТРОЙСТВА
  const modeInfo = currentModes.get(device.id);
  if (modeInfo && modeInfo.mode === 'extender_connect' && modeInfo.routerId) {
    socket.emit('device:mwsStatusUpdated', {
      deviceId: device.id,
      routerId: modeInfo.routerId,
      status: 'connected',
      timestamp: modeInfo.timestamp
    });
  }
});

// ✅ ОТПРАВЛЯЕМ ОБЩУЮ ИНФОРМАЦИЮ О MWS
const routerInfo = Object.keys(currentMwsRouter).length
  ? currentMwsRouter
  : { status: "None" };
socket.emit('device:currentMwsRouter', routerInfo, connectDisconnectAp);
  
    currentFirmwareVersion.forEach((fw, deviceId) => {
      socket.emit('device:currentFW', deviceId, {
        FW: fw || 'Unknown version'
      });
    });
  
    // ✅ ОТПРАВЛЯЕМ РЕЖИМЫ ТОЛЬКО ОДИН РАЗ - через syncAllModesToClient
    syncAllModesToClient(socket);
  
    const endTime = Date.now();
    console.log(`✅ sendInitData completed in ${endTime - startTime}ms`);
    syncMwsStatusesToClient(socket);
    
    // ✅ ФОНОВАЯ СИНХРОНИЗАЦИЯ ТОЛЬКО ЕСЛИ НЕ ЗАПУЩЕНА
    if (!isBackgroundUpdateRunning) {
      isBackgroundUpdateRunning = true;
      setTimeout(async () => {
        try {
          console.log('🔄 Starting background status sync...');
          const freshStatuses = await getAllDevicesStatus();
          
          // ✅ Рассылаем обновления ВСЕМ подключенным клиентам
          const updatedStatuses = Array.from(deviceStatusCache.entries()).map(([deviceId, status]) => ({
            deviceId,
            status
          }));
          
          // ✅ ИСПРАВЛЕННАЯ СТРОКА: Отправляем всем клиентам кроме текущего
          socket.broadcast.emit('device:statuses:initial', updatedStatuses);
          
          // ✅ Получаем количество клиентов безопасно
          const clientCount = socket.server?.engine?.clientsCount || 0;
          console.log(`✅ Background sync completed. Sent to ${clientCount - 1} clients`);
          
        } catch (error) {
          console.error('❌ Background sync failed:', error);
        } finally {
          isBackgroundUpdateRunning = false;
        }
      }, 3000);
    }
  } catch (error) {
    const endTime = Date.now();
    console.error(`❌ sendInitData failed after ${endTime - startTime}ms:`, error);
  }
  }
// ✅ ОПТИМИЗИРОВАННАЯ ПРОВЕРКА СТАТУСОВ ДЛЯ ПЕРИОДИЧЕСКОГО ОБНОВЛЕНИЯ
async function broadcastDevicesStatus(io) {
  if (io.engine.clientsCount === 0) {
    return;
  }
  
  const now = Date.now();
  const checkPromises = [];

  for (const device of devices) {
    const lastCheck = lastStatusCheckTime.get(device.id) || 0;
    
    // ✅ Проверяем статус не чаще чем раз в 30 секунд
    if (now - lastCheck < 30000) {
      continue;
    }
    
    lastStatusCheckTime.set(device.id, now);
    
    checkPromises.push(executeWithLimit(async () => {
      try {
        const oldStatus = deviceStatusCache.get(device.id);
        const newStatus = await getDeviceStatusCode(device);
        
        if (oldStatus !== newStatus) {
          deviceStatusCache.set(device.id, newStatus);
          lastGlobalStatusUpdate = Date.now();
          
          io.emit('device:status', {
            deviceId: device.id,
            status: newStatus
          });

          // ✅ Автоматическая проверка прошивки
          if (newStatus === 200 && oldStatus !== 200) {
            const lastTrigger = lastFirmwareTriggerTime.get(device.id) || 0;
            
            // ❌ ЗАЩИТА: триггерим проверку прошивки не чаще чем раз в 2 минуты
            if (now - lastTrigger < 60000) {
              console.log(`⏳ Skipping firmware check - too soon for device ${device.id}`);
              return;
            }
            
            lastFirmwareTriggerTime.set(device.id, now);
            console.log(`🔄 Device ${device.id} came online, triggering firmware check`);
            
            setTimeout(() => {
              if (deviceStatusCache.get(device.id) === 200) {
                io.emit('device:checkFirmware', {
                  deviceId: device.id,
                  reason: 'status_change',
                  oldStatus: oldStatus,
                  newStatus: newStatus,
                  timestamp: Date.now()
                });
                clearFirmwareCache(device.id);
              }
            }, 5000);
          }
        }
      } catch (error) {
        const oldStatus = deviceStatusCache.get(device.id);
        if (oldStatus !== 0) {
          deviceStatusCache.set(device.id, 0);
          lastGlobalStatusUpdate = Date.now();
          io.emit('device:status', {
            deviceId: device.id,
            status: 0
          });
          clearFirmwareCache(device.id);
        }
      }
    }));
  }

  // ✅ Ожидаем завершения всех проверок
  if (checkPromises.length > 0) {
    await Promise.allSettled(checkPromises);
  }
}

const syncAllModesToClient = (socket) => {
  console.log('🔄 Syncing all device modes to client');
  
  let sentCount = 0;
  currentModes.forEach((modeInfo, deviceId) => {
      // ✅ ДОБАВИМ ЗАЩИТУ ОТ ДУБЛИРОВАНИЯ - отправляем только если есть валидные данные
      if (modeInfo && modeInfo.mode) {
          socket.emit('device:modeUpdated', {
              deviceId: deviceId,
              mode: modeInfo.mode,
              routerId: modeInfo.routerId || null,
              timestamp: modeInfo.timestamp || Date.now(),
              source: 'initial_sync'
          });
          sentCount++;
          console.log(`📡 Sent mode for ${deviceId}: ${modeInfo.mode}`);
      }
  });
  console.log(`✅ Synced ${sentCount} device modes to client`);
};

// ✅ ИНИЦИАЛИЗАЦИЯ СИСТЕМЫ СТАТУСОВ ПРИ СТАРТЕ СЕРВЕРА
async function initializeStatusSystem() {
  console.log('🔄 Initializing status system...');
  console.time('statusSystemInit');
  
  try {
    await getAllDevicesStatus();
    console.log('✅ Status system initialized');
  } catch (error) {
    console.error('❌ Failed to initialize status system:', error);
  }
  
  console.timeEnd('statusSystemInit');
}

function clearFirmwareCache(deviceId) {
  if (currentFirmwareVersion.has(deviceId)) {
    currentFirmwareVersion.delete(deviceId);
  }
}

// Инициализируем систему статусов при загрузке модуля
initializeStatusSystem();


const handleBatchRelease = async (socket, data, callback) => {
  try {
      const { deviceIds } = data;
      const userId = socket.clientIp;

      console.log(`🔄 Batch release requested by user ${userId} for ${deviceIds.length} devices`);

      // ✅ ПАРАЛЛЕЛЬНАЯ ОБРАБОТКА ВСЕХ УСТРОЙСТВ
      const releasePromises = deviceIds.map(async (deviceId) => {
          try {
              const device = getDeviceById(deviceId);
              
              if (!device) {
                  return { 
                      deviceId, 
                      success: false, 
                      error: 'Device not found' 
                  };
              }

              // Проверяем права пользователя
              const currentBooking = deviceBookings.get(deviceId);
              if (!currentBooking || currentBooking.bookedBy !== userId) {
                  return { 
                      deviceId, 
                      success: false, 
                      error: 'Not authorized or device not booked by user' 
                  };
              }

              // Освобождаем устройство
              deviceBookings.delete(deviceId);

              return { 
                  deviceId, 
                  success: true 
              };

          } catch (error) {
              console.error(`Error releasing device ${deviceId}:`, error);
              return { 
                  deviceId, 
                  success: false, 
                  error: error.message 
              };
          }
      });

      // ✅ ЖДЕМ ЗАВЕРШЕНИЯ ВСЕХ ОПЕРАЦИЙ
      const results = await Promise.allSettled(releasePromises);

      // ✅ АНАЛИЗИРУЕМ РЕЗУЛЬТАТЫ
      const successfulReleases = [];
      const failedReleases = [];

      results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
              const { value } = result;
              if (value.success) {
                  successfulReleases.push(value.deviceId);
              } else {
                  failedReleases.push({
                      deviceId: value.deviceId,
                      error: value.error
                  });
              }
          } else {
              failedReleases.push({
                  deviceId: deviceIds[index],
                  error: result.reason?.message || 'Unknown error'
              });
          }
      });

      console.log(`✅ Batch release completed: ${successfulReleases.length} successful, ${failedReleases.length} failed`);

      // ✅ ОТПРАВЛЯЕМ BATCH УВЕДОМЛЕНИЕ
      if (successfulReleases.length > 0) {
          socket.emit('device:batchBookingUpdated', {
              action: 'release',
              userId: userId,
              successful: successfulReleases,
              failed: failedReleases,
              timestamp: new Date().toISOString()
          });

          socket.broadcast.emit('device:batchBookingUpdated', {
              action: 'release',
              userId: userId,
              successful: successfulReleases,
              failed: failedReleases,
              timestamp: new Date().toISOString()
          });
      }

      // ✅ ОТВЕТ КЛИЕНТУ
      callback({
          success: true,
          released: successfulReleases.length,
          failed: failedReleases.length,
          details: {
              successful: successfulReleases,
              failed: failedReleases
          }
      });

  } catch (error) {
      console.error('❌ Batch release error:', error);
      callback({ 
          success: false, 
          message: 'Batch release operation failed',
          error: error.message 
      });
  }
};

const handleBatchFirmwareCheck = async (socket, data, callback) => {
  try {
    const { deviceIds, passwords = {} } = data;
    const userId = socket.clientIp;

    console.log(`🔄 Batch firmware check for ${deviceIds.length} devices by user ${userId}`);

    // ✅ ПАРАЛЛЕЛЬНАЯ ПРОВЕРКА ПРОШИВОК
    const checkPromises = deviceIds.map(async (deviceId) => {
      try {
        const device = getDeviceById(deviceId);
        
        if (!device) {
          return { 
            deviceId, 
            success: false, 
            error: 'Device not found' 
          };
        }

        // Проверяем что устройство онлайн
        const deviceStatus = await getDeviceStatusCode(device);
        if (deviceStatus !== 200) {
          return { 
            deviceId, 
            success: false, 
            error: 'Device is offline' 
          };
        }

        // Получаем пароль (из переданных или из бронирования)
        let password = passwords[deviceId];
        if (!password) {
          const booking = deviceBookings.get(deviceId);
          if (booking && booking.bookedBy === userId) {
            password = booking.accessPassword;
          } else {
            password = dailyPasswords.today.value;
          }
        }

        if (!password) {
          return { 
            deviceId, 
            success: false, 
            error: 'No password available' 
          };
        }

        // Проверяем прошивку
        const versionData = await keeneticAuth(
          device.checkUrl,
          'admin',
          password
        );

        if (!versionData?.release) {
          return { 
            deviceId, 
            success: false, 
            error: 'Invalid firmware response' 
          };
        }

        const firmwareVersion = versionData.release;
        
        // Обновляем кэш на сервере
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
    });

    // ✅ ЖДЕМ ЗАВЕРШЕНИЯ ВСЕХ ПРОВЕРОК
    const results = await Promise.allSettled(checkPromises);

    // ✅ АНАЛИЗИРУЕМ РЕЗУЛЬТАТЫ
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

    // ✅ ОТПРАВЛЯЕМ BATCH УВЕДОМЛЕНИЕ
    if (successfulChecks.length > 0) {
      socket.emit('device:batchFirmwareUpdated', {
        action: 'check',
        userId: userId,
        successful: successfulChecks,
        failed: failedChecks,
        timestamp: new Date().toISOString()
      });

      socket.broadcast.emit('device:batchFirmwareUpdated', {
        action: 'check', 
        userId: userId,
        successful: successfulChecks,
        failed: failedChecks,
        timestamp: new Date().toISOString()
      });
    }

    // ✅ ОТВЕТ КЛИЕНТУ
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

function setupEvents(socket, io) {
  socket.clientIp = socket.handshake.address?.replace(/^::ffff:/, '') || 'unknown';
  
  // ✅ Функция для получения имени пользователя по IP
  function getUserNameByIp(ip) {
    if (!ip || ip === 'unknown') return 'Unknown User';
    const user = users.find(u => u.ip === ip);
    if (user) {
      return user.name || `User ${ip.split('.').pop()}`;
    }
    return `User ${ip.split('.').pop()}`;
  }
  
  socket.emit('CLIENT_IP', socket.clientIp);

  socket.on('device:getInitData', (callback) => {
    console.log('📡 Client requested init data')
    sendInitData(socket).then(() => {
      callback?.({ success: true })
    }).catch(error => {
      callback?.({ success: false, error: error.message })
    })
  })
  socket.on('cron:toggle', (newStatus, callback) => {
    console.log("Статус крона:",newStatus)
    if (typeof newStatus !== 'boolean') {
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Invalid status type' });
      } else {
        socket.emit('cron:error', { message: 'Invalid status type' });
      }
      return;
    }
    
    isCronEnabled = newStatus;
    
    if (typeof callback === 'function') {
      callback({ success: true, status: isCronEnabled });
    }
    
    io.emit('cron:status', isCronEnabled);

  });

  socket.on('cron:get-status', (callback) => {
    if (typeof callback === 'function') {
      callback(isCronEnabled);
    } else {
      socket.emit('cron:status', isCronEnabled);
    }
  });
  // ✅ ДОБАВЛЯЕМ ОБРАБОТЧИК ДЛЯ ПОЛУЧЕНИЯ ТЕКУЩЕГО MWS ПОДКЛЮЧЕНИЯ
socket.on('device:getMwsConnection', (deviceId, callback) => {
  try {
    console.log('🔗 Requested MWS connection for device:', deviceId);
    
    // ✅ ИЩЕМ ПОДКЛЮЧЕНИЕ В currentModes
    const modeInfo = currentModes.get(deviceId);
    
    if (modeInfo && modeInfo.mode === 'extender_connect' && modeInfo.routerId) {
      const router = getDeviceById(modeInfo.routerId);
      const connection = {
        routerId: modeInfo.routerId,
        routerName: router ? `${router.hwId} ${router.shortName}` : `Router ${modeInfo.routerId}`,
        status: 'connected',
        connectedSince: modeInfo.timestamp || Date.now(),
        signalStrength: 85 // Можно добавить реальные данные сигнала если есть
      };
      
      console.log('🔗 Found MWS connection:', connection);
      callback({ 
        success: true, 
        connection: connection 
      });
    } else {
      console.log('🔗 No MWS connection found for device:', deviceId);
      callback({ 
        success: true, 
        connection: null 
      });
    }
  } catch (error) {
    console.error('❌ Error getting MWS connection:', error);
    callback({ 
      success: false, 
      error: error.message 
    });
  }
});
socket.on('device:book', async (data, callback) => {
  try {
    const { deviceId, duration } = data;
    const bookedBy = socket.clientIp;
    
    if (!deviceId || !duration) {
      throw new Error('Device ID and duration are required');
    }

    const existingBooking = deviceBookings.get(deviceId);
    if (existingBooking && existingBooking.bookedBy !== bookedBy) {
      const errorMsg = 'Device is already booked by another user';
      return callback?.({ success: false, message: errorMsg });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + duration;
    const remainingTime = duration;
    
    deviceBookings.set(deviceId, {
      bookedBy: bookedBy,
      expiresAt,
      accessPassword: dailyPasswords.today.value
    });

    const response = { 
      success: true, 
      expiresAt, 
      accessPassword: dailyPasswords.today.value 
    };

    callback?.(response);


    io.emit('device:bookingUpdated', {
      deviceId: deviceId,
      booking: {
        isBooked: true,
        bookedBy: bookedBy,
        accessPassword: dailyPasswords.today.value,
        expiresAt: expiresAt,
        remainingTime: remainingTime
      }
    });

  } catch (error) {
    callback?.({ success: false, error: error.message });
  }
});
  socket.on('device:extend', (data, callback) => {
    try {
      const { deviceId, additionalDuration } = data;
      const bookedBy = socket.clientIp;
  
      if (!deviceId || !additionalDuration) {
        throw new Error('Device ID and additional duration are required');
      }
  
      const currentBooking = deviceBookings.get(deviceId);
      if (!currentBooking) {
        return callback?.({ success: false, message: 'No active booking found' });
      }
  
      if (currentBooking.bookedBy !== bookedBy) {
        return callback?.({ success: false, message: 'Not your booking' });
      }
  
      const newExpiresAt = currentBooking.expiresAt + additionalDuration;
      const newRemainingTime = newExpiresAt - Math.floor(Date.now() / 1000);
      
      deviceBookings.set(deviceId, {
        ...currentBooking,
        expiresAt: newExpiresAt
      });
  
      const response = { 
        success: true, 
        expiresAt: newExpiresAt,
        accessPassword: currentBooking.accessPassword 
      };
  
      callback?.(response);
  
      io.emit('device:bookingUpdated', {
        deviceId: deviceId,
        booking: {
          isBooked: true,
          bookedBy: bookedBy,
          accessPassword: currentBooking.accessPassword,
          expiresAt: newExpiresAt,
          remainingTime: newRemainingTime
        }
      });
  
    } catch (error) {
      callback?.({ success: false, error: error.message });
    }
  });

  socket.on('device:get-booking-status', (deviceId, callback) => {
    const booking = deviceBookings.get(deviceId);
    
    const response = {
      isBooked: !!booking,
      bookedBy: booking?.bookedBy || null,
      expiresAt: booking?.expiresAt || null,
      accessPassword: booking?.accessPassword || null
    };
    
    if (booking) {
      response.remainingTime = Math.max(0, booking.expiresAt - Math.floor(Date.now() / 1000));
    }
    
    callback(response);
  });

  socket.on('device:release', (data, callback) => {
    try {
      let actualDeviceId, actualCallback;
      
      if (typeof data === 'object') {
        actualDeviceId = data.deviceId;
        actualCallback = callback;
      } else {
        actualDeviceId = data;
        actualCallback = callback;
      }
      
      const bookedBy = socket.clientIp;
      const currentBooking = deviceBookings.get(actualDeviceId);
  
      if (!currentBooking) {
        const errorMsg = 'No active booking found for this device';
        if (typeof actualCallback === 'function') {
          actualCallback({ success: false, message: errorMsg });
        }
        return;
      }
  
      if (currentBooking.bookedBy !== bookedBy) {
        const errorMsg = 'Not your booking';
        if (typeof actualCallback === 'function') {
          actualCallback({ success: false, message: errorMsg });
        }
        return;
      }
  
      deviceBookings.delete(actualDeviceId);
  
      if (typeof actualCallback === 'function') {
        actualCallback({ success: true });
      }
  
      io.emit('device:bookingUpdated', {
        deviceId: actualDeviceId,
        booking: {
          isBooked: false,
          bookedBy: null,
          accessPassword: null,
          expiresAt: null,
          remainingTime: 0
        }
      });
  
      socket.emit('device:released', { deviceId: actualDeviceId });
  
    } catch (error) {
      if (typeof callback === 'function') {
        callback({ success: false, error: error.message });
      }
    }
  });

  socket.on('device:releaseMultiple', (data, callback) => {
    handleBatchRelease(socket, data, callback);
  });


  socket.on('device:mwsConnected', async (data, callback) => {
    try {
      const { 
        deviceId, 
        routerId, 
        action, 
        routerPassword, 
        useDevicePassword = true 
      } = data;
      
      console.log('🔗 MWS Connection request received:', { 
        deviceId, 
        routerId, 
        action,
        hasRouterPassword: !!routerPassword,
        useDevicePassword
      });
      
      // ✅ ПРОВЕРКА ОБЯЗАТЕЛЬНЫХ ПОЛЕЙ
      if (!deviceId || !routerId) {
        const errorMsg = 'Missing required parameters: deviceId or routerId';
        console.error('❌', errorMsg);
        if (typeof callback === 'function') {
          callback({ status: 'error', error: errorMsg });
        }
        return;
      }
      
      // ✅ ПРОВЕРКА ЧТО УСТРОЙСТВА СУЩЕСТВУЮТ
      const extender = getDeviceById(deviceId);
      
      // ✅ ИСПОЛЬЗУЕМ БЕЗОПАСНУЮ ФУНКЦИЮ ДЛЯ ПОЛУЧЕНИЯ РОУТЕРА
      // const router = devices.find(device => 
      //   String(device.id) === String(routerId) && 
      //   device.type === 'router'
      // );
      const router = getParamRouter(routerId)
      if (!extender) {
        const errorMsg = `Extender with ID ${deviceId} not found`;
        console.error('❌', errorMsg);
        if (typeof callback === 'function') {
          callback({ status: 'error', error: errorMsg });
        }
        return;
      }
      
      if (!router) {
        const errorMsg = `Router with ID ${routerId} not found`;
        console.error('❌', errorMsg);
        if (typeof callback === 'function') {
          callback({ status: 'error', error: errorMsg });
        }
        return;
      }
      
      console.log('✅ Found devices:', {
        extender: extender.hwId,
        router: router.hwId
      });
      
      // ✅ ПОЛУЧАЕМ ПАРОЛЬ РОУТЕРА
      let finalRouterPassword = routerPassword;
      
      if (useDevicePassword && !routerPassword) {
        const routerBooking = deviceBookings.get(routerId);
        finalRouterPassword = routerBooking?.accessPassword || dailyPasswords.today.value;
        console.log('🔑 Using device password for router:', finalRouterPassword ? '••••••••' : 'None');
      }
      
      // ✅ ПОЛУЧАЕМ ПАРОЛЬ ЭКСТЕНДЕРА
      const extenderBooking = deviceBookings.get(deviceId);
      const extenderPassword = extenderBooking?.accessPassword || dailyPasswords.today.value;
      
      // ✅ ПОДГОТАВЛИВАЕМ ДАННЫЕ ДЛЯ connectToMws
      const mwsData = {
        deviceId,
        routerId, 
        action,
        routerPassword: finalRouterPassword,
        useDevicePassword
      };
      
      console.log('🔧 Calling connectToMws with data:', mwsData);
      
      // ✅ ВЫЗЫВАЕМ connectToMws С ПРАВИЛЬНЫМ ФОРМАТОМ
      connectToMws(mwsData, universalPromptRegex)
        .then(async () => {
          console.log('✅ connectToMws completed successfully');
          
          // ✅ ВЫЗЫВАЕМ CALLBACK СРАЗУ ПОСЛЕ УСПЕХА
          if (typeof callback === 'function') {
            callback({ status: 'ok' });
          }
          
          // ✅ ДАЛЕЕ ВЫПОЛНЯЕМ ДОПОЛНИТЕЛЬНЫЕ ОПЕРАЦИИ
          try {
            if (action === 'disconnect') {
              console.log(`🔧 Removing port forwarding rules for extender ${deviceId}`);
              await MWSConnectionManager.removeMWSConnection(deviceId, routerId);
              
              // Обновляем режим устройства
              const device = getDeviceById(deviceId);
              if (device && device.type === 'AP' && device.hWtype === 'true') {
                console.log(`🔧 AP устройство ${deviceId} - сохраняем режим после отключения`);
                const currentMode = currentModes.get(deviceId);
                if (currentMode) {
                  currentModes.set(deviceId, {
                    mode: currentMode.mode === 'extender_connect' ? 'extender' : currentMode.mode,
                    routerId: null,
                    timestamp: Date.now()
                  });
                }
              } else {
                currentModes.set(deviceId, {
                  mode: 'router',
                  routerId: null,
                  timestamp: Date.now()
                });
              }
              
              console.log(`🔗 Disconnected extender ${deviceId} from router`);
            } else {
              console.log(`🔧 Setting up port forwarding rules for extender ${deviceId} -> router ${routerId}`);
              await MWSConnectionManager.setupMWSConnection(
                deviceId, 
                routerId, 
                extenderPassword,
                finalRouterPassword
              );
              
              // Обновляем режим устройства
              const device = getDeviceById(deviceId);
              if (device && device.type === 'AP' && device.hWtype === 'true') {
                console.log(`🔧 AP устройство ${deviceId} - устанавливаем режим extender_connect`);
                currentModes.set(deviceId, {
                  mode: 'extender_connect',
                  routerId: routerId,
                  timestamp: Date.now()
                });
              } else {
                currentModes.set(deviceId, {
                  mode: 'extender_connect',
                  routerId: routerId,
                  timestamp: Date.now()
                });
              }
              
              console.log(`🔗 Connected extender ${deviceId} to router ${routerId}`);
            }
          } catch (error) {
            console.error('❌ Port forwarding rules error:', error);
            // НЕ вызываем callback снова - уже вызвали успех
          }
          
          // ✅ ОТПРАВЛЯЕМ ОБНОВЛЕНИЯ КЛИЕНТАМ
          try {
            const device = getDeviceById(deviceId);
            if (device) {
              const immediateStatus = await getDeviceStatusCode(device);
              console.log(`📊 Extender status after MWS ${action}: ${immediateStatus}`);
              
              io.emit('device:status', {
                deviceId: deviceId,
                status: immediateStatus
              });
            }
          } catch (statusError) {
            console.log(`⚠️ Quick status check failed: ${statusError.message}`);
          }
          
          // ✅ УВЕДОМЛЯЕМ ОБ ИЗМЕНЕНИИ MWS СТАТУСА
          if (action === 'disconnect') {
            io.emit('device:mwsStatusUpdated', {
              deviceId: deviceId,
              routerId: routerId,
              status: 'disconnected',
              timestamp: Date.now()
            });
          } else {
            io.emit('device:mwsStatusUpdated', {
              deviceId: deviceId,
              routerId: routerId,
              status: 'connected',
              timestamp: Date.now()
            });
          }
          
        })
        .catch((error) => {
          console.error('❌ MWS connection error:', error);
          if (typeof callback === 'function') {
            callback({ status: 'error', error: error.message });
          }
        });
        
    } catch (error) {
      console.error('❌ MWS connection handler error:', error);
      if (typeof callback === 'function') {
        callback({ status: 'error', error: error.message });
      }
    }
  });

// ✅ ДОБАВЬТЕ ФУНКЦИЮ АГРЕССИВНОЙ ПРОВЕРКИ СТАТУСА
async function startAggressiveStatusCheck(deviceId, device) {
  console.log(`🔍 Starting aggressive status monitoring for ${deviceId}`);
  
  const maxAttempts = 12; // 1 минута проверок (12 * 5 секунд)
  const checkInterval = 5000; // 5 секунд
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      const status = await getDeviceStatusCode(device);
      console.log(`📊 Status check ${attempt}/${maxAttempts} for ${deviceId}: ${status}`);
      
      // Отправляем обновление статуса
      io.emit('device:status', {
        deviceId: deviceId,
        status: status
      });
      
      // Если устройство онлайн, можно остановить агрессивную проверку
      if (status === 200) {
        console.log(`✅ Device ${deviceId} is back online`);
        break;
      }
      
      // Если это последняя попытка и устройство все еще оффлайн
      if (attempt === maxAttempts && status !== 200) {
        console.log(`⚠️ Device ${deviceId} remains offline after ${maxAttempts} checks`);
      }
      
    } catch (error) {
      console.log(`⚠️ Status check attempt ${attempt} failed:`, error.message);
      
      // При ошибке все равно отправляем статус 0 (оффлайн)
      io.emit('device:status', {
        deviceId: deviceId,
        status: 0
      });
    }
  }
}
  // socket.on('device:mwsConnected', (extenderId, routerId, disconnectExtender, callback) => {
  //   console.log('🔗 MWS Connection request:', { extenderId, routerId, disconnectExtender });
    
  //   connectToMws(extenderId, routerId, disconnectExtender, universalPromptRegex)
  //     .then(async () => {
  //       callback({ status: 'ok' });
  //       connectDisconnectAp = disconnectExtender;
        
  //       // ✅ УПРАВЛЯЕМ ПРАВИЛАМИ ПРОБРОСА ПОРТОВ ЧЕРЕЗ MWSConnectionManager
  //       try {
  //         if (disconnectExtender === 'disconnect') {
  //           // ✅ ОТКЛЮЧЕНИЕ: УДАЛЯЕМ ПРАВИЛА ПРОБРОСА
  //           console.log(`🔧 Removing port forwarding rules for extender ${extenderId}`);
  //           await MWSConnectionManager.removeMWSConnection(extenderId, routerId);
            
  //           // ✅ ДЛЯ AP УСТРОЙСТВ - НЕ МЕНЯЕМ РЕЖИМ НА ROUTER!
  //           const device = getDeviceById(extenderId);
  //           if (device && device.type === 'AP' && device.hWtype === 'true') {
  //             console.log(`🔧 AP устройство ${extenderId} - сохраняем текущий режим после отключения`);
  //             // Оставляем текущий режим, но убираем routerId
  //             const currentMode = currentModes.get(extenderId);
  //             if (currentMode) {
  //               currentModes.set(extenderId, {
  //                 mode: currentMode.mode === 'extender_connect' ? 'extender' : currentMode.mode,
  //                 routerId: null,
  //                 timestamp: Date.now()
  //               });
  //             }
  //           } else {
  //             // Для обычных устройств - переводим в router
  //             currentModes.set(extenderId, {
  //               mode: 'router',
  //               routerId: null,
  //               timestamp: Date.now()
  //             });
  //           }
            
  //           currentMwsRouter = "None";
  //           console.log(`🔗 Disconnected extender ${extenderId} from router`);
  //         } else {
  //           // ✅ ПОДКЛЮЧЕНИЕ: ДОБАВЛЯЕМ ПРАВИЛА ПРОБРОСА
  //           console.log(`🔧 Setting up port forwarding rules for extender ${extenderId} -> router ${routerId}`);
  //           await MWSConnectionManager.setupMWSConnection(extenderId, routerId);
            
  //           // ✅ ДЛЯ AP УСТРОЙСТВ - УСТАНАВЛИВАЕМ РЕЖИМ EXTENDER_CONNECT
  //           const device = getDeviceById(extenderId);
  //           if (device && device.type === 'AP' && device.hWtype === 'true') {
  //             console.log(`🔧 AP устройство ${extenderId} - устанавливаем режим extender_connect`);
  //             currentModes.set(extenderId, {
  //               mode: 'extender_connect',
  //               routerId: routerId,
  //               timestamp: Date.now()
  //             });
  //           } else {
  //             // Для обычных устройств
  //             currentModes.set(extenderId, {
  //               mode: 'extender_connect',
  //               routerId: routerId,
  //               timestamp: Date.now()
  //             });
  //           }
            
  //           currentMwsRouter = routerId;
  //           console.log(`🔗 Connected extender ${extenderId} to router ${routerId}`);
  //         }
  //       } catch (error) {
  //         console.error('❌ Port forwarding rules error:', error);
  //         // Продолжаем выполнение даже при ошибке правил проброса
  //       }
  //     })
  //     .catch((error) => {
  //       console.error('❌ MWS connection error:', error);
  //       callback({ status: 'error', error: error.message });
  //     })
  //     .then(() => {
  //       // ✅ ОТПРАВЛЯЕМ ОБНОВЛЕНИЯ ВСЕМ КЛИЕНТАМ
  //       if (connectDisconnectAp === 'disconnect') {
  //         io.emit('device:checkMws', extenderId, currentMwsRouter);
  //         io.emit('device:mwsStatusUpdated', {
  //           deviceId: extenderId,
  //           routerId: routerId,
  //           status: 'disconnected',
  //           timestamp: Date.now()
  //         });
  //       } else {
  //         io.emit('device:checkMws', extenderId, routerId, connectDisconnectAp);
  //         io.emit('device:mwsStatusUpdated', {
  //           deviceId: extenderId,
  //           routerId: routerId,
  //           status: 'connected',
  //           timestamp: Date.now()
  //         });
  //       }
  //     });
  // });

  // В socketHandler.js - добавьте новый обработчик
socket.on('device:forceStatusCheck', (deviceId, callback) => {
  console.log(`🔍 Force status check requested for ${deviceId}`);
  
  try {
    const device = getDeviceById(deviceId);
    if (!device) {
      return callback({ success: false, error: 'Device not found' });
    }

    // Немедленная проверка статуса
    getDeviceStatusCode(device)
      .then(status => {
        console.log(`📊 Force status check result for ${deviceId}: ${status}`);
        
        // Отправляем обновление всем клиентам
        io.emit('device:status', {
          deviceId: deviceId,
          status: status
        });
        
        callback({ success: true, status: status });
      })
      .catch(error => {
        console.error(`❌ Force status check failed for ${deviceId}:`, error);
        callback({ success: false, error: error.message });
      });
      
  } catch (error) {
    console.error('❌ Force status check error:', error);
    callback({ success: false, error: error.message });
  }
});
  socket.on('device:checkMultipleFirmwares', (data, callback) => {
    handleBatchFirmwareCheck(socket, data, callback);
  });

  socket.on('device:wanTypes:save', (deviceId, vlanId, callback) => {
    changeWanType(deviceId, vlanId,universalPromptRegex).then(() => {
      const wanTypeObj = wanTypes.find(item => String(item.vlanId) === String(vlanId));
      
      let displayType;
      if (vlanId === null || vlanId === undefined) {
        displayType = 'ISP not configured';
      } else {
        displayType = wanTypeObj?.type || null;
      }
      
      currentWanTypes[deviceId] = {
        vlanId,
        type: displayType,
      };
  
      io.emit('device:wanTypeUpdated', {
        deviceId,
        type: displayType,
      });
  
      callback({ status: 'ok' });
    }).catch(error => {
      callback({ status: 'error', message: error.message });
    });
  });
  
  socket.on('device:getCurrentWan', (deviceId, callback) => {
    const wanInfo = currentWanTypes[deviceId] || {};
    callback({ 
      type: wanInfo.type === null ? 'ISP not configured' : wanInfo.type 
    });
  });

  function startStatusMonitoring(deviceId, callback, operationType = 'reboot', timeout = 120000) {
    const device = getDeviceById(deviceId);
    const startTime = Date.now();
    
    console.log(`🔍 Starting status monitoring for ${deviceId} after ${operationType}, timeout: ${timeout}ms`);
    
    const checkInterval = setInterval(async () => {
      try {
        const status = await getDeviceStatusCode(device);
        
        // ✅ Отправляем промежуточный статус всем клиентам
        io.emit('device:status', {
          deviceId: deviceId,
          status: status
        });
        
        // ✅ Устройство вернулось онлайн - завершаем операцию
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
        
        // ✅ Таймаут
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          console.log(`❌ Device ${deviceId} did not come online within timeout after ${operationType}`);
          callback({ 
            status: 'ok', // команда выполнена, но устройство не вернулось
            deviceStatus: 'timeout',
            operation: operationType,
            warning: `Device ${operationType} completed but did not come back online within expected time`
          });
        }
      } catch (error) {
        // Продолжаем попытки при ошибках проверки
        console.log(`⚠️ Status check error for ${deviceId}:`, error.message);
      }
    }, 5000); // Проверяем каждые 5 секунд
  }

  function setupDeviceOperation(socketEvent, operationType, operationFunction, timeout = 120000) {
    return (deviceId, callback) => {
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
  
  socket.on('device:reboot', setupDeviceOperation('device:reboot', 'rebooting', rebootDevice, 120000));

  socket.on('device:resetConfig', setupDeviceOperation('device:resetConfig', 'resetting', resetConfig, 180000));


  socket.on('device:resetDslLine', (deviceId, callback) => {
    let progress = 0;
    
    // ✅ Отправляем начальный прогресс
    sendOperationProgress(io, deviceId, 0, 'resettingDsl');
    
    const progressInterval = setInterval(() => {
      progress = Math.min(progress + 20, 90);
      sendOperationProgress(io, deviceId, progress, 'resettingDsl');
    }, 1000);
    
    resetDslLine(deviceId)
      .then(() => {
        // ✅ Финальный прогресс
        clearInterval(progressInterval);
        sendOperationProgress(io, deviceId, 100, 'resettingDsl');
        
        setTimeout(() => {
          callback({ status: 'ok' });
        }, 500);
      })
      .catch(err => {
        clearInterval(progressInterval);
        sendOperationProgress(io, deviceId, 0, 'resettingDsl');
        callback({ status: 'error' });
      });
  });


  
socket.on('device:init', async (data, callback) => {
  console.log("🔧 ПОЛУЧЕНО ТЕЛО СООБЩЕНИЯ:", JSON.stringify(data, null, 2))

  const { url, body, deviceId } = data;
  
  if (!deviceId) {
    if (typeof callback === 'function') {
      callback({ success: false, error: 'Device ID is required' });
    }
    return;
  }

  let progress = 0;
  
  // ✅ Отправляем начальный прогресс
  sendOperationProgress(io, deviceId, 0, 'initializing');
  
  const progressInterval = setInterval(() => {
    progress = Math.min(progress + 15, 90);
    sendOperationProgress(io, deviceId, progress, 'initializing');
  }, 1500);
  
  try {
    console.log('🌐 Making POST request to:', url);
    console.log('📦 Request body:', JSON.stringify(body, null, 2));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 секунд таймаут

    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log('📡 Response status:', response.status);
    console.log('📡 Response status text:', response.statusText);

    let responseData = null;
    let responseText = '';
    
    try {
      responseText = await response.text();
      console.log('📡 Raw response text:', responseText);
      
      if (responseText) {
        responseData = JSON.parse(responseText);
        console.log('📡 Parsed response data:', responseData);
      } else {
        console.log('📡 Response is empty');
      }
    } catch (e) {
      console.log('⚠️ Response is not JSON:', e.message);
      responseData = { rawText: responseText };
    }

    if (!response.ok) {
      clearInterval(progressInterval);
      sendOperationProgress(io, deviceId, 0, 'initializing');
      
      console.error('❌ HTTP Error:', {
        status: response.status,
        statusText: response.statusText,
        responseData: responseData,
        responseText: responseText
      });
      
      if (typeof callback === 'function') {
        callback({ 
          success: false, 
          error: `HTTP ${response.status}: ${responseData?.message || response.statusText || 'No details'}`,
          status: response.status
        });
      }
      return;
    }

    // ✅ Финальный прогресс
    clearInterval(progressInterval);
    sendOperationProgress(io, deviceId, 100, 'initializing');
    
    console.log('✅ Initialization successful!');
    
    setTimeout(() => {
      if (typeof callback === 'function') {
        callback({ 
          success: true, 
          data: responseData || {} 
        });
      }
    }, 500);

  } catch (err) {
    clearInterval(progressInterval);
    sendOperationProgress(io, deviceId, 0, 'initializing');
    
    console.error('❌ Initialization error:', {
      name: err.name,
      message: err.message,
      code: err.code,
      stack: err.stack
    });
    
    if (typeof callback === 'function') {
      let errorMessage = err.message;
      
      if (err.name === 'AbortError') {
        errorMessage = 'Request timeout - device is not responding';
      } else if (err.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused - device may be offline';
      } else if (err.code === 'ENOTFOUND') {
        errorMessage = 'Device host not found';
      }
      
      callback({ 
        success: false, 
        error: errorMessage,
        code: err.code
      });
    }
    
    // ✅ ОТПРАВЛЯЕМ РЕЖИМЫ ТОЛЬКО ПРИ ОШИБКЕ (если нужно)
    // syncAllModesToClient(socket);

  }
});

  socket.on('device:getCurrentFW', async ({ deviceId, login, password }, callback) => {
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

      const deviceStatus = await getDeviceStatusCode(device);
      if (deviceStatus !== 200) {
        throw new Error('Device is offline');
      }

      const versionData = await keeneticAuth(
        device.checkUrl,
        login || 'admin',
        password
      );

      if (!versionData?.release) {
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

  socket.on('device:clearFirmwareCache', (deviceId, callback) => {
    clearFirmwareCache(deviceId);
    callback({ success: true });
  });

  socket.on('get_chat_history', () => {
    socket.emit('chat_history', chatHistory)
  })

  socket.on('chat_message', (messageData) => {
    const user = users.find(u => u.ip === socket.clientIp);
    const senderName = user ? user.name : `User_${socket.clientIp?.split('.')?.pop() || 'Unknown'}`;

    const message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      text: messageData.text,
      senderType: messageData.senderType || 'user',
      senderName: senderName,
      senderIp: socket.clientIp,
      timestamp: new Date(),
      clientIp: socket.clientIp,
      targetIp: messageData.targetIp || null,
      isMention: messageData.isMention || false,
      notifyAll: messageData.notifyAll || false
    };
    
    chatHistory.push(message)
    if (chatHistory.length > 100) {
      chatHistory = chatHistory.slice(-100)
    }
    
    // ОТПРАВЛЯЕМ СООБЩЕНИЕ ВСЕМ КЛИЕНТАМ
    io.emit('chat_message', message)
    
    // Отправляем подтверждение отправителю
    socket.emit('message_sent', message)
  })

  socket.on('user_typing', () => {
    socket.broadcast.emit('user_typing', {
      clientIp: socket.clientIp,
      userId: socket.id
    })
  })

  socket.on('user_stop_typing', () => {
    socket.broadcast.emit('user_stop_typing', {
      clientIp: socket.clientIp,
      userId: socket.id
    })
  })

  onlineUsers.add(socket.clientIp)

  // Получаем имя пользователя для системного сообщения
  const user = users.find(u => u.ip === socket.clientIp);
  const userName = user ? user.name : `User_${socket.clientIp?.split('.')?.pop() || 'Unknown'}`;

  io.emit('online_users', {
    size: onlineUsers.size,
    users: Array.from(onlineUsers)
  })

  io.emit('system_message', {
    text: `${userName} подключился к чату. Онлайн: ${onlineUsers.size}`
  })

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.clientIp)
    
    const user = users.find(u => u.ip === socket.clientIp);
    const userName = user ? user.name : `User_${socket.clientIp?.split('.')?.pop() || 'Unknown'}`;
    
    io.emit('online_users', {
      size: onlineUsers.size,
      users: Array.from(onlineUsers)
    })
    
    io.emit('system_message', {
      text: `${userName} отключился от чата. Онлайн: ${onlineUsers.size}`
    })
  })

  const iPs = process.env.MOXA_IPS
  const consoleIPs = getManagmentID(iPs)

  socket.on('device:getConsoleUrl', (deviceId, callback) => {
    const cached = consoleUrlCache.get(deviceId);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return callback(cached.data);
    }
    
    try {
      const device = getDeviceById(deviceId);
      if (!device) {
        return callback({ success: false, error: 'Device not found' });
      }
      
      const consoleBaseUrl = consoleIPs[device.consoleID];
      if (!consoleBaseUrl) {
        return callback({ success: false, error: 'Console IP not configured for this device' });
      }

      const consoleUrl = `http://${consoleBaseUrl}/remote/telnet/telnet/${device.consolePort}`;
      
      const result = { 
        success: true, 
        url: consoleUrl,
        deviceName: device.hwId
      };

      consoleUrlCache.set(deviceId, {
        timestamp: Date.now(),
        data: result
      });

      callback(result);

    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });


socket.on('device:changeMode', async (data, callback) => {
  try {
    const { deviceId, mode, routerId, password, routerPassword } = data;

    console.log(`🔄 Processing mode change: ${mode} for device ${deviceId}, router: ${routerId}`);

    let result;

    switch (mode) {
      case 'router':
        result = await changeSystemMode(deviceId, null, 'router', password, null, io);
        break;
      case 'extender':
        result = await changeSystemMode(deviceId, null, 'extender', password, null, io);
        break;
      case 'extender_connect':
        result = await changeSystemMode(deviceId, routerId, 'extender', password, routerPassword, io);
        break;
      case 'extender_disconnect':
        result = await disconnectAndChangeToRouter(deviceId, routerId, password, routerPassword, io);
        break;
      default:
        throw new Error(`Unknown mode: ${mode}`);
    }

    if (result.success) {
      let finalMode = mode;
      let finalRouterId = null;
      
      // ✅ ИСПРАВЛЕННАЯ ЛОГИКА ДЛЯ ОТКЛЮЧЕНИЯ
      if (mode === 'extender_disconnect') {
          finalMode = 'router';
          finalRouterId = null;
      } else if (mode === 'extender_connect') {
          finalMode = 'extender_connect';
          finalRouterId = routerId;
      } else {
          finalMode = mode;
          finalRouterId = mode === 'extender' ? null : routerId;
      }

      currentModes.set(deviceId, {
          mode: finalMode, // ✅ ПРАВИЛЬНЫЙ РЕЖИМ
          routerId: finalRouterId,
          timestamp: Date.now()
      });

      console.log(`💾 Saved mode for device ${deviceId}:`, {
          mode: finalMode,
          routerId: finalRouterId
      });

      // ✅ ОТПРАВЛЯЕМ ПРАВИЛЬНЫЙ РЕЖИМ
      io.emit('device:modeUpdated', {
          deviceId,
          mode: finalMode,
          routerId: finalRouterId,
          success: true,
          message: result.message,
          source: 'mode_change'
      });
      
      if (mode === 'extender_connect') {
        io.emit('device:mwsStatusUpdated', {
          deviceId: deviceId,
          routerId: routerId,
          status: 'connected',
          timestamp: Date.now()
        });
      } else if (mode === 'extender_disconnect') {
        io.emit('device:mwsStatusUpdated', {
          deviceId: deviceId,
          routerId: routerId,
          status: 'disconnected', 
          timestamp: Date.now()
        });
      }

      callback({ 
        success: true, 
        message: result.message,
        mwsConnected: result.mwsConnected || false
      });
    } else {
      callback({ 
        success: false, 
        error: result.message 
      });
    }
  } catch (error) {
    console.error('❌ Ошибка в device:changeMode:', error);
    callback({ 
      success: false, 
      error: error.message 
    });
  }
});

socket.on('device:getCurrentMode', async (data, callback) => {
  try {
      const { deviceId, login, password } = data;
      
      if (!deviceId) {
          return callback({ 
              success: false, 
              error: 'Device ID is required' 
          });
      }

      const device = getDeviceById(deviceId);
      if (!device) {
          return callback({ 
              success: false, 
              error: `Device ${deviceId} not found` 
          });
      }

      if (!device.URL) {
          return callback({ 
              success: false, 
              error: 'Device URL is not configured' 
          });
      }

      const modeResult = await checkDeviceMode(device.URL, login || 'admin', password);
      
      if (modeResult.success) {
          // ✅ ОТПРАВЛЯЕМ ДОПОЛНИТЕЛЬНУЮ ИНФОРМАЦИЮ О ПОДКЛЮЧЕНИЯХ
          callback({ 
              success: true, 
              mode: modeResult.mode,
              hasMwsConnections: modeResult.hasMwsConnections || false
          });
      } else {
          callback({ 
              success: false, 
              error: modeResult.message || 'Failed to detect mode' 
          });
      }

  } catch (error) {
      callback({ 
          success: false, 
          error: error.message 
      });
  }
});

socket.on('device:disconnectExtender', async (data, callback) => {
  try {
    const { deviceId, routerId, password } = data;

    console.log(`🔧 Прямое отключение экстендера ${deviceId} от роутера ${routerId}`);

    await DisconnectManager.fullDisconnect(deviceId, routerId, password);

    // ✅ ИСПРАВЛЕНИЕ: Определяем правильный режим для устройства
    const device = getDeviceById(deviceId);
    let newMode = 'router'; // по умолчанию
    
    if (device && device.type === 'AP' && device.hWtype === 'true') {
      newMode = 'extender'; // AP устройства в режиме extender
      console.log(`🔧 AP устройство ${deviceId} - режим после отключения: extender`);
    }

    // ✅ ОБНОВЛЯЕМ ЗАПИСЬ О РЕЖИМЕ С ПРАВИЛЬНЫМ ТИПОМ
    currentModes.set(deviceId, {
      mode: newMode, // ✅ ПРАВИЛЬНЫЙ РЕЖИМ
      routerId: null,
      timestamp: Date.now()
    });

    // ✅ ОТПРАВЛЯЕМ ПРАВИЛЬНЫЙ РЕЖИМ КЛИЕНТУ
    io.emit('device:modeUpdated', {
      deviceId: deviceId,
      mode: newMode,
      routerId: null,
      timestamp: Date.now()
    });

    callback({ 
      success: true, 
      message: `Extender ${deviceId} полностью отключен от роутера ${routerId}` 
    });

  } catch (error) {
    console.error('❌ Ошибка при отключении экстендера:', error);
    callback({ 
      success: false, 
      error: error.message 
    });
  }
});

socket.on('device:getModeInfo', (deviceId, callback) => {
  const modeInfo = currentModes.get(deviceId);
  callback({
      success: true,
      modeInfo: modeInfo || null
  });
});

}

setInterval(() => autoReleaseOldBookings(globalIO), 60 * 1000);
setInterval(() => console.log('Current bookings:', Array.from(deviceBookings.entries())), 30000);

export {
  sendInitData,
  setupEvents,
  broadcastDevicesStatus,
  initPasswordSystem,
  getCronStatus,
  deviceBookings,
  currentWanTypes
}