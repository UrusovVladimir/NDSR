import {readConfig} from "./actions/readConfig.js";
import axios from "axios";

const STATUS_CHECK_TIMEOUT = process.env.STATUS_CHECK_TIMEOUT * 1000
const devices = readConfig(process.env.DEVICES_CONFIG_PATH);
const wanTypes = readConfig(process.env.WAN_TYPES_CONFIG_PATH);

// Response: [{device.URL: status-code}, ...]
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

export {
    devices,
    wanTypes,
    getDevicesStatus,
    getDeviceStatusCode,
    getDeviceById,
}
