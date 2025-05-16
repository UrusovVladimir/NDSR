import {
  devices,
  getDeviceById,
  getDevicesStatus,
  getDeviceStatusCode,
  wanTypes,
  users
} from "./devices.js";
import { changeWanType } from "./actions/changeWanType.js";
import { resetConfig } from "./actions/resetConfig.js";
import { rebootDevice } from "./actions/rebootDevice.js";
import { resetDslLine } from "../resetDslLine.js";
import { connectToMws } from "./actions/connectToMws.js";
import { generatePassword } from "./actions/generatePassword.js";

let isCronEnabled = false; 
let deviceBookings = new Map();
let currentWanTypes = {};
let currentMwsRouter = {};
let connectDisconnectAp = {};
let globalIO = null;
let dailyPassword = {
  value: '',
  lastUpdated: null
};
const universalPromptRegex = /MGS3520.*[# ]/i;

function getCronStatus() {
  return isCronEnabled;
}

function autoReleaseOldBookings(io) {
  const now = Math.floor(Date.now() / 1000); // в секундах

  for (const [deviceId, booking] of deviceBookings.entries()) {
    if (booking.expiresAt <= now) {
      console.log(`Устройство ${deviceId} освободилось автоматически`);
      deviceBookings.delete(deviceId);
      io.emit('device:released', { deviceId });
    }
  }
}


function updateDailyPassword() {
  const today = new Date().toDateString();
  if (dailyPassword.lastUpdated !== today) {
    dailyPassword.value = generatePassword();
    dailyPassword.lastUpdated = today;
    console.log('Новый пароль:', dailyPassword.value);
    globalIO?.emit('DAILY_PASSWORD', { password: dailyPassword.value });
  }
}

function initPasswordSystem(io) {
  globalIO = io;
  updateDailyPassword();
  setInterval(updateDailyPassword, 5 * 60 * 1000);
}

function broadcastDevicesStatus(io) {
  if (io.engine.clientsCount > 0) {
    getDevicesStatus(devices).then(statuses => io.emit("device:statuses", statuses));
  }
}

function sendInitData(socket) {
  socket.emit('device:users', users);
  socket.emit('cron:status', isCronEnabled);
  socket.emit('device:list', devices);
  socket.emit('device:wanTypes', wanTypes);
  socket.emit('DAILY_PASSWORD', { password: dailyPassword.value });
  socket.emit('device:bookings-list', Object.fromEntries(deviceBookings));

  devices.forEach(device => {
    getDeviceStatusCode(device).then(status => {
      socket.emit('device:status', device.id, device.checkUrl, status);
      const wanInfo = currentWanTypes[device.id] || {};
      socket.emit('device:currentWanType', device.id, {
        vlanId: wanInfo.vlanId || null,
        type: wanInfo.type || null
      });
      const routerInfo = Object.keys(currentMwsRouter).length
        ? currentMwsRouter
        : { status: "None" };
      socket.emit('device:currentMwsRouter', routerInfo, connectDisconnectAp);
    });
  });
}

function setupEvents(socket, io) {
  socket.clientIp = socket.handshake.address?.replace(/^::ffff:/, '') || 'unknown';
  console.log(`New connection from IP: ${socket.clientIp}`);
  socket.emit('CLIENT_IP', socket.clientIp);
  socket.on('cron:toggle', (newStatus) => {
    isCronEnabled = newStatus;
    console.log(`Auto-release cron is now ${isCronEnabled ? 'ENABLED' : 'DISABLED'}`);
    io.emit('cron:status', isCronEnabled);
  });
  
  socket.on('cron:get-status', () => {
    socket.emit('cron:status', isCronEnabled);
  });
  
  
  socket.on('device:book', ({ deviceId, duration }, callback) => {
    const device = deviceBookings.get(deviceId)
    const bookedBy = socket.clientIp
  
    if (device && device.bookedBy !== bookedBy) {
      return callback({ success: false, message: 'Device is already booked by another user' })
    }
  
    const expiresAt = Math.floor(Date.now() / 1000) + duration
    deviceBookings.set(deviceId, {
      bookedBy: bookedBy,
      expiresAt
    })
  
    io.emit('device:booked', {
      deviceId,
      bookedBy: bookedBy,
      expiresAt
    })
  
    callback({ success: true, expiresAt })
  })
  

  socket.on('device:get-booking-status', (deviceId, callback) => {
    // const booking = bookingHistory.find(b => b.deviceId === deviceId) || deviceBookings.get(deviceId);
    const booking = deviceBookings.get(deviceId);
    console.log("Проверяю статус бронирования",booking)
    callback({
      isBooked: !!booking,
      bookedBy: booking?.bookedBy || null,
      expiresAt: booking?.expiresAt || null
    });
  });

  socket.on('device:release', ({ deviceId, bookedBy }, callback) => {
    const currentBooking = deviceBookings.get(deviceId)
  
    if (currentBooking?.bookedBy === bookedBy) {
      deviceBookings.delete(deviceId)
      console.log(`Device ${deviceId} released by ${bookedBy}`)
  
      io.emit('device:released', { deviceId })
      return callback?.({ status: 'ok' })
    }
  
    return callback?.({ status: 'error', message: 'Not your booking' })
  })
  
  
  socket.on('device:mwsConnected', (extenderId,routerId,disconnectExtender,callback) => {
    connectToMws(extenderId,routerId,disconnectExtender,universalPromptRegex)
    .then(()=>{
        callback({status:'ok'})
        connectDisconnectAp = disconnectExtender
    }).catch((error)=>{
        console.log(error)
        callback({status: 'error'});
    })
    .then(()=>{
    connectDisconnectAp === 'disconnect'
    ? (currentMwsRouter = "None", io.emit('device:checkMws', extenderId, currentMwsRouter)) 
    :(currentMwsRouter = routerId, io.emit('device:checkMws', extenderId, routerId, connectDisconnectAp));
    })  
});

  
  socket.on('device:wanTypes:save', (deviceId, vlanId, callback) => {
    changeWanType(deviceId, vlanId,universalPromptRegex).then(() => {
      const wanTypeObj = wanTypes.find(item => String(item.vlanId) === String(vlanId));
      
      // Определяем тип подключения
      let displayType;
      if (vlanId === null || vlanId === undefined) {
        displayType = 'ISP not configured'; // Для сброса
      } else {
        displayType = wanTypeObj?.type || null;
      }
      
      // Сохраняем в памяти сервера
      currentWanTypes[deviceId] = {
        vlanId,
        type: displayType,
      };
  
      // Рассылаем ВСЕМ клиентам новое значение
      io.emit('device:wanTypeUpdated', {
        deviceId,
        type: displayType, // Важно: отправляем уже форматированное значение
      });
  
      callback({ status: 'ok' });
    }).catch(error => {
      console.error(error);
      callback({ status: 'error', message: error.message });
    });
  });
  
  
  socket.on('device:getCurrentWan', (deviceId, callback) => {
    const wanInfo = currentWanTypes[deviceId] || {};
    callback({ 
      type: wanInfo.type === null ? 'ISP not configured' : wanInfo.type 
    });
  });

  const handleStatusCallback = (deviceId, callback) => {
    const device = getDeviceById(deviceId);
    const intervalId = setInterval(async () => {
      try {
        const status = await getDeviceStatusCode(device);
        socket.emit('device:status', device.checkUrl, status);
        if (status === 200) {
          clearInterval(intervalId);
          callback({ status: 'ok' });
        }
      } catch (err) {
        clearInterval(intervalId);
      }
    }, 5000);
  };

  socket.on('device:resetConfig', (deviceId, callback) => {
    resetConfig(deviceId).then(() => handleStatusCallback(deviceId, callback))
    .catch(err => {
      console.error(err);
      callback({ status: 'error' });
    });
  });

  socket.on('device:reboot', (deviceId, callback) => {
    rebootDevice(deviceId).then(() => handleStatusCallback(deviceId, callback))
    .catch(err => {
      console.error(err);
      callback({ status: 'error' });
    });
  });

  socket.on('device:resetDslLine', (deviceId, callback) => {
    resetDslLine(deviceId).then(() => callback({ status: 'ok' }))
    .catch(err => {
      console.error(err);
      callback({ status: 'error' });
    });
  });

  socket.on('device:init', async ({ url, body }, callback) => {
    console.log('Start processing:', url);
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
  
      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        console.warn('Response is not JSON or empty');
      }
  
      if (!response.ok) {
        console.error('Device responded with error:', data);
        return callback?.({ 
          success: false, 
          error: `HTTP ${response.status}: ${data?.message || 'No details'}` 
        });
      }
  
      // Успешный ответ
      callback?.({ 
        success: true, 
        data: data || {} 
      });
  
    } catch (err) {
      console.error('Fetch error:', err);
      callback?.({ 
        success: false, 
        error: err.message 
      });
    }
  });
  
 
}





// setInterval(() => autoReleaseOldBookings(globalIO), 60 * 1000);
setInterval(() => console.log('Current bookings:', Array.from(deviceBookings.entries())), 30000);
setInterval(() => autoReleaseOldBookings(globalIO), 60 * 1000);




export {
  sendInitData,
  setupEvents,
  broadcastDevicesStatus,
  initPasswordSystem,
  getCronStatus }