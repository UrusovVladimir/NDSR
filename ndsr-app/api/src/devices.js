import axios from "axios";
import { readFileSync, writeFileSync } from "fs";

function readConfig(path) {
    let data = readFileSync(path, {encoding: 'utf8', flag: 'r'});
    return JSON.parse(data)
}

function saveConfig(path, data) {
    writeFileSync(path, JSON.stringify(data, null, 2), {encoding: 'utf8'});
}

const STATUS_CHECK_TIMEOUT = process.env.STATUS_CHECK_TIMEOUT * 1000

// ✅ Изменено с const на let
let devices = readConfig(process.env.DEVICES_CONFIG_PATH);
let wanTypes = readConfig(process.env.WAN_TYPES_CONFIG_PATH);
let users = readConfig(process.env.USER_CONFIG_PATH);

async function getDevicesStatus(devices) {
    let urls = devices.map(device => device.checkUrl)
    const requests = urls.map(url => axios.get(url, {
        timeout: STATUS_CHECK_TIMEOUT,
        maxRedirects: 0,
        signal: AbortSignal.timeout(STATUS_CHECK_TIMEOUT)
    }))

    let statuses = {}
    await Promise.allSettled(requests).then(responses => {
        responses.forEach(res => {
            if (res.status === 'fulfilled')
                statuses[res.value.config.url] = res.value.status
            else
                statuses[res.reason.config.url] = 500
        })
    });
    return statuses
}

async function getDeviceStatusCode(device, customUrl = null) {
    let statusCode;
    try {
        const urlToCheck = customUrl || device.checkUrl;
        console.log(`🔍 getDeviceStatusCode проверяет: ${urlToCheck}`);
        
        let response = await axios.get(urlToCheck, {
            timeout: STATUS_CHECK_TIMEOUT,
            maxRedirects: 0,
            signal: AbortSignal.timeout(STATUS_CHECK_TIMEOUT)
        })
        statusCode = response.status
    } catch (error) {
        statusCode = 500
    }
    return statusCode
}

function getDeviceById(id) {
    const normalizedId = String(id).trim();
    const device = devices.find(d => String(d.id).trim() === normalizedId);
    return device;
}

function getDeviceLanPortByID(vlanLocal) {
    const device = devices.find(device => String(device.vlanLocal) === String(vlanLocal));
    return device?.switchPortLan
}   

function getParamRouter(routerId) {
    const router = devices.find(device => 
        String(device.id) === String(routerId) && 
        (device.type === 'router' || device.mode === 'router')
    );
    return router;
}

function getVlanId(){
    let wanVlan = []
    wanTypes.forEach(element => {
        if (element.vlanId){
            wanVlan.push(element.vlanId)
        }
    });
    return wanVlan
}

// ✅ Функции управления конфигом
function removeDevice(deviceId) {
    const index = devices.findIndex(d => String(d.id) === String(deviceId));
    if (index === -1) {
        return { success: false, error: 'Device not found' };
    }
    devices.splice(index, 1);
    saveConfig(process.env.DEVICES_CONFIG_PATH, devices);
    return { success: true };
}
function addDevice(device) {
    const exists = devices.find(d => 
        String(d.id) === String(device.id) || 
        String(d.hwId) === String(device.hwId)
    );
    if (exists) {
        return { success: false, error: `Device with id=${device.id} or hwId=${device.hwId} already exists` };
    }
    devices.push(device);
    saveConfig(process.env.DEVICES_CONFIG_PATH, devices);
    console.log(`✅ Device added: ${device.hwId} (${device.shortName})`);
    return { success: true, device };
}
function reloadConfigs() {
    devices = readConfig(process.env.DEVICES_CONFIG_PATH);
    wanTypes = readConfig(process.env.WAN_TYPES_CONFIG_PATH);
    users = readConfig(process.env.USER_CONFIG_PATH);
    console.log('🔄 Configs reloaded');
    return { success: true, devicesCount: devices.length };
}

export {
    devices,
    wanTypes,
    users,
    getDevicesStatus,
    getDeviceStatusCode,
    getDeviceById,
    getVlanId,
    getDeviceLanPortByID,
    getParamRouter,
    removeDevice,
    reloadConfigs,
    addDevice
}