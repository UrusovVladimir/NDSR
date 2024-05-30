import {devices, getDeviceById, getDevicesStatus, getDeviceStatusCode, wanTypes} from "./devices.js";
import {changeWanType} from "./actions/changeWanType.js";
import {resetConfig} from "./actions/resetConfig.js";
import {rebootDevice} from "./actions/rebootDevice.js";
import {resetDslLine} from "/app/resetDslLine.js";

function broadcastDevicesStatus(io) {
    if (io.engine.clientsCount > 0)
        getDevicesStatus(devices).then(statuses => io.emit("device:statuses", statuses))
}

function sendInitData(socket) {
    socket.emit('device:list', devices)
    socket.emit('device:wanTypes', wanTypes)
    devices.forEach(device => {
        getDeviceStatusCode(device).then(status => {
            socket.emit('device:status', device.checkUrl, status)
        })
    })
}

function setupEvents(socket) {
    socket.on('device:wanTypes:save', (deviceId, checkedWanTypeIds, callback) => {
        changeWanType(deviceId, checkedWanTypeIds).then(() => {
            callback({status: 'ok'})
        }).catch((error) => {
            console.error(error)
            callback({status: 'error'});
        })
    })

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
}
