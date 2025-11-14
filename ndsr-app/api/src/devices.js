// import {readConfig} from "./actions/readConfig.js";
import axios from "axios";

import {readFileSync} from "fs";

 function readConfig(path) {
    let data = readFileSync(path, {encoding: 'utf8', flag: 'r'});
    return JSON.parse(data)
}

const STATUS_CHECK_TIMEOUT = process.env.STATUS_CHECK_TIMEOUT * 1000
const devices = readConfig(process.env.DEVICES_CONFIG_PATH);
const wanTypes = readConfig(process.env.WAN_TYPES_CONFIG_PATH);
const users = readConfig(process.env.USER_CONFIG_PATH);

// const devices = readConfig('/Users/vladimir/Desktop/NDSR/ndsr-app/api/devices.json');
// const wanTypes = readConfig('/Users/vladimir/Desktop/NDSR/ndsr-app/api/wan_types.json');
// const users = readConfig('/Users/vladimir/Desktop/NDSR/ndsr-app/api/users.json');

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

// function getDeviceById(id) {
//     return devices.find(device => device.id == String(id))
// }
function getDeviceById(id) {
    console.log('🔍 getDeviceById called with:', { id, type: typeof id });
    
    // Нормализуем deviceId к строке для сравнения
    const normalizedId = String(id).trim();
    
    const device = devices.find(d => {
        const dId = String(d.id).trim();
        return dId === normalizedId;
    });
    
    console.log('📋 Device search result:', device ? `Found: ${device.hwId}` : 'Not found');
    
    if (device) {
        console.log('📋 Found device URL:', { 
            URL: device.URL, 
            URLType: typeof device.URL 
        });
    }
    
    return device;
}

function getDeviceLanPortByID(vlanLocal) {
    const device = devices.find(device => String(device.vlanLocal) === String(vlanLocal));
    return device.switchPortLan
}   

// В devices.js - добавьте отладочную информацию
function getParamRouter(routerId) {
    console.log(`🔍 Поиск роутера с ID: ${routerId}`);
    
    // Ищем роутер в devices
    const router = devices.find(device => 
        String(device.id) === String(routerId) && 
        (device.type === 'router' || device.mode === 'router')
    );
    
    console.log(`🔍 Результат поиска роутера ${routerId}:`, router ? 'НАЙДЕН' : 'НЕ НАЙДЕН');
    
    if (router) {
        console.log(`📋 Данные роутера:`, {
            id: router.id,
            hwId: router.hwId,
            ip: router.ip,
            shortName: router.shortName,
            type: router.type        });
    } else {
        // Покажем все доступные роутеры для отладки
        const allRouters = devices.filter(d => d.type === 'router' || d.mode === 'router');
        console.log(`📋 Все доступные роутеры:`, allRouters.map(r => ({
            id: r.id,
            hwId: r.hwId,
            shortName: r.shortName
        })));
    }
    
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



export {
    devices,
    wanTypes,
    users,
    getDevicesStatus,
    getDeviceStatusCode,
    getDeviceById,
    getVlanId,
    getDeviceLanPortByID,
    getParamRouter
    
}
