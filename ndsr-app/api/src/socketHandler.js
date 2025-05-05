import {
  devices,
  getDeviceById,
  getDevicesStatus,
  getDeviceStatusCode,
  wanTypes
} from "./devices.js";
import { changeWanType } from "./actions/changeWanType.js";
import { resetConfig } from "./actions/resetConfig.js";
import { rebootDevice } from "./actions/rebootDevice.js";
import { resetDslLine } from "../resetDslLine.js";
import { connectToMws } from "./actions/connectToMws.js";
import { generatePassword } from "./actions/generatePassword.js";

let deviceBookings = new Map();
let bookingHistory = [];
let currentWanTypes = {};
let currentMwsRouter = {};
let connectDisconnectAp = {};
let globalIO = null;
let dailyPassword = {
  value: '',
  lastUpdated: null
};
const universalPromptRegex = /MGS3520.*[# ]/i;

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
  // socket.on('device:book', (deviceId, callback) => {
  //   if (!deviceId || !devices.some(d => d.id === deviceId)) {
  //     return callback?.({ status: 'error', message: 'Invalid device ID' });
  //   }

  //   const userIp = socket.clientIp;
  //   if (!deviceBookings.has(deviceId)) {
  //     const bookingInfo = { userIp, timestamp: Date.now() };
  //     deviceBookings.set(deviceId, bookingInfo);
  //     bookingHistory.push({ deviceId, userIp, bookedAt: new Date() });

  //     io.emit('device:booked', { deviceId, userIp });
  //     setTimeout(() => {
  //       if (deviceBookings.get(deviceId)?.userIp === userIp) {
  //         deviceBookings.delete(deviceId);
  //         io.emit('device:released', { deviceId });
  //       }
  //     }, 60 * 60 * 1000);

  //     return callback?.({ status: 'ok' });
  //   } else {
  //     return callback?.({ status: 'error', message: 'Устройство уже забронировано' });
  //   }
  // });


  // socket.on('device:book', ({ deviceId, duration }, callback) => {
  //   try {
  //     // 1. Валидация входных данных
  //     if (!deviceId || typeof deviceId !== 'string') {
  //       throw new Error('Device ID must be a non-empty string');
  //     }
  
  //     if (!duration || isNaN(duration)) {
  //       throw new Error('Duration must be a number');
  //     }

  //     // 3. Поиск устройства
  //     const device = devices.find(d => d.id === deviceId);
  //     if (!device) {
  //       throw new Error(Device with ID ${deviceId} not found);
  //     }

  //     // 4. Проверка доступности устройства
  //     if (device.isBooked && device.bookedBy !== socket.clientIp) {
  //       throw new Error('Device is already booked by another user');
  //     }
  
  //     // 5. Бронирование
  //     const expiresAt = Math.floor(Date.now() / 1000) + parseInt(duration);
  //     device.isBooked = true;
  //     device.bookedBy = socket.clientIp;
  //     device.expiresAt = expiresAt;
  
  //     // 6. Уведомление всех клиентов
  //     io.emit('device:booked', {
  //       deviceId: deviceId,
  //       bookedBy: socket.clientIp,
  //       expiresAt
  //     });
  //     console.log("socket.clientIp",socket.clientIp, "А это socket.userId", socket.userId)
      
  //     bookingHistory.push({
  //       deviceId,
  //       bookedBy: socket.clientIp,
  //       bookedAt: new Date()
  //   });
  //   deviceBookings.set(deviceId, {
  //     bookedBy: socket.clientIp,
  //     expiresAt
  //   });
  // console.log("bookingHistory",bookingHistory)
  //     // 7. Успешный ответ
  //     callback({ 
  //       success: true,
  //       expiresAt
  //     });
  
  //   } catch (error) {
  //     console.error('Booking error:', error);
  //     callback({ 
  //       success: false,
  //       message: error.message
  //     });
  //   }
  // });

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
}





// setInterval(() => autoReleaseOldBookings(globalIO), 60 * 1000);
setInterval(() => console.log('Current bookings:', Array.from(deviceBookings.entries())), 30000);
setInterval(() => autoReleaseOldBookings(globalIO), 60 * 1000);


export {
  sendInitData,
  setupEvents,
  broadcastDevicesStatus,
  initPasswordSystem
};