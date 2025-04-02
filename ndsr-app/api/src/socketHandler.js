import {devices, getDeviceById, getDevicesStatus, getDeviceStatusCode, wanTypes} from "./devices.js";
import {changeWanType} from "./actions/changeWanType.js";
import {resetConfig} from "./actions/resetConfig.js";
import {rebootDevice} from "./actions/rebootDevice.js";
import {resetDslLine} from "../resetDslLine.js";
import {io} from "../server.js"
import {connectToMws} from "./actions/connectToMws.js"
import { errorMessages } from "vue/compiler-sfc";
import { generatePassword } from "./actions/generatePassword.js";

// Логика для ежедневного пароля
let dailyPassword = {
  value: '',
  lastUpdated: null
};

let globalIO = null;

const updateDailyPassword = () => {
  const today = new Date().toDateString();
  if (!dailyPassword.lastUpdated || dailyPassword.lastUpdated !== today) {
    dailyPassword.value = generatePassword();
    dailyPassword.lastUpdated = today;
    console.log('Новый пароль:', dailyPassword.value);
    if (globalIO) {
      globalIO.emit('DAILY_PASSWORD', { password: dailyPassword.value });
    }
  }
};

// Инициализация при первом вызове
const initPasswordSystem = (io) => {
  globalIO = io;
  updateDailyPassword();
  setInterval(updateDailyPassword, 5 * 60 * 1000);
};



// Создайте объект для хранения состояний WAN типов
const currentWanTypes = {};
let currentMwsRouter = {};
let connectDisconnectAp = {};
function broadcastDevicesStatus(io) {
    if (io.engine.clientsCount > 0)
        getDevicesStatus(devices).then(statuses => io.emit("device:statuses", statuses))
}

function sendInitData(socket) {
    socket.emit('device:list', devices)
    // console.log(devices)
    socket.emit('device:wanTypes', wanTypes)
    socket.emit('DAILY_PASSWORD', { password: dailyPassword.value })
    devices.forEach(device => {
        getDeviceStatusCode(device).then(status => {
            socket.emit('device:status', device.id,device.checkUrl, status)
            const currentWanTypeValue = currentWanTypes || null; // Значение может быть null, если нет настроек
            console.log("Текущий WAN у",device.id," : ", currentWanTypeValue)
            socket.emit('device:currentWanType', device.id, currentWanTypeValue);
            // socket.emit('device:currentMwsConnected',currentMwsRouter)
            
            if (Object.keys(currentMwsRouter).length === 0){
            socket.emit('device:currentMwsRouter',"None",connectDisconnectAp)
            console.log('device:currentMwsRouter',currentMwsRouter,connectDisconnectAp)
            }
            else{
                socket.emit('device:currentMwsRouter',currentMwsRouter,connectDisconnectAp)
            }
        })
    })
}

function setupEvents(socket) {
// -------------------------------------------------------------------------------------------------------
// Здесь Остановился! Продолжить отсюда. 
    socket.on('device:mwsConnected', (extenderId,routerId,disconnectExtender,callback) => {
        connectToMws(extenderId,routerId,disconnectExtender).then(()=>{
            callback({status:'ok'})
            connectDisconnectAp = disconnectExtender
        }).catch((error)=>{
            console.log(error)
            callback({status: 'error'});
        })
        .then(()=>{
        connectDisconnectAp === 'disconnect' ? (currentMwsRouter = "None", io.emit('device:checkMws', extenderId, currentMwsRouter)) : (currentMwsRouter = routerId, io.emit('device:checkMws', extenderId, routerId, connectDisconnectAp));
        })  
    });
// --------------------------------------------------------------------------------------------------------
    socket.on('device:wanTypes:save', (deviceId, checkedWanTypeIds, callback) => {
        changeWanType(deviceId, checkedWanTypeIds).then(() => {
            // Сохраните обновленные значения
            currentWanTypes[deviceId] = checkedWanTypeIds;

            // Оповестите всех клиентов об обновлении
            io.emit('device:checkWan', deviceId, checkedWanTypeIds);

            callback({status: 'ok'});
        }).catch((error) => {
            console.error(error);
            callback({status: 'error'});
        });
    });

    socket.on('device:resetConfig', (deviceId, callback) => {
        resetConfig(deviceId).then(() => {
            _checkDeviceStatusCode(deviceId, callback)
        }).catch((error) => {
            console.error(error)
            callback({status: 'error'});
        })
    })

    socket.on('device:reboot', async (deviceId, callback) => {
        rebootDevice(deviceId).then(() => {
            _checkDeviceStatusCode(deviceId, callback)
        }).catch((error) => {
            console.error(error)
            callback({status: 'error'});
        })
    })

    socket.on('device:resetDslLine', async (deviceId, callback) => {
        resetDslLine(deviceId).then(() => {
            callback({status: 'ok'})
        }).catch((error) => {
            console.error(error)
            callback({status: 'error'});
        })
    })

    function _checkDeviceStatusCode(deviceId, callback) {
        let device = getDeviceById(deviceId)
        let intervalid = setInterval(async () => {
            try {
                let status = await getDeviceStatusCode(device)
                socket.emit('device:status', device.checkUrl, status)
                if (status === 200) {
                    callback({status: 'ok'})
                    clearInterval(intervalid)
                }
            } catch (error) {
                clearInterval(intervalid)
            }
        }, 5000)
    }
}

export {
    sendInitData,
    setupEvents,
    broadcastDevicesStatus,
    initPasswordSystem
}
