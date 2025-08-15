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
import { keeneticAuth } from "./actions/athentication.js";

let isCronEnabled = false; 
let deviceBookings = new Map();
let currentWanTypes = {};
let currentMwsRouter = {};
let connectDisconnectAp = {};
let globalIO = null;
let currentFirmwareVersion = new Map();

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


function updateDailyPasswords() {
  const today = new Date().toDateString();
  
  if (dailyPasswords.today.date !== today) {
    dailyPasswords.yesterday = {
      // value: dailyPasswords.today.value || generatePassword(),
      // date: dailyPasswords.today.date || getYesterdayDate()
      value: dailyPasswords.today.value,
      date: dailyPasswords.today.date
    };
    
    dailyPasswords.today = {
      value: generatePassword(),
      date: today
    };
    
    console.log('Обновлены пароли:', {
      today: dailyPasswords.today.value,
      yesterday: dailyPasswords.yesterday.value
    });
    
    globalIO?.emit('DAILY_PASSWORDS', dailyPasswords);
  }
}

// function getYesterdayDate() {
//   const date = new Date();
//   date.setDate(date.getDate() - 1);
//   return date.toDateString();
// }

function initPasswordSystem(io) {
  globalIO = io;
  updateDailyPasswords();
  setInterval(updateDailyPasswords, 5 * 60 * 1000);
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
  socket.emit('DAILY_PASSWORDS', dailyPasswords);
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
  currentFirmwareVersion.forEach((fw, deviceId) => {
      socket.emit('device:currentFW', deviceId, {
        FW: fw || 'Unknown version'
      });
    });

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
      expiresAt,
      accessPassword: dailyPasswords.today.value // Используем пароль на сегодня
    })
  
    io.emit('device:booked', {
      deviceId,
      bookedBy: bookedBy,
      expiresAt
    })
  
    callback({ success: true, expiresAt, accessPassword: dailyPasswords.today.value })
  })
  

  socket.on('device:get-booking-status', (deviceId, callback) => {
    // const booking = bookingHistory.find(b => b.deviceId === deviceId) || deviceBookings.get(deviceId);
    const booking = deviceBookings.get(deviceId);
    console.log("Проверяю статус бронирования",booking)
    callback({
      isBooked: !!booking,
      bookedBy: booking?.bookedBy || null,
      expiresAt: booking?.expiresAt || null,
      accessPassword: booking?.accessPassword || null // Добавьте эту строку
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
  
socket.on('device:getCurrentFW', async ({ deviceId, login, password }, callback) => {
  console.log(`Получение текущей версии прошивки для устройства ${deviceId}`);
  const timeout = setTimeout(() => {
    callback({ success: false, error: 'Timeout' });
  }, 30000);

  try {
    // 1. Проверяем входные параметры
    if (!deviceId || !password) {
      throw new Error('Device ID and password are required');
    }

    // 2. Находим устройство
    const device = getDeviceById(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    // // 3. Проверяем кэш (если версия актуальна)
    // const cached = currentFirmwareVersion.get(deviceId);
    // if (cached && Date.now() - cached.timestamp < 3600000) { // 1 час кэша
    //   clearTimeout(timeout);
    //   return callback({ 
    //     success: true, 
    //     sessionCookie: { release: cached.version },
    //     cached: true
    //   });
    // }

    console.log(`[${deviceId}] Запрос версии прошивки для ${device.checkUrl}`);

    // 4. Получаем версию прошивки
    const versionData = await keeneticAuth(
      device.checkUrl, // Используем checkUrl из конфига
      login || 'admin', // Логин по умолчанию
      password         // Пароль с фронтенда (todayPassword)
    );

    if (!versionData?.release) {
      throw new Error('Invalid firmware version response');
    }

    // 5. Сохраняем в кэш
    currentFirmwareVersion.set(deviceId, {
      version: versionData.release,
      timestamp: Date.now()
    });

    // 6. Рассылаем обновление всем клиентам
    io.emit('device:currentFW', deviceId, { 
      FW: { release: versionData.release } 
    });

    clearTimeout(timeout);
    callback({ 
      success: true, 
      sessionCookie: {
        release: versionData.release
      }
    });

  } catch (error) {
    console.error('Ошибка получения версии:', error.message);
    clearTimeout(timeout);
    callback({ 
      success: false, 
      error: error.message,
      deviceId: deviceId // Добавляем ID для идентификации на фронтенде
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
  getCronStatus,
  deviceBookings,
  currentWanTypes}
