import {TelnetConnection} from "./telnetClassEthernet.js"
import { getManagmentID } from "./getManagmentID.js";
import {getDeviceById, getVlanId, wanTypes} from "../devices.js";


async function changeWanType(deviceId, checkedWanTypeIds, universalPromptRegex) {
    let selectedWanTypes = wanTypes.filter(wan => checkedWanTypeIds === String(wan.vlanId));
    let PVID = wanTypes.find(command => "onVlanPVID" === command.setting);
    let VLAN = wanTypes.find(command => "onVlanFixPort" === command.setting);
    let OFF_VLAN = wanTypes.find(command => "offVlanFixPort" === command.setting);
    let device = getDeviceById(deviceId);
    let wanVlan = getVlanId();
    const IPs = process.env.SWITCH_WAN_IPs;
    const switchAddress = getManagmentID(IPs);
    const switchBaseUrl = switchAddress[device.switchIDWan];

    const connection = new TelnetConnection(switchBaseUrl, process.env.SWITCH_LOGIN, process.env.SWITCH_PASSWORD);

    let res;
    await connection.connect();

    // ✅ ИСПРАВЛЕНИЕ: Берем первый элемент массива
    let selectedWanType = selectedWanTypes[0];
    
    if (selectedWanType && selectedWanType.vlanId !== "4094") {
        console.log("Выбрано", selectedWanType);
        await connection.executeCommand('configure', null, universalPromptRegex);
        
        for (let cmd of OFF_VLAN.commands) {
            for (let wan of wanVlan) {
                await connection.executeCommand("vlan", wan, universalPromptRegex);
                await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
                await connection.executeCommand("exit", null, universalPromptRegex);
            }
        }
        
        let vlan = selectedWanType.vlanId; // ✅ Используем selectedWanType, а не selectedWanTypes
        console.log("vlan выбран", vlan);
        
        for (let cmd of PVID.commands) {
            await connection.executeCommand(cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? vlan : null), universalPromptRegex);
        }
        
        // ✅ ЭТОТ БЛОК НИКОГДА НЕ ВЫПОЛНЯЛСЯ, потому что условие было неправильным
        if (selectedWanType.vlanId === "4094") {
            await connection.executeCommand("inactive", null, universalPromptRegex);
        }
        
        await connection.executeCommand("no inactive", null, universalPromptRegex);
        await connection.executeCommand("exit", null, universalPromptRegex);
        await connection.executeCommand("vlan", vlan, universalPromptRegex);
        
        for (let cmd of VLAN.commands) {
            await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
        }
    } else {
        console.error(`No WAN types matching the given VLAN IDs found. Applying fake vlan`);
        let OFF_PVID = wanTypes.find(command => "offVlanPVID" === command.setting);
        await connection.executeCommand('configure', null, universalPromptRegex);
        
        for (let cmd of OFF_PVID.commands) {
            let fakeVlan = "4094";
            await connection.executeCommand(cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? fakeVlan : null), universalPromptRegex);
        }
        
        // ✅ КОМАНДА inactive ДОЛЖНА ВЫПОЛНИТЬСЯ ЗДЕСЬ
        await connection.executeCommand("inactive", null, universalPromptRegex);
        await connection.executeCommand("exit", null, universalPromptRegex);
        
        for (let cmd of OFF_VLAN.commands) {
            for (let wan of wanVlan) {
                await connection.executeCommand("vlan", wan, universalPromptRegex);
                await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
                await connection.executeCommand("exit", null, universalPromptRegex);
            }
        }
    }

    console.log("Завершаем соединение с коммутатором");
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.end();
}

 export{
    changeWanType
 }
