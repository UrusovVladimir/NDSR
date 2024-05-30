import {Telnet} from "telnet-client"
import {getDeviceById, wanTypes} from "../devices.js";

export async function changeWanType(deviceId, checkedWanTypeIds) {

    let device = getDeviceById(deviceId)
    if (!device || !device.interfaceID || !device.consolePort)
        throw new Error('The device was not found or the parameters are incorrect')

    const connection = new Telnet()

    const params = {
        host: process.env.MOXA_IP,
        port: device.consolePort,
        negotiationMandatory: false,
        timeout: 3500,
        sendTimeout: 2500,
    }

    let res

    await connection.connect(params)
    await connection.send("\n");

    console.log('Connected to ' + device.hwId)

    res = await connection.exec('eula accept', {shellPrompt: /\(config\)[> ]/i});
    console.log('eula accept', res)

    let unSelectedWanTypes = wanTypes.filter(wan => !checkedWanTypeIds.includes(String(wan.vlanId)))

    for (let wan of unSelectedWanTypes) {
        let vlan = device.type === 'router' ? 'Vlan' + wan.vlanId : wan.vlanId
        for (let cmd of wan.offCommands) {
            cmd = cmd.replace(':interface_value:', `${device.interfaceID}/${vlan}`);
            res = await connection.send(cmd, {waitFor: /\(config\)[> ]/i});
            console.log(res)
        }
    }

    let selectedWanTypes = wanTypes.filter(wan => checkedWanTypeIds.includes(String(wan.vlanId)))

    if (selectedWanTypes.length) {

        for (let wan of selectedWanTypes) {
            let vlan = device.type === 'router' ? 'Vlan' + wan.vlanId : wan.vlanId
            let interfaceValue = `${device.interfaceID}/${vlan}`
            res = await connection.exec('interface ' + interfaceValue, {shellPrompt: /\(config-if\)[> ]/i});
            console.log('interface ' + interfaceValue, res)

            for (let cmd of wan.onCommands) {
                cmd = cmd.replace(':interface_value:', interfaceValue);
                res = await connection.exec(cmd, {shellPrompt: /\(config-if\)[> ]/i});
                console.log(cmd, res)
            }
        }

        res = await connection.exec('exit', {shellPrompt: /\(config\)[> ]/i});
        console.log('exit', res)
    }

    res = await connection.exec('system configuration save', {shellPrompt: /\(config\)[> ]/i});
    console.log('system configuration save', res)

    await connection.end()
}

