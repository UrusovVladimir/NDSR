import {readConfig} from "./actions/readConfig.js";
import axios from "axios";

const STATUS_CHECK_TIMEOUT = process.env.STATUS_CHECK_TIMEOUT * 1000
const devices = readConfig(process.env.DEVICES_CONFIG_PATH);
const wanTypes = readConfig(process.env.WAN_TYPES_CONFIG_PATH);
const users = readConfig(process.env.USER_CONFIG_PATH);

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

async function getDeviceStatusCode(device) {
    let statusCode;
    try {
        let response = await axios.get(device.checkUrl, {
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
    return devices.find(device => device.id == String(id))
}


function getDeviceLanPortByID(vlanLocal) {
    const device = devices.find(device => String(device.vlanLocal) === String(vlanLocal));
    return device.switchPortLan
}   

function getParamRouter(id){
    const router = devices.find(device => String(device.id) === (String(id)))
    if (router){
        return{
        port: router.switchPortLan,
        vlan: router.vlanLocal};
    }
    else{
        return null
    }
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
