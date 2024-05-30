import {Telnet} from "telnet-client"
import {getDeviceById} from "/home/ndm-dev-rack-service/api/src/devices.js";

export async function resetDslLine(deviceId) {
    let device = getDeviceById(deviceId)
    if (!device || !device.dslPort)
        throw new Error('The device was not found or the parameters are incorrect')

    const connection = new Telnet()

    const params = {
        host: process.env.VES_IP,
        port: process.env.VES_PORT,
        timeout: 3500,
        sendTimeout: 2500,
        loginPrompt: 'User name: ',
        passwordPrompt: 'Password: ',
        username: process.env.VES_LOGIN,
        password: process.env.VES_PASSWORD,
        shellPrompt: 'ras> '
    }

    let res

    await connection.connect(params);

    console.log('Reset DSL Line for:', device.hwId)

    res = await connection.exec(`vdsl reset ${device.dslPort}`);

    console.log('Result:', 'ok ' + res)

    await new Promise((resolve) => setTimeout(resolve, 1000))

    await connection.end()
}
