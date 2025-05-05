import {Telnet} from "telnet-client"
import {getDeviceById} from "../devices.js";

export async function resetConfig(deviceId) {
    let device = getDeviceById(deviceId)
    if (!device || !device.resetPort)
        throw new Error('The device was not found or the parameters are incorrect')

    const connection = new Telnet()

    let JEROME_HOST = device.jeromeID == 1 ? process.env.JEROME_1_IP : process.env.JEROME_2_IP

    const params = {
        host: JEROME_HOST,
        port: process.env.JEROME_PORT,
        negotiationMandatory: false,
        timeout: 3500,
        sendTimeout: 2500,
    }

    let res

    await connection.connect(params);
    await connection.send("\n", {ors: "\r\n"});

    console.log('Reset:', device.hwId)

    res = await connection.send(`$KE,WR,${device.resetPort},1`, {ors: "\r\n"});
    console.log('ResultDown:', res)

    await new Promise((resolve) => setTimeout(resolve, 10000))

    res = await connection.send(`$KE,WR,${device.resetPort},0`, {ors: "\r\n"});
    console.log('ResultUP:', res)

    await connection.end()
}
