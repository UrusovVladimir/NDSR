import {Telnet} from "telnet-client"
import {getDeviceById} from "../devices.js";

export async function rebootDevice(deviceId) {
    let device = getDeviceById(deviceId)
    if (!device || !device.rebootPort)
        throw new Error('The device was not found or the parameters are incorrect')

    const connection = new Telnet()

    let JEROME_HOST = device.jeromeID == 1 ? process.env.JEROME_1_IP : process.env.JEROME_2_IP
    ///"это выражение как if, т.е "?" а после него присваивается значение уже переменной, если == 1 то будет JEROME_1_IP, если == 2 то  JEROME_2_IP"

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

    console.log('Reboot:', device.hwId)

    res = await connection.send(`$KE,WR,${device.rebootPort},0`, {ors: "\r\n"});
    console.log('ResultDown:', res)

    await new Promise((resolve) => setTimeout(resolve, 1000))

    res = await connection.send(`$KE,WR,${device.rebootPort},1`, {ors: "\r\n"});
    console.log('ResultUP:', res)

    await connection.end()
}
