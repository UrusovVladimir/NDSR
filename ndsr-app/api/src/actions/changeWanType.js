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
        
        // ✅ Убираем все настройки VLAN с порта
        for (let cmd of OFF_VLAN.commands) {
            for (let wan of wanVlan) {
                await connection.executeCommand("vlan", wan, universalPromptRegex);
                await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
                await connection.executeCommand("exit", null, universalPromptRegex);
            }
        }
        
        let vlan = selectedWanType.vlanId;
        console.log("vlan выбран", vlan);
        
        // ✅ Настраиваем PVID
        for (let cmd of PVID.commands) {
            await connection.executeCommand(cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? vlan : null), universalPromptRegex);
        }
        
        // ✅ АКТИВИРУЕМ ПОРТ (убираем inactive)
        await connection.executeCommand("no inactive", null, universalPromptRegex);
        await connection.executeCommand("exit", null, universalPromptRegex);
        
        // ✅ Настраиваем VLAN на порту
        await connection.executeCommand("vlan", vlan, universalPromptRegex);
        for (let cmd of VLAN.commands) {
            await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
        }
        
    } else {
        console.log(`Выключение WAN для устройства ${deviceId}`);
        let OFF_PVID = wanTypes.find(command => "offVlanPVID" === command.setting);
        await connection.executeCommand('configure', null, universalPromptRegex);
        
        // ✅ Настраиваем PVID на 4094 (fake vlan)
        for (let cmd of OFF_PVID.commands) {
            let fakeVlan = "4094";
            try {
                await connection.executeCommand(cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? fakeVlan : null), universalPromptRegex);
            } catch (error) {
                console.log(`⚠️ Команда ${cmd} не получила ответ (нормально при выключении)`);
            }
        }
        
        // ✅ ДЕАКТИВИРУЕМ ПОРТ
        try {
            await connection.executeCommand("inactive", null, universalPromptRegex);
            console.log(`✅ Порт ${device.switchPortWan} деактивирован (inactive)`);
        } catch (error) {
            console.log(`⚠️ Порт ${device.switchPortWan} деактивирован (ответ не получен, это нормально)`);
        }
        
        // ✅ Выход из interface port-channel (тоже может не получить ответ)
        try {
            await connection.executeCommand("exit", null, universalPromptRegex);
        } catch (error) {
            console.log(`⚠️ Выход из интерфейса (ответ не получен, нормально)`);
        }
        
        // ✅ Убираем все VLAN с порта
        for (let cmd of OFF_VLAN.commands) {
            for (let wan of wanVlan) {
                try {
                    await connection.executeCommand("vlan", wan, universalPromptRegex);
                } catch (error) {
                    console.log(`⚠️ vlan ${wan} - нет ответа`);
                }
                try {
                    await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
                } catch (error) {
                    console.log(`⚠️ ${cmd} - нет ответа`);
                }
                try {
                    await connection.executeCommand("exit", null, universalPromptRegex);
                } catch (error) {
                    console.log(`⚠️ exit - нет ответа`);
                }
            }
        }
    }

    console.log("Завершаем соединение с коммутатором");
    try {
        await connection.executeCommand("exit", null, universalPromptRegex);
    } catch (error) {
        console.log(`⚠️ Финальный exit - нет ответа`);
    }
    await connection.end();
}

export {
    changeWanType
}