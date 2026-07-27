import {
  devices,
  getDeviceById,
  getDeviceStatusCode,
  wanTypes,
  users,
  getParamRouter,
  reloadConfigs,
  getUserByIp,
  addUser,
  removeUser,
  updateUserName,
  removeDevice,
  addDevice,
  updateDeviceShortName,
  getDeviceBadge,
  setDeviceBadge,
  removeDeviceBadge,
  getAllBadges,
  reloadUsersConfig
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
import { getPortPowerStatus } from "./actions/getPortPowerStatus.js";
import { 
  changeSystemMode, 
  checkDeviceMode, 
  disconnectAndChangeToRouter 
} from "./actions/changeModeType.js"; 
import { DisconnectManager } from "./utils/disconnectManager.js";
import { powerSetup } from "./actions/powerOnOff.js";
import { SSHManager } from "./actions/sshManager.js";
import { DockerManager } from './utils/dockerManager.js';

let dockerManager = null;
let sshConnection = null;
let devicePowerStatus = new Map();
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
let deviceSites = new Map();

// ✅ ГЛОБАЛЬНАЯ СИСТЕМА УПРАВЛЕНИЯ НАГРУЗКОЙ
let activeStatusRequests = 0;
const MAX_CONCURRENT_REQUESTS = 15;
const requestQueue = [];
let lastGlobalStatusUpdate = 0;
const STATUS_CACHE_DURATION = 8000;
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

const universalPromptRegex = /.*/i;

const syncPowerStatusesToClient = (socket) => {
    console.log('🔌 Syncing power statuses to client');
    
    let sentCount = 0;
    devicePowerStatus.forEach((status, deviceId) => {
        // Отправляем только если устройство забронировано И статус не 'unknown'
        if (deviceBookings.has(deviceId) && status && status !== 'unknown') {
            socket.emit('device:powerStatus', {
                deviceId: deviceId,
                status: status,
                timestamp: Date.now(),
                isInitial: true
            });
            sentCount++;
            console.log(`📡 Sent power status for ${deviceId}: ${status}`);
        }
    });
    console.log(`✅ Synced ${sentCount} power statuses to client`);
};
const initializeDockerManager = async () => {
    if (!dockerManager) {
        try {
            // Проверяем наличие необходимых переменных окружения
            if (!process.env.SSH_HOST || !process.env.SSH_USERNAME) {
                console.error('❌ SSH configuration missing in .env file');
                throw new Error('SSH configuration missing');
            }
            
            // Создаем и подключаем SSHManager если еще нет
            if (!sshConnection) {
                sshConnection = new SSHManager(
                    process.env.SSH_HOST,
                    parseInt(process.env.SSH_PORT) || 22,
                    process.env.SSH_USERNAME,
                    process.env.SSH_PRIVATE_KEY_PATH,
                    true
                );
                
                console.log(`🔧 Подключение к SSH серверу ${process.env.SSH_HOST}...`);
                await sshConnection.connect();
                console.log(`✅ SSHManager подключен к ${process.env.SSH_HOST}`);
            }
            
            // Создаем DockerManager с существующим SSH соединением
            dockerManager = new DockerManager(sshConnection);
            console.log('✅ DockerManager initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize DockerManager:', error.message);
            throw error;
        }
    }
    return dockerManager;
};
function getDeviceUrl(deviceId, scenario = 'status') {
    const device = getDeviceById(deviceId);
    if (!device) {
        console.log(`❌ Устройство ${deviceId} не найдено`);
        return null;
    }
    
    // ✅ ИСПРАВЛЕНИЕ: ВСЕГДА возвращаем checkUrl для любого сценария
    console.log(`🔧 Для сценария ${scenario} используем checkUrl: ${device.checkUrl}`);
    return device.checkUrl;
}
async function checkAndUpdateDeviceStatusImmediately(io, deviceId) {
  try {
    const device = getDeviceById(deviceId);
    if (!device) {
      console.log(`❌ Устройство ${deviceId} не найдено`);
      return 0;
    }
    
    const url = getDeviceUrl(deviceId, 'status');
    if (!url) {
      return 0;
    }
    
    const status = await getDeviceStatusCode(device, url);
    console.log(`📊 Немедленная проверка статуса устройства ${deviceId}: ${status} (URL: ${url})`);
    
    // ✅ ОБНОВЛЯЕМ КЭШ
    deviceStatusCache.set(deviceId, status);
    lastGlobalStatusUpdate = Date.now();
    
    // ✅ ОТПРАВЛЯЕМ ВСЕМ КЛИЕНТАМ
    io.emit('device:status', {
      deviceId: deviceId,
      status: status
    });
    
    return status;
  } catch (error) {
    console.error(`❌ Ошибка немедленной проверки статуса ${deviceId}:`, error.message);
    
    deviceStatusCache.set(deviceId, 0);
    lastGlobalStatusUpdate = Date.now();
    
    io.emit('device:status', {
      deviceId: deviceId,
      status: 0
    });
    
    return 0;
  }
}

async function getDeviceStatusWithMode(deviceId) {
  try {
      const device = getDeviceById(deviceId);
      if (!device) {
          console.log(`❌ Устройство ${deviceId} не найдено`);
          return 0;
      }
      
      // ✅ ВСЕГДА используем checkUrl для проверки статуса
      const checkUrl = device.checkUrl;
      
      if (!checkUrl) {
          console.log(`❌ У устройства ${deviceId} нет checkUrl`);
          return 0;
      }
      
      console.log(`🔍 Проверка статуса устройства ${deviceId} по checkUrl: ${checkUrl}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      try {
          const response = await fetch(checkUrl, {
              method: 'HEAD',
              signal: controller.signal,
              timeout: 8000
          });
          
          clearTimeout(timeoutId);
          const status = response.status;
          console.log(`📊 Статус устройства ${deviceId}: ${status}`);
          return status;
          
      } catch (fetchError) {
          clearTimeout(timeoutId);
          
          if (fetchError.name === 'AbortError') {
              console.log(`⏰ Таймаут проверки статуса устройства ${deviceId}`);
          } else {
              console.error(`❌ Ошибка fetch для устройства ${deviceId}:`, fetchError.message);
          }
          return 0;
      }
      
  } catch (error) {
      console.error(`❌ Критическая ошибка проверки статуса устройства ${deviceId}:`, error.message);
      return 0;
  }
}

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

function sendMwsProgress(io, deviceId, progress, step = null) {
  console.log(`📤 MWS Progress: ${deviceId}, ${progress}%, step: ${step}`)
  
  // Отправляем всем клиентам (уже работает)
  io.emit('device:mwsOperationProgress', {
    deviceId: deviceId,
    progress: progress,
    operationType: 'mws_connection',
    step: step,
    timestamp: Date.now()
  });
  
  // Также отправляем общее событие прогресса для универсальной модалки
  io.emit('device:operationProgress', {
    deviceId: deviceId,
    progress: progress,
    operationType: 'mwsConnection',
    step: step,
    details: step ? `MWS: ${step}` : null,
    timestamp: Date.now()
  });
}

function sendModeChangeProgress(io, deviceId, progress, step = null) {
  console.log(`📤 SERVER SENDING Mode Change Progress: ${deviceId}, ${progress}%, step: ${step}`) 
  
  io.emit('device:modeChangeProgress', {
    deviceId: deviceId,
    progress: progress,
    operationType: 'mode_change', 
    step: step,
    timestamp: Date.now()
  });
}

function sendOperationProgress(io, deviceId, progress, operationType) {
  console.log(`📤 Operation Progress: ${deviceId}, ${operationType}, ${progress}%`)
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
        if (requestQueue.length > 0) {
          const next = requestQueue.shift();
          setTimeout(next, 10);
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
        const status = await getDeviceStatusWithMode(device.id);
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

  const batchSize = 8;
  const results = [];
  
  for (let i = 0; i < statusPromises.length; i += batchSize) {
    const batch = statusPromises.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch);
    results.push(...batchResults);
    
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
  
  if (statusCacheInitialized && (now - lastGlobalStatusUpdate < STATUS_CACHE_DURATION)) {
    console.log('⚡ Using cached statuses for client');
    return Array.from(deviceStatusCache.entries()).map(([deviceId, status]) => ({
      deviceId,
      status
    }));
  }
  
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
      const powerStatus = devicePowerStatus.get(device.id) || 'on'; // По умолчанию 'on'
      
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
          },
          powerStatus: powerStatus // Добавляем статус питания
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
        },
        powerStatus: powerStatus // Добавляем статус питания
      };
    });
  
    socket.emit('device:list', devicesWithBookings);
    // Добавляем инициацию статуса порта питания при бронировании 
    devicesWithBookings.forEach(device => {
        if (device.rebootPort && device.booking?.isBooked) {
            const powerStatus = devicePowerStatus.get(device.id);
            if (!powerStatus || powerStatus === 'unknown') {
                // Асинхронно получаем статус
                (async () => {
                    try {
                        const status = await getPortPowerStatus(device.id);
                        devicePowerStatus.set(device.id, status.power);
                        socket.emit('device:powerStatus', {
                            deviceId: device.id,
                            status: status.power,
                            timestamp: Date.now(),
                            isInitial: true
                        });
                        console.log(`📡 Updated power status for ${device.id}: ${status}`);
                    } catch (error) {
                        console.error(`Failed to get power status for ${device.id}:`, error);
                    }
                })();
            }
        }
    });
    // ✅ ОТПРАВЛЯЕМ MWS СТАТУС ДЛЯ КАЖДОГО УСТРОЙСТВА
    devicesWithBookings.forEach(device => {
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

    // ✅ ОТПРАВЛЯЕМ СТАТУС ПИТАНИЯ ДЛЯ КАЖДОГО ЗАБРОНИРОВАННОГО УСТРОЙСТВА
    devicesWithBookings.forEach(device => {
      if (device.rebootPort && device.booking?.isBooked) {
        const powerStatus = devicePowerStatus.get(device.id);
        // Отправляем статус, даже если его нет - отправим 'unknown'
        socket.emit('device:powerStatus', {
          deviceId: device.id,
          status: powerStatus || 'unknown',
          timestamp: Date.now(),
          isInitial: true
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
  
    // ✅ ОТПРАВЛЯЕМ РЕЖИМЫ
    syncAllModesToClient(socket);
    
    // ✅ ВАЖНО: ОТПРАВЛЯЕМ НАЧАЛЬНЫЕ СТАТУСЫ ИЗ КЭША
    const initialStatuses = Array.from(deviceStatusCache.entries()).map(([deviceId, status]) => ({
      deviceId,
      status
    }));
    
    console.log(`📡 Отправляем начальные статусы клиенту (${initialStatuses.length} устройств)`);
    socket.emit('device:statuses:initial', initialStatuses);
  
    const endTime = Date.now();
    console.log(`✅ sendInitData completed in ${endTime - startTime}ms`);
    
    // ✅ Синхронизируем MWS статусы
    syncMwsStatusesToClient(socket);
    
    // ✅ Синхронизируем статусы питания
    syncPowerStatusesToClient(socket);
    
  } catch (error) {
    const endTime = Date.now();
    console.error(`❌ sendInitData failed after ${endTime - startTime}ms:`, error);
  }
}

async function broadcastDevicesStatus(io) {
  if (!io || io.engine.clientsCount === 0) {
    return;
  }
  
  const now = Date.now();
  const checkPromises = [];

  for (const device of devices) {
    const lastCheck = lastStatusCheckTime.get(device.id) || 0;
    
    if (now - lastCheck < 30000) {
      continue;
    }
    
    lastStatusCheckTime.set(device.id, now);
    
    checkPromises.push(executeWithLimit(async () => {
      try {
        const oldStatus = deviceStatusCache.get(device.id);
        
        const newStatus = await getDeviceStatusWithMode(device.id);
        
        if (oldStatus !== newStatus) {
          deviceStatusCache.set(device.id, newStatus);
          lastGlobalStatusUpdate = now;
          
          io.emit('device:status', {
            deviceId: device.id,
            status: newStatus
          });

          // ✅ Автоматическая проверка прошивки
          if (newStatus === 200 && oldStatus !== 200) {
            const lastTrigger = lastFirmwareTriggerTime.get(device.id) || 0;
            
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
          lastGlobalStatusUpdate = now;
          io.emit('device:status', {
            deviceId: device.id,
            status: 0
          });
          clearFirmwareCache(device.id);
        }
      }
    }));
  }

  if (checkPromises.length > 0) {
    await Promise.allSettled(checkPromises);
  }
}

const syncAllModesToClient = (socket) => {
  console.log('🔄 Syncing all device modes to client');
  
  let sentCount = 0;
  currentModes.forEach((modeInfo, deviceId) => {
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
async function initializePowerStatus() {
  console.log('🔌 Initializing power status for devices...');
  
  // Запускаем асинхронно, не блокируя старт сервера
  (async () => {
    for (const device of devices) {
      if (device.rebootPort) {
        try {
          const status = await getPortPowerStatus(device.id);
          devicePowerStatus.set(device.id, status.power);
          console.log(`📡 Power status for ${device.id}: ${status.power}`);
        } catch (error) {
          console.error(`❌ Failed to get power status for ${device.id}:`, error.message);
          devicePowerStatus.set(device.id, 'on'); // По умолчанию
        }
      }
    }
    console.log(`✅ Initialized power status for ${devicePowerStatus.size} devices`);
  })();
}
  
function clearFirmwareCache(deviceId) {
  if (currentFirmwareVersion.has(deviceId)) {
    currentFirmwareVersion.delete(deviceId);
  }
}

initializeStatusSystem();
initializePowerStatus();

const handleBatchRelease = async (socket, data, callback) => {
  try {
      const { deviceIds } = data;
      const userId = socket.clientIp;

      console.log(`🔄 Batch release requested by user ${userId} for ${deviceIds.length} devices`);

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

              const currentBooking = deviceBookings.get(deviceId);
              if (!currentBooking || currentBooking.bookedBy !== userId) {
                  return { 
                      deviceId, 
                      success: false, 
                      error: 'Not authorized or device not booked by user' 
                  };
              }

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

      const results = await Promise.allSettled(releasePromises);

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

        const deviceStatus = await getDeviceStatusWithMode(deviceId);
        if (deviceStatus !== 200) {
          return { 
            deviceId, 
            success: false, 
            error: 'Device is offline' 
          };
        }

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

        // ✅ ДЛЯ АВТОРИЗАЦИИ ИСПОЛЬЗУЕМ СЦЕНАРИЙ 'auth'
        const authUrl = getDeviceUrl(deviceId, 'auth');
        const versionData = await keeneticAuth(
          authUrl,
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
  socket.clientIp = socket.handshake.headers['x-real-ip'] || 
                  socket.handshake.headers['x-forwarded-for']?.split(',')[0] || 
                  socket.handshake.address?.replace(/^::ffff:/, '') || 
                  'unknown';
                  
  console.log('🔗 Client connected:', {
    ip: socket.clientIp,
    headers: {
      'x-real-ip': socket.handshake.headers['x-real-ip'],
      'x-forwarded-for': socket.handshake.headers['x-forwarded-for'],
      forwarded: socket.handshake.headers['forwarded']
    }
  });
  
  socket.emit('CLIENT_IP', socket.clientIp);

  socket.on('device:getInitData', (callback) => {
    console.log('📡 Client requested init data')
    sendInitData(socket).then(() => {
      callback?.({ success: true })
    }).catch(error => {
      callback?.({ success: false, error: error.message })
    })
  })
  // В setupEvents, после других обработчиков, добавьте:
  socket.on('device:getPowerStatus', async (deviceId, callback) => {
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
          
          if (callback) {
              callback({ success: true, status: status.power });
          }
      } catch (error) {
          console.error(`❌ Failed to get power status for ${deviceId}:`, error);
          if (callback) {
              callback({ success: false, error: error.message });
          }
      }
  });
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
  
  socket.on('device:getMwsConnection', (deviceId, callback) => {
    try {
      console.log('🔗 Requested MWS connection for device:', deviceId);
      
      const modeInfo = currentModes.get(deviceId);
      
      if (modeInfo && modeInfo.mode === 'extender_connect' && modeInfo.routerId) {
        const router = getDeviceById(modeInfo.routerId);
        const connection = {
          routerId: modeInfo.routerId,
          routerName: router ? `${router.hwId} ${router.shortName}` : `Router ${modeInfo.routerId}`,
          status: 'connected',
          connectedSince: modeInfo.timestamp || Date.now(),
          signalStrength: 85
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
      
      // Бронируем
      deviceBookings.set(deviceId, {
        bookedBy: bookedBy,
        expiresAt,
        accessPassword: dailyPasswords.today.value
      });
      
      // Получаем статус из кэша
      let cachedPowerStatus = devicePowerStatus.get(deviceId);
      
      // Если статус есть и валидный - отвечаем сразу
      if (cachedPowerStatus && cachedPowerStatus !== 'unknown') {
        const response = { 
          success: true, 
          expiresAt, 
          accessPassword: dailyPasswords.today.value,
          powerStatus: cachedPowerStatus
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
          },
          powerStatus: cachedPowerStatus
        });
        
        return;
      }
      
      // Если статуса нет - НЕ ждем, отвечаем сразу с 'unknown'
      // и запускаем получение в фоне с уведомлением клиента
      const response = { 
        success: true, 
        expiresAt, 
        accessPassword: dailyPasswords.today.value,
        powerStatus: 'unknown'
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
        },
        powerStatus: 'unknown'
      });
      
      // Фоновое получение статуса
      getPortPowerStatus(deviceId)
        .then(powerStatusResult => {
          const status = powerStatusResult.power || powerStatusResult;
          devicePowerStatus.set(deviceId, status);
          
          // Отправляем обновление клиенту
          io.emit('device:powerStatus', {
            deviceId: deviceId,
            status: status,
            timestamp: Date.now(),
            changed: true
          });
        })
        .catch(error => {
          console.error(`[BOOK] Background power status failed:`, error.message);
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
  let deviceId; // ✅ Объявляем переменную ДО try
  
  try {
    deviceId = data.deviceId; // ✅ Присваиваем значение
    const { routerId, action, routerPassword, useDevicePassword = true } = data;
    
    console.log('🔗 MWS Connection request received:', { 
        deviceId, 
        routerId, 
        action,
        hasRouterPassword: !!routerPassword,
        useDevicePassword
    });
    
    if (!deviceId || !routerId) {
        const errorMsg = 'Missing required parameters: deviceId or routerId';
        console.error('❌', errorMsg);
        if (typeof callback === 'function') {
            callback({ status: 'error', error: errorMsg });
        }
        return;
    }
    
    const device = getDeviceById(deviceId);
    const router = getParamRouter(routerId);
    
    if (!device) {
        const errorMsg = `Device with ID ${deviceId} not found`;
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
        device: device.hwId,
        router: router.hwId,
        deviceType: device.type,
        hwType: device.hWtype,
        action: action
    });
    
    // ✅ ПОЛУЧАЕМ ПАРОЛЬ РОУТЕРА
    let finalRouterPassword = routerPassword;
    
    if (useDevicePassword && !routerPassword) {
        const routerBooking = deviceBookings.get(routerId);
        finalRouterPassword = routerBooking?.accessPassword || dailyPasswords.today.value;
        console.log('🔑 Using device password for router:', finalRouterPassword ? '••••••••' : 'None');
    }
    
    // ✅ ПОЛУЧАЕМ ПАРОЛЬ УСТРОЙСТВА
    const deviceBooking = deviceBookings.get(deviceId);
    const devicePassword = deviceBooking?.accessPassword || dailyPasswords.today.value;
    
    // ✅ ПОДГОТАВЛИВАЕМ ДАННЫЕ ДЛЯ connectToMws
    const mwsData = {
        deviceId,
        routerId, 
        action,
        routerPassword: finalRouterPassword,
        useDevicePassword
    };
    
    console.log('🔧 Calling connectToMws with data:', mwsData);
    
    // ✅ НАЧАЛО ОПЕРАЦИИ
    sendMwsProgress(io, deviceId, 10, 'initializing');
    
    // ✅ ВЫЗЫВАЕМ connectToMws ДЛЯ НАСТРОЙКИ СВИТЧА
    sendMwsProgress(io, deviceId, 20, 'switch_config');
    await connectToMws(mwsData, universalPromptRegex);
    console.log('✅ connectToMws completed successfully');
    sendMwsProgress(io, deviceId, 40, 'switch_config');
      if (action === 'connect') {
        currentModes.set(deviceId, {
          mode: 'extender_connect',
          routerId: routerId,
          timestamp: Date.now()
        });
        
        console.log(`🔧 Режим устройства ${deviceId} обновлен: extender_connect к роутеру ${routerId}`);
        
        io.emit('device:modeUpdated', {
          deviceId: deviceId,
          mode: 'extender_connect',
          routerId: routerId,
          timestamp: Date.now(),
          source: 'mws_connect'
        });
        
        // ✅ НЕМЕДЛЕННАЯ ПРОВЕРКА СТАТУСА
        setTimeout(() => {
          checkAndUpdateDeviceStatusImmediately(io, deviceId);
        }, 2000);
      }
      
      // ✅ ДАЛЕЕ ВЫПОЛНЯЕМ ДОПОЛНИТЕЛЬНЫЕ ОПЕРАЦИИ
      try {
        if (action === 'disconnect') {
          console.log(`🔧 Removing port forwarding for device ${deviceId}`);
          sendMwsProgress(io, deviceId, 50, 'port_forwarding');
          await MWSConnectionManager.removeMWSConnection(deviceId, routerId);
          sendMwsProgress(io, deviceId, 70, 'port_forwarding');
          
          console.log(`🔧 Rebooting device ${deviceId} after disconnect`);
          sendMwsProgress(io, deviceId, 75, 'device_reboot');
          
          try {
            // ✅ ДЛЯ ПЕРЕЗАГРУЗКИ ИСПОЛЬЗУЕМ СЦЕНАРИЙ 'mode_change' (прямой URL)
            const rebootUrl = getDeviceUrl(deviceId, 'mode_change');
            const deviceForReboot = {
              ...device,
              URL: rebootUrl
            };
            
            await rebootDevice(deviceForReboot);
            console.log(`✅ Reboot command sent to device ${deviceId} via ${rebootUrl}`);
            
            console.log(`⏳ Waiting for device ${deviceId} to reboot (60 seconds)...`);
            await new Promise(resolve => setTimeout(resolve, 60000));
            
            let deviceOnline = false;
            let attempts = 0;
            const maxAttempts = 12;
            
            while (attempts < maxAttempts && !deviceOnline) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                try {
                  const status = await getDeviceStatusWithMode(device.id);
                  console.log(`📊 Device ${deviceId} status check ${attempts}/${maxAttempts}: ${status}`);
                  
                  if (status === 200) {
                      deviceOnline = true;
                      console.log(`✅ Device ${deviceId} is back online after reboot`);
                      sendMwsProgress(io, deviceId, 90, 'device_reboot');
                      break;
                  }
                } catch (error) {
                    console.log(`⚠️ Status check ${attempts} failed:`, error.message);
                }
            }
            
            if (!deviceOnline) {
                console.warn(`⚠️ Device ${deviceId} did not come back online within timeout`);
                sendMwsProgress(io, deviceId, 90, 'device_reboot');
            }
          } catch (rebootError) {
              console.warn(`⚠️ Reboot command failed: ${rebootError.message}`);
              sendMwsProgress(io, deviceId, 90, 'device_reboot');
          }
          
          // ✅ ОБНОВЛЯЕМ РЕЖИМ
          if (device.type === 'AP' && device.hWtype === 'true') {
              currentModes.set(deviceId, {
                  mode: 'extender',
                  routerId: null,
                  timestamp: Date.now()
              });
          } else {
              currentModes.set(deviceId, {
                  mode: 'router',
                  routerId: null,
                  timestamp: Date.now()
              });
          }
          
          console.log(`🔗 Successfully disconnected device ${deviceId} from router`);
          
        } else {
          // ✅ ПОДКЛЮЧЕНИЕ - НАСТРАИВАЕМ ПРОБРОСЫ
          console.log(`🔧 Setting up port forwarding for device ${deviceId} -> router ${routerId}`);
          sendMwsProgress(io, deviceId, 50, 'port_forwarding');
          
          if (device.type === 'AP' && device.hWtype === 'true') {
            console.log(`🔧 AP device detected - специальная настройка...`);
            sendMwsProgress(io, deviceId, 60, 'ap_config');
            
            await MWSConnectionManager.setupMWSConnection(
                deviceId, 
                routerId, 
                devicePassword,
                finalRouterPassword
            );
            sendMwsProgress(io, deviceId, 80, 'port_forwarding');
          }
          else {
            await MWSConnectionManager.setupMWSConnection(
                deviceId, 
                routerId, 
                devicePassword,
                finalRouterPassword
            );
            sendMwsProgress(io, deviceId, 80, 'port_forwarding');
          }
          
          currentModes.set(deviceId, {
              mode: 'extender_connect',
              routerId: routerId,
              timestamp: Date.now()
          });
          
          console.log(`🔗 Successfully connected device ${deviceId} to router ${routerId}`);
        }
      } catch (error) {
          console.error('❌ Port forwarding operations error:', error);
      }
      
      // ✅ ФИНАЛЬНЫЙ ПРОГРЕСС
      sendMwsProgress(io, deviceId, 95, 'verification');
      sendMwsProgress(io, deviceId, 100, 'completed');
      
      // ✅ ОТПРАВЛЯЕМ ОБНОВЛЕНИЯ КЛИЕНТАМ
      try {
          const updatedDevice = getDeviceById(deviceId);
          if (updatedDevice) {
              const immediateStatus = await getDeviceStatusWithMode(deviceId);
              console.log(`📊 Device status after MWS ${action}: ${immediateStatus}`);
              
              io.emit('device:status', {
                  deviceId: deviceId,
                  status: immediateStatus
              });
          }
      } catch (statusError) {
          console.log(`⚠️ Quick status check failed: ${statusError.message}`);
      }
      
      // ✅ УВЕДОМЛЯЕМ ОБ ИЗМЕНЕНИИ MWS СТАТУСА
      io.emit('device:mwsStatusUpdated', {
          deviceId: deviceId,
          routerId: routerId,
          status: action === 'disconnect' ? 'disconnected' : 'connected',
          timestamp: Date.now()
      });
      
      // ✅ ОТПРАВЛЯЕМ ОБНОВЛЕНИЕ РЕЖИМА
      io.emit('device:modeUpdated', {
          deviceId: deviceId,
          mode: action === 'disconnect' 
              ? (device.type === 'AP' && device.hWtype === 'true' ? 'extender' : 'router')
              : 'extender_connect',
          routerId: action === 'disconnect' ? null : routerId,
          timestamp: Date.now(),
          source: `mws_${action}`
      });
      
    } catch (error) {
         console.error('❌ MWS connection error:', error);
        // ✅ Теперь deviceId доступен здесь!
        if (deviceId) {
         sendMwsProgress(io, deviceId, 0, 'error');
        } else {
         console.error('❌ deviceId is undefined in catch block');
        }
    
         if (typeof callback === 'function') {
        callback({ status: 'error', error: error.message });
        }
        }
        });


  socket.on('tftp:getInterfaceIp', async (data, callback) => {
      try {
          const { tftpInterfaceName, deviceId } = data;
          
          console.log(`📡 Запрос IP интерфейса TFTP для устройства ${deviceId}, интерфейс: ${tftpInterfaceName}`);
          
          // Получаем устройство
          const device = getDeviceById(deviceId);
          if (!device) {
              throw new Error(`Device ${deviceId} not found`);
          }
          
          // Имя контейнера - это hwId устройства (например, "KN-2710")
          const containerName = device.hwId;
          
          console.log(`🔧 Container name: ${containerName}, Interface: ${tftpInterfaceName}`);
          
          // Инициализируем DockerManager
          const manager = await initializeDockerManager();
          
          // Получаем IP интерфейса
          const interfaceIp = await manager.getInterfaceIp(containerName, tftpInterfaceName);
          
          callback({
              success: true,
              interfaceIp: interfaceIp,
              interfaceName: tftpInterfaceName,
              containerName: containerName,
              deviceId: deviceId
          });
          
      } catch (error) {
          console.error(`❌ Ошибка получения IP интерфейса:`, error);
          callback({
              success: false,
              error: error.message,
              deviceId: data?.deviceId
          });
      }
        });
  socket.on('device:forceStatusCheck', (deviceId, callback) => {
    console.log(`🔍 Force status check requested for ${deviceId}`);
    
    try {
      const device = getDeviceById(deviceId);
      if (!device) {
        if (typeof callback === 'function') {
          return callback({ success: false, error: 'Device not found' });
        }
        return;
      }

      const checkStatusWithRetry = async (maxAttempts = 4, delay = 5000) => {
        let lastStatus = null;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            console.log(`🔍 Status check attempt ${attempt}/${maxAttempts} for ${deviceId}`);
            
            const status = await getDeviceStatusWithMode(device.id);
            console.log(`📊 Status check result for ${deviceId}: ${status} (attempt ${attempt})`);
            
            io.emit('device:status', {
              deviceId: deviceId,
              status: status
            });
            
            if (status === 200) {
              console.log(`✅ Device ${deviceId} is online after ${attempt} attempt(s)`);
              return { success: true, status: status, attempts: attempt };
            }
            
            lastStatus = status;
            
            if (attempt < maxAttempts && status === 500) {
              console.log(`⏳ Device ${deviceId} returned 500, waiting ${delay/1000}s before retry...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            
            return { 
              success: status !== 500, 
              status: status, 
              attempts: attempt,
              warning: status === 500 ? 'Device returned 500 after all attempts' : null
            };
            
          } catch (error) {
            console.error(`❌ Status check attempt ${attempt} failed for ${deviceId}:`, error.message);
            lastStatus = 0;
            
            io.emit('device:status', {
              deviceId: deviceId,
              status: 0
            });
            
            if (attempt < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        return { 
          success: false, 
          status: lastStatus || 0, 
          attempts: maxAttempts,
          error: 'All status check attempts failed'
        };
      };

      checkStatusWithRetry()
        .then(result => {
          console.log(`📋 Final status check result for ${deviceId}:`, result);
          
          if (typeof callback === 'function') {
            callback(result);
          }
        })
        .catch(error => {
          console.error(`❌ Force status check failed for ${deviceId}:`, error);
          
          io.emit('device:status', {
            deviceId: deviceId,
            status: 0
          });
          
          if (typeof callback === 'function') {
            callback({ 
              success: false, 
              status: 0, 
              error: error.message 
            });
          }
        });
        
    } catch (error) {
      console.error('❌ Force status check error:', error);
      
      io.emit('device:status', {
        deviceId: deviceId,
        status: 0
      });
      
      if (typeof callback === 'function') {
        callback({ 
          success: false, 
          status: 0,
          error: error.message 
        });
      }
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
  socket.on('device:power', async (data, callback) => {
    console.log("ПОЛУЧИЛИ ПАРАМЕТРЫ", data);
    const { deviceId, action } = data;
    
    try {
      console.log(`[POWER] Request received: ${action} for device ${deviceId}`);
      
      // Проверяем, что устройство забронировано
      const booking = deviceBookings.get(deviceId);
      if (!booking) {
        throw new Error('Device is not booked');
      }
      
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
  });

  socket.on('device:resetConfig', setupDeviceOperation('device:resetConfig', 'resetting', resetConfig, 180000));

  socket.on('device:resetDslLine', (deviceId, callback) => {
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
    
    sendOperationProgress(io, deviceId, 0, 'initializing');
    
    const progressInterval = setInterval(() => {
      progress = Math.min(progress + 15, 90);
      sendOperationProgress(io, deviceId, progress, 'initializing');
    }, 1500);
    
    try {
      console.log('🌐 Making POST request to:', url);
      console.log('📦 Request body:', JSON.stringify(body, null, 2));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

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

      const deviceStatus = await getDeviceStatusWithMode(deviceId);
      if (deviceStatus !== 200) {
        throw new Error('Device is offline');
      }

      // ✅ ДЛЯ АВТОРИЗАЦИИ ИСПОЛЬЗУЕМ СЦЕНАРИЙ 'auth'
      const authUrl = getDeviceUrl(deviceId, 'auth');
      const versionData = await keeneticAuth(
        authUrl,
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

  function getUserNameByIp(ip) {
    if (!ip || ip === 'unknown') return 'Unknown User';
    
    const user = users.find(u => u.ip === ip);
    if (user && user.name) {
      return user.name;
    }
    
    const ipParts = ip.split('.');
    const lastPart = ipParts.length > 0 ? ipParts[ipParts.length - 1] : 'Unknown';
    return `User_${lastPart}`;
  }
  
  socket.on('chat_message', (messageData) => {
    const clientIp = socket.clientIp || 'unknown';
    const senderName = getUserNameByIp(clientIp);
    console.log('📨 Creating message:', {
      clientIp: clientIp,
      senderName: senderName,
      text: messageData.text,
      users: users.length
    });
    const message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      text: messageData.text,
      senderType: messageData.senderType || 'user',
      senderName: senderName,
      senderIp: clientIp,
      timestamp: new Date(),
      clientIp: clientIp,
      targetIp: messageData.targetIp || null,
      isMention: messageData.isMention || false,
      notifyAll: messageData.notifyAll || false
    };
    
    chatHistory.push(message)
    if (chatHistory.length > 100) {
      chatHistory = chatHistory.slice(-100)
    }
    
    io.emit('chat_message', message)
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
      text: `${userName} отключился от чату. Онлайн: ${onlineUsers.size}`
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
  console.log("СТАТУС ИЗМЕНЕНИЯ WAN ИНТЕРФЕЙСА", data.action)
  let deviceId;
  
  try {
    const { deviceId: id, mode, routerId, password, routerPassword, action } = data;
    deviceId = id;
    
    console.log(`🔄 Processing mode change: ${mode} for device ${deviceId}, action: ${action}`);
    
    if (typeof callback === 'function') {
      callback({ 
        success: true, 
        message: 'Operation started',
        async: true
      });
    }
    
    if (mode === 'extender_connect' && routerId) {
      currentModes.set(deviceId, {
        mode: 'extender_connect',
        routerId: routerId,
        timestamp: Date.now()
      });
    } else if (mode === 'extender_disconnect') {
      currentModes.delete(deviceId);
    }
    
    deviceStatusCache.delete(deviceId);
    
    sendModeChangeProgress(io, deviceId, 10, 'initializing');
    
    let result;
    const device = getDeviceById(deviceId);
    
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    
    sendModeChangeProgress(io, deviceId, 30, 'applying_config');
    
    let targetUrl = device.checkDeviceMode || device.checkUrl || device.URL;
    
    if (action === 'wan_off') {
      console.log(`🔧 Выключаем WAN интерфейс для устройства ${deviceId}`);
      sendModeChangeProgress(io, deviceId, 35, 'wan_off');
      
      try {
        // ✅ Вызываем changeWanType для выключения WAN
        await changeWanType(deviceId, null, universalPromptRegex);
        console.log(`✅ WAN интерфейс выключен для ${deviceId}`);
      } catch (wanError) {
        console.warn(`⚠️ Ошибка при выключении WAN: ${wanError.message}`);
      }
    }
    
    // ✅ ВЫПОЛНЯЕМ СМЕНУ РЕЖИМА
    switch (mode) {
      case 'router':
        result = await changeSystemMode(deviceId, null, 'router', password, null, io, 'direct', targetUrl);
        break;
      case 'extender':
        result = await changeSystemMode(deviceId, null, 'extender', password, null, io, 'direct', targetUrl);
        break;
      case 'extender_connect':
        result = await changeSystemMode(deviceId, routerId, 'extender', password, routerPassword, io, 'direct', targetUrl);
        break;
      case 'extender_disconnect':
        result = await disconnectAndChangeToRouter(deviceId, routerId, password, routerPassword, io, 'router', targetUrl);
        break;
      default:
        throw new Error(`Unknown mode: ${mode}`);
    }
    
    if (result.success) {
      sendModeChangeProgress(io, deviceId, 60, 'rebooting');
      
      console.log(`⏳ Waiting for device ${deviceId} to reboot...`);
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      sendModeChangeProgress(io, deviceId, 80, 'waiting_online');
      
      console.log(`🔍 Checking if device ${deviceId} is back online via checkUrl: ${device.checkUrl}...`);
      
      let deviceOnline = false;
      let attempts = 0;
      const maxAttempts = 24;
      
      while (attempts < maxAttempts && !deviceOnline) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        try {
          console.log(`🔍 Проверка статуса ${deviceId} (${attempts}/${maxAttempts}) через ${device.checkUrl}/rci/show/version`);
          const urlCorrect = `${device.checkUrl}/rci/show/version`
          const status = await getDeviceStatusCode(device, urlCorrect);
          console.log(`📊 Device ${deviceId} status check ${attempts}/${maxAttempts}: ${status}`);
          
          if (status === 200) {
            deviceOnline = true;
            console.log(`✅ Device ${deviceId} is back online!`);
            sendModeChangeProgress(io, deviceId, 95, 'finalizing');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            sendModeChangeProgress(io, deviceId, 100, 'completed');
            break;
          }
        } catch (error) {
          console.log(`⚠️ Status check ${attempts} failed:`, error.message);
        }
      }
      
      if (!deviceOnline) {
        console.warn(`⚠️ Device ${deviceId} did not come back online within timeout`);
        sendModeChangeProgress(io, deviceId, 100, 'completed_with_warning');
      }
      
      // ОБНОВЛЯЕМ РЕЖИМ
      let finalMode = mode;
      let finalRouterId = null;
      
      if (mode === 'extender_disconnect') {
        finalMode = 'router';
      } else if (mode === 'extender_connect') {
        finalMode = 'extender_connect';
        finalRouterId = routerId;
      } else {
        finalMode = mode;
      }
      
      currentModes.set(deviceId, {
        mode: finalMode,
        routerId: finalRouterId,
        timestamp: Date.now()
      });
      
      console.log(`💾 Final mode saved for device ${deviceId}:`, { mode: finalMode, routerId: finalRouterId });
      
      io.emit('device:modeUpdated', {
        deviceId,
        mode: finalMode,
        routerId: finalRouterId,
        action: action, // Передаем action в ответе
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
      
    } else {
      sendModeChangeProgress(io, deviceId, 0, 'error');
      
      if (typeof callback === 'function') {
        callback({ 
          success: false, 
          error: result.message 
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error in device:changeMode:', error);
    
    if (deviceId) {
      sendModeChangeProgress(io, deviceId, 0, 'error');
    }
    
    if (typeof callback === 'function') {
      callback({ 
        success: false, 
        error: error.message 
      });
    }
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

        // ✅ ДЛЯ ПРОВЕРКИ РЕЖИМА ИСПОЛЬЗУЕМ СЦЕНАРИЙ 'auth'
        const checkUrl = getDeviceUrl(deviceId, 'auth');
        const modeResult = await checkDeviceMode(checkUrl, login || 'admin', password);
        
        if (modeResult.success) {
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
      
      // ✅ ОЧИЩАЕМ КЭШ СТАТУСА
      deviceStatusCache.delete(deviceId);
      console.log(`🧹 Очищен кэш статуса для устройства ${deviceId} при отключении экстендера`);
  
      const device = getDeviceById(deviceId);
      const router = getParamRouter(routerId);
      
      if (!device || !router) {
        throw new Error(`Устройство ${deviceId} или роутер ${routerId} не найдены`);
      }
      
      // ✅ ДЛЯ ОТКЛЮЧЕНИЯ ВСЕГДА ИСПОЛЬЗУЕМ URL ЧЕРЕЗ РОУТЕР
      const routerIp = router.ip.split('/')[0];
      const disconnectUrl = `http://${routerIp}:${deviceId}`;
      console.log(`🔧 Для отключения экстендера используем URL через роутер: ${disconnectUrl}`);
      
      // ✅ УДАЛЯЕМ РЕЖИМ СРАЗУ
      currentModes.delete(deviceId);
      console.log(`🧹 Удален режим устройства ${deviceId} из currentModes`);
  
      // ✅ ПЕРЕДАЕМ ПРАВИЛЬНЫЙ URL В DisconnectManager
      await DisconnectManager.fullDisconnect(deviceId, routerId, password, disconnectUrl);
  
      // ✅ ОБНОВЛЯЕМ РЕЖИМ НА router
      const newMode = 'router';
      
      currentModes.set(deviceId, {
        mode: newMode,
        routerId: null,
        timestamp: Date.now()
      });
  
      // ✅ НЕМЕДЛЕННО ПРОВЕРЯЕМ СТАТУС (через прямой URL, так как теперь устройство в router)
      setTimeout(async () => {
        try {
          const directUrl = device.checkDeviceMode || device.checkUrl || device.URL;
          console.log(`🔍 Проверка статуса после отключения через прямой URL: ${directUrl}`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          
          try {
            const response = await fetch(directUrl, {
              method: 'HEAD',
              signal: controller.signal,
              timeout: 8000
            });
            
            clearTimeout(timeoutId);
            const status = response.status;
            console.log(`📊 Статус устройства ${deviceId} после отключения: ${status}`);
            
            io.emit('device:status', {
              deviceId: deviceId,
              status: status
            });
          } catch (fetchError) {
            clearTimeout(timeoutId);
            console.log(`⚠️ Не удалось проверить статус после отключения:`, fetchError.message);
          }
        } catch (statusError) {
          console.log(`⚠️ Ошибка при проверке статуса:`, statusError.message);
        }
      }, 10000); // Ждем 10 секунд после отключения
  
      // ✅ ОТПРАВЛЯЕМ ОБНОВЛЕНИЕ КЛИЕНТУ
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

  socket.on('device:reloadConfigs', async (callback) => {
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
      
      // 4. Сбрасываем флаги инициализации
      statusCacheInitialized = false;
      lastGlobalStatusUpdate = 0;
      
      // 5. Отправляем обновленный список устройств ВСЕМ клиентам
      const devicesWithBookings = devices.map(device => {
        const booking = deviceBookings.get(device.id);
        const powerStatus = devicePowerStatus.get(device.id) || 'unknown';
        
        const deviceWithBooking = {
          ...device,
          powerStatus: powerStatus
        };
        
        if (booking) {
          const remainingTime = Math.max(0, booking.expiresAt - Math.floor(Date.now() / 1000));
          deviceWithBooking.booking = {
            isBooked: true,
            bookedBy: booking.bookedBy,
            accessPassword: booking.accessPassword,
            expiresAt: booking.expiresAt,
            remainingTime: remainingTime
          };
        } else {
          deviceWithBooking.booking = {
            isBooked: false,
            bookedBy: null,
            accessPassword: null,
            expiresAt: null,
            remainingTime: 0
          };
        }
        
        return deviceWithBooking;
      });
      
      // Отправляем обновленный список устройств
      io.emit('device:list', devicesWithBookings);
      
      // Отправляем обновленных пользователей
      io.emit('device:users', users);
      
      // Отправляем актуальные WAN типы
      io.emit('device:wanTypes', wanTypes);
      
      // Отправляем обновленные бронирования
      io.emit('device:bookings-list', Object.fromEntries(deviceBookings));
      
      console.log(`✅ Configs reloaded. Devices: ${devices.length}, Users: ${users.length}`);
      
      // 6. Отправляем ответ клиенту
      if (callback) {
        callback({ 
          success: true, 
          devicesCount: devices.length,
          usersCount: users.length,
          message: 'Configuration reloaded successfully'
        });
      }
      
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
          statusCacheInitialized = true;
          lastGlobalStatusUpdate = Date.now();
          
          // Синхронизируем MWS статусы
          currentModes.forEach((modeInfo, deviceId) => {
            if (modeInfo && modeInfo.mode === 'extender_connect' && modeInfo.routerId) {
              io.emit('device:mwsStatusUpdated', {
                deviceId: deviceId,
                routerId: modeInfo.routerId,
                status: 'connected',
                timestamp: modeInfo.timestamp || Date.now()
              });
            }
          });
          
          console.log('✅ Background reinitialization completed after config reload');
          
        } catch (error) {
          console.error('❌ Failed to reinitialize after config reload:', error);
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Config reload failed:', error);
      if (callback) {
        callback({ 
          success: false, 
          error: error.message 
        });
      }
    }
  });
  // Добавление/удаление устройств
  socket.on('device:add', (deviceData, callback) => {
    try {
      const result = addDevice(deviceData);
      if (result.success) {
        io.emit('device:list', devices);
      }
      callback(result);
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  socket.on('device:remove', (deviceId, callback) => {
    try {
      const result = removeDevice(deviceId);
      if (result.success) {
        deviceStatusCache.delete(deviceId);
        devicePowerStatus.delete(deviceId);
        currentModes.delete(deviceId);
        deviceBookings.delete(deviceId);
        io.emit('device:list', devices);
      }
      callback(result);
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

// Управление пользователями
  socket.on('user:add', (userData, callback) => {
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

  socket.on('user:remove', (ip, callback) => {
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
  socket.on('user:updateName', (data, callback) => {
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
  socket.on('user:getByIp', (ip, callback) => {
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
  socket.on('user:reload', (callback) => {
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
const initDockerManagerOnStart = async () => {
    try {
        console.log('🔧 [STARTUP] Initializing DockerManager...');
        await initializeDockerManager();
        console.log('✅ [STARTUP] DockerManager ready for TFTP operations');
        console.log('📡 [STARTUP] SSH connection established to:', process.env.SSH_HOST);
    } catch (error) {
        console.warn('⚠️ [STARTUP] DockerManager initialization failed:', error.message);
        console.log('📌 [STARTUP] TFTP interface IP queries will be attempted on first request');
        console.log('💡 [STARTUP] Check SSH configuration in .env file');
    }
};

// Запускаем инициализацию через 2 секунды после старта сервера
setTimeout(() => {
    initDockerManagerOnStart();
}, 2000);

setInterval(() => autoReleaseOldBookings(globalIO), 60 * 1000);
setInterval(() => console.log('Current bookings:', Array.from(deviceBookings.entries())), 30000);

export {
  sendInitData,
  setupEvents,
  broadcastDevicesStatus,
  initPasswordSystem,
  getCronStatus,
  deviceBookings,
  currentWanTypes,
  currentModes
}