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
let badgesConfig = readConfig(process.env.BADGES_CONFIG_PATH);

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

// ==================== УПРАВЛЕНИЕ УСТРОЙСТВАМИ ====================

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

function updateDeviceShortName(deviceId, newShortName) {
    const index = devices.findIndex(d => String(d.id) === String(deviceId));
    
    if (index === -1) {
        return { 
            success: false, 
            error: `Device with ID ${deviceId} not found` 
        };
    }
    
    const oldName = devices[index].shortName;
    
    devices[index].shortName = newShortName;
    
    saveConfig(process.env.DEVICES_CONFIG_PATH, devices);
    
    console.log(`✅ Device ${deviceId} shortName updated: "${oldName}" -> "${newShortName}"`);
    
    return {
        success: true,
        deviceId,
        oldName,
        newName: newShortName,
        message: `Device name updated from "${oldName}" to "${newShortName}"`
    };
}

// ==================== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ====================

function getUserByIp(ip) {
    const normalizedIp = String(ip).trim();
    const user = users.find(u => String(u.ip).trim() === normalizedIp);
    return user || null;
}

function addUser(newUser) {
    // Проверка обязательных полей
    if (!newUser || !newUser.ip || !newUser.name) {
        return { success: false, error: 'User must have ip and name fields' };
    }
    
    // Проверка на дубликат по ip
    const existsByIp = users.find(u => String(u.ip).trim() === String(newUser.ip).trim());
    if (existsByIp) {
        return { success: false, error: `User with ip=${newUser.ip} already exists` };
    }
    
    users.push({
        ip: String(newUser.ip).trim(),
        name: String(newUser.name).trim()
    });
    
    saveConfig(process.env.USER_CONFIG_PATH, users);
    console.log(`✅ User added: ${newUser.name} (${newUser.ip})`);
    
    return { success: true, user: newUser };
}

function removeUser(ip) {
    const index = users.findIndex(u => String(u.ip).trim() === String(ip).trim());
    if (index === -1) {
        return { success: false, error: 'User not found' };
    }
    
    const removedUser = users[index];
    users.splice(index, 1);
    saveConfig(process.env.USER_CONFIG_PATH, users);
    
    console.log(`✅ User removed: ${removedUser.name} (${removedUser.ip})`);
    return { success: true, user: removedUser };
}

function updateUserName(ip, newName) {
    const index = users.findIndex(u => String(u.ip).trim() === String(ip).trim());
    
    if (index === -1) {
        return { success: false, error: `User with ip=${ip} not found` };
    }
    
    if (!newName || !newName.trim()) {
        return { success: false, error: 'User name cannot be empty' };
    }
    
    const oldName = users[index].name;
    users[index].name = String(newName).trim();
    
    saveConfig(process.env.USER_CONFIG_PATH, users);
    
    console.log(`✅ User ${ip} name updated: "${oldName}" -> "${newName.trim()}"`);
    
    return {
        success: true,
        ip,
        oldName,
        newName: newName.trim()
    };
}



// ==================== УПРАВЛЕНИЕ BADGE'АМИ ====================

function getDeviceBadge(deviceId) {
    const entry = badgesConfig.find(b => String(b.id) === String(deviceId));
    return entry?.badge || null;
}

function getDefaultBadge(deviceId) {
    const device = getDeviceById(deviceId);
    if (!device) return null;
    
    // Если устройство standAlone — возвращаем "Unknown"
    if (device.standAlone === 'yes') {
        return 'Unknown';
    }
    
    return null;
}

function setDeviceBadge(deviceId, badge) {
    const existingIndex = badgesConfig.findIndex(b => String(b.id) === String(deviceId));
    
    if (existingIndex !== -1) {
        // Обновляем существующий
        badgesConfig[existingIndex].badge = badge;
    } else {
        // Добавляем новый
        badgesConfig.push({
            id: String(deviceId),
            badge: badge
        });
    }
    
    saveConfig(process.env.BADGES_CONFIG_PATH || './config/badges.json', badgesConfig);
    
    console.log(`✅ Badge for device ${deviceId} set to: "${badge}"`);
    
    return {
        success: true,
        deviceId,
        badge
    };
}

function removeDeviceBadge(deviceId) {
    const index = badgesConfig.findIndex(b => String(b.id) === String(deviceId));
    
    if (index === -1) {
        return { success: false, error: 'Badge not found for this device' };
    }
    
    badgesConfig.splice(index, 1);
    saveConfig(process.env.BADGES_CONFIG_PATH || './config/badges.json', badgesConfig);
    
    console.log(`✅ Badge removed for device ${deviceId}`);
    
    return { success: true, deviceId };
}

function getAllBadges() {
    // Возвращаем badge'и для всех устройств
    const result = {};
    
    devices.forEach(device => {
        const savedBadge = getDeviceBadge(device.id);
        
        if (savedBadge) {
            result[device.id] = savedBadge;
        } else if (device.standAlone === 'yes') {
            result[device.id] = 'Unknown';
        }
    });
    
    return result;
}














// ==================== ПЕРЕЧИТЫВАНИЕ КОНФИГОВ ====================

function reloadConfigs() {
    devices = readConfig(process.env.DEVICES_CONFIG_PATH);
    wanTypes = readConfig(process.env.WAN_TYPES_CONFIG_PATH);
    users = readConfig(process.env.USER_CONFIG_PATH);
    console.log('🔄 Configs reloaded');
    return { success: true, devicesCount: devices.length, usersCount: users.length };
}

function reloadUsersConfig() {
    users = readConfig(process.env.USER_CONFIG_PATH);
    console.log(`🔄 Users config reloaded: ${users.length} users`);
    return { success: true, usersCount: users.length };
}




export {
    // Устройства
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
    addDevice,
    updateDeviceShortName,
    
    // Пользователи
    getUserByIp,
    addUser,
    removeUser,
    updateUserName,
    reloadUsersConfig,

    // Badge 
    getDeviceBadge,
    setDeviceBadge,
    removeDeviceBadge,
    getAllBadges,
    badgesConfig
}