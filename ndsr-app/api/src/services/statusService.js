// services/statusService.js — HTTP-статусы устройств (кэш, broadcast,
// немедленная проверка, ожидание online) и стартовый опрос питания.
import { devices, getDeviceById, getDeviceStatusCode } from '../devices.js';
import { isRival } from '../utils/deviceFlags.js';
import { getPortPowerStatus } from '../actions/getPortPowerStatus.js';
import { createLimiter } from '../utils/createLimiter.js';
import { devicePowerStatus } from '../state/power.js';
import { currentFirmwareVersion } from '../state/firmware.js';
import {
  deviceStatusCache,
  lastStatusCheckTime,
  lastFirmwareTriggerTime,
  touchStatusCache,
  markStatusCacheFresh,
  isStatusCacheFresh
} from '../state/statusCache.js';

// ✅ ГЛОБАЛЬНАЯ СИСТЕМА УПРАВЛЕНИЯ НАГРУЗКОЙ
const MAX_CONCURRENT_REQUESTS = 15;
const STATUS_CACHE_DURATION = 8000;

function initializeStatusCache() {
  devices.forEach(device => {
    deviceStatusCache.set(device.id, 0);
  });
}

function getDeviceUrl(deviceId, scenario = 'status') {
    const device = getDeviceById(deviceId);
    if (!device) {
        console.log(`❌ Устройство ${deviceId} не найдено`);
        return null;
    }
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
    touchStatusCache();
    
    // ✅ ОТПРАВЛЯЕМ ВСЕМ КЛИЕНТАМ
    io.emit('device:status', {
      deviceId: deviceId,
      status: status
    });
    
    return status;
  } catch (error) {
    console.error(`❌ Ошибка немедленной проверки статуса ${deviceId}:`, error.message);
    
    deviceStatusCache.set(deviceId, 0);
    touchStatusCache();
    
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

// ⏳ Ожидание 200 от устройства после ребута/смены режима.
// delayFirst=true — пауза и перед первой проверкой. onStatus — на каждый ответ.
async function waitForOnline(deviceId, { attempts = 10, intervalMs = 3000, delayFirst = false, onStatus } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (delayFirst || attempt > 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    try {
      const status = await getDeviceStatusWithMode(deviceId);
      console.log(`📊 Device ${deviceId} status check ${attempt}/${attempts}: ${status}`);
      onStatus?.(status);
      if (status === 200) return true;
    } catch (error) {
      console.log(`⚠️ Status check ${attempt} failed:`, error.message);
    }
  }
  return false;
}

// ✅ ГЛОБАЛЬНЫЙ ОГРАНИЧИТЕЛЬ ЗАПРОСОВ
const executeWithLimit = createLimiter(MAX_CONCURRENT_REQUESTS);

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

  markStatusCacheFresh();
  return statuses;
}

// ✅ КЭШИРОВАННОЕ ПОЛУЧЕНИЕ СТАТУСОВ ДЛЯ ВСЕХ КЛИЕНТОВ
async function getCachedDevicesStatus() {
  if (isStatusCacheFresh(STATUS_CACHE_DURATION)) {
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
          touchStatusCache(now);
          
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
              if (deviceStatusCache.get(device.id) === 200 && !isRival(device)) {
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
          touchStatusCache(now);
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

export {
  initializeStatusCache,
  getDeviceUrl,
  getDeviceStatusWithMode,
  checkAndUpdateDeviceStatusImmediately,
  waitForOnline,
  executeWithLimit,
  getAllDevicesStatus,
  getCachedDevicesStatus,
  broadcastDevicesStatus,
  initializeStatusSystem,
  initializePowerStatus,
  clearFirmwareCache
};
