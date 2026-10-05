// services/initData.js — начальная синхронизация клиента: sendInitData и
// sync*ToClient (target — socket или io).
import { devices, users, wanTypes } from '../devices.js';
import { buildVmListPayload } from './vmService.js';
import { getPortPowerStatus } from '../actions/getPortPowerStatus.js';
import { currentModes } from '../state/modes.js';
import { deviceBookings } from '../state/bookings.js';
import { getCronStatus } from '../state/runtime.js';
import { devicePowerStatus } from '../state/power.js';
import { currentFirmwareVersion } from '../state/firmware.js';
import { dailyPasswords } from '../state/passwords.js';
import { deviceStatusCache } from '../state/statusCache.js';
import { buildBookingPayload } from './bookingService.js';
import { getWanTypesSnapshot } from './wanService.js';

// Никогда не изменяются — клиент всегда получает { status: "None" } и {}.
const currentMwsRouter = {};
const connectDisconnectAp = {};

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


async function sendInitData(socket) {
  const startTime = Date.now();
  console.log('🚀 Starting sendInitData...');
  
  try {
    // ✅ СОБИРАЕМ WAN ТИПЫ
    const wanTypesData = getWanTypesSnapshot();
    
    // ✅ Отправляем статические данные
    socket.emit('device:users', users);
    socket.emit('cron:status', getCronStatus());
    socket.emit('vm:list', buildVmListPayload());
    socket.emit('device:wanTypes', wanTypes);
    socket.emit('DAILY_PASSWORDS', dailyPasswords);
    socket.emit('device:bookings-list', Object.fromEntries(deviceBookings));
    socket.emit('device:wanTypes:all', wanTypesData);

    // 🔧 H: booking собирается ЕДИНЫМ хелпером buildBookingPayload —
    // он обрабатывает и «забронировано» (с учётом passwordInvalidated),
    // и «свободно». Live-обновления и F5 физически не могут разойтись.
    const devicesWithBookings = devices.map(device => ({
      ...device,
      booking: buildBookingPayload(device.id),
      powerStatus: devicePowerStatus.get(device.id) || 'on'
    }));
  
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

export {
  sendInitData,
  syncMwsStatusesToClient
};
