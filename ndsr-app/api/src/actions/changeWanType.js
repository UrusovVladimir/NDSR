import {TelnetConnection} from "./telnetClassEthernet.js"
import { getManagmentID } from "./getManagmentID.js";
import {getDeviceById, getVlanId, wanTypes} from "../devices.js";

async function changeWanType(deviceId, wanData, universalPromptRegex) {
    const isDualWan = wanData && typeof wanData === 'object' && wanData.type === 'dual_wan'
    
    let device = getDeviceById(deviceId);
    let wanVlan = getVlanId();
    const IPs = process.env.SWITCH_WAN_IPs;
    const switchAddress = getManagmentID(IPs);
    const switchBaseUrl = switchAddress[device.switchIDWan];

    const connection = new TelnetConnection(switchBaseUrl, process.env.SWITCH_LOGIN, process.env.SWITCH_PASSWORD);
    await connection.connect();

    try {
        // Определяем команды
        let PVID = wanTypes.find(command => command.setting === "onVlanPVID");
        let VLAN = wanTypes.find(command => command.setting === "onVlanFixPort");
        let OFF_VLAN = wanTypes.find(command => command.setting === "offVlanFixPort");
        let OFF_PVID = wanTypes.find(command => command.setting === "offVlanPVID");
        
        if (!OFF_PVID) {
            console.log('⚠️ offVlanPVID не найден, использую onVlanPVID');
            OFF_PVID = PVID;
        }
        
        if (!PVID || !VLAN || !OFF_VLAN) {
            console.error('❌ Не найдены необходимые команды');
            throw new Error('Missing required commands configuration');
        }
        
        if (isDualWan) {
            console.log(`🔧 Настройка Dual WAN для устройства ${deviceId}`);
            console.log(`WAN 1: ${wanData.wan1}, WAN 2: ${wanData.wan2}`);
            
            // Настраиваем первый порт с обработкой переподключений
            await executeWithReconnect(
                connection,
                () => configureSingleWan(connection, device.switchPortWan, wanData.wan1, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN),
                `настройки порта ${device.switchPortWan}`
            );
            
            if (device.switchPortWanSecondary) {
                // Настраиваем второй порт с обработкой переподключений
                await executeWithReconnect(
                    connection,
                    () => configureSingleWan(connection, device.switchPortWanSecondary, wanData.wan2, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN),
                    `настройки порта ${device.switchPortWanSecondary}`
                );
            }
            
        } else if (wanData && wanData !== "4094") {
            // Одиночный WAN с обработкой переподключений
            await executeWithReconnect(
                connection,
                () => configureSingleWanLegacy(connection, device, wanData, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN),
                `настройки одиночного WAN`
            );
            
            if (device.switchPortWanSecondary) {
                await executeWithReconnect(
                    connection,
                    () => configureWanOff(connection, device.switchPortWanSecondary, wanVlan, universalPromptRegex, OFF_VLAN, OFF_PVID),
                    `отключения порта ${device.switchPortWanSecondary}`
                );
            }
            
        } else {
            // Выключение WAN с обработкой переподключений
            await executeWithReconnect(
                connection,
                () => configureWanOffLegacy(connection, device, wanVlan, universalPromptRegex, OFF_VLAN, OFF_PVID),
                `отключения WAN`
            );
            
            if (device.switchPortWanSecondary) {
                await executeWithReconnect(
                    connection,
                    () => configureWanOff(connection, device.switchPortWanSecondary, wanVlan, universalPromptRegex, OFF_VLAN, OFF_PVID),
                    `отключения порта ${device.switchPortWanSecondary}`
                );
            }
        }
    } catch (error) {
        console.error('❌ Ошибка при настройке WAN:', error.message);
        throw error;
    } finally {
        console.log("Завершаем соединение с коммутатором");
        try {
            await connection.executeCommand("exit", null, universalPromptRegex);
        } catch (e) {}
        await connection.end();
    }
}

// ✅ УНИВЕРСАЛЬНАЯ ФУНКЦИЯ ДЛЯ ВЫПОЛНЕНИЯ С ПЕРЕПОДКЛЮЧЕНИЕМ
async function executeWithReconnect(connection, operationFn, operationName) {
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
        try {
            attempts++;
            console.log(`🔄 Попытка ${attempts}/${maxAttempts} ${operationName}`);
            await operationFn();
            console.log(`✅ ${operationName} успешно завершена`);
            return;
        } catch (error) {
            console.error(`❌ Ошибка ${operationName} (попытка ${attempts}):`, error.message);
            
            if (error.message === 'RECONNECTED' && attempts < maxAttempts) {
                console.log(`🔄 Переподключение выполнено, повторяем ${operationName}...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }
            
            throw error;
        }
    }
}

// ✅ ФУНКЦИЯ ДЛЯ НАСТРОЙКИ ОДНОГО WAN (упрощенная версия для Dual WAN)
async function configureSingleWan(connection, port, vlanId, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN) {
    console.log(`🔧 Настройка порта ${port} на VLAN ${vlanId}`);
    
    let selectedWanTypes = wanTypes.filter(wan => String(wan.vlanId) === String(vlanId));
    let selectedWanType = selectedWanTypes[0];
    
    if (!selectedWanType) {
        throw new Error(`WAN type with VLAN ${vlanId} not found`);
    }
    
    let vlan = selectedWanType.vlanId;
    
    // Шаг 1: Вход в режим конфигурации
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    // Шаг 2: Очистка порта от всех VLAN
    for (let cmd of OFF_VLAN.commands) {
        for (let wan of wanVlan) {
            try {
                await connection.executeCommand("vlan", wan, universalPromptRegex);
                await connection.executeCommand(cmd, port, universalPromptRegex);
                await connection.executeCommand("exit", null, universalPromptRegex);
            } catch (error) {
                console.warn(`⚠️ Ошибка очистки VLAN ${wan}: ${error.message}`);
            }
        }
    }
    
    // Шаг 3: Настройка PVID
    for (let cmd of PVID.commands) {
        await connection.executeCommand(
            cmd, 
            cmd === 'interface port-channel' ? port : (cmd === 'pvid' ? vlan : null), 
            universalPromptRegex
        );
    }
    
    // Шаг 4: Активация порта
    await connection.executeCommand("no inactive", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    
    // Пауза для стабилизации
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Шаг 5: Повторный вход для настройки VLAN
    await connection.executeCommand('configure', null, universalPromptRegex);
    await connection.executeCommand("vlan", vlan, universalPromptRegex);
    
    // Шаг 6: fixed + untagged
    for (let cmd of VLAN.commands) {
        await connection.executeCommand(cmd, port, universalPromptRegex);
        console.log(`✅ ${cmd} ${port}`);
    }
    
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    
    console.log(`✅ Порт ${port} настроен: PVID=${vlan}, fixed+untagged`);
}

// ✅ ФУНКЦИЯ ДЛЯ ОДИНОЧНОГО WAN (сохраняем оригинальную логику)
async function configureSingleWanLegacy(connection, device, wanData, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN) {
    let selectedWanTypes = wanTypes.filter(wan => String(wan.vlanId) === String(wanData));
    let selectedWanType = selectedWanTypes[0];
    
    if (!selectedWanType) {
        throw new Error(`WAN type with VLAN ${wanData} not found`);
    }
    
    console.log("Выбрано", selectedWanType.type, "VLAN:", selectedWanType.vlanId);
    
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    // Очищаем порт от всех VLAN
    for (let cmd of OFF_VLAN.commands) {
        for (let wan of wanVlan) {
            await connection.executeCommand("vlan", wan, universalPromptRegex);
            await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
            await connection.executeCommand("exit", null, universalPromptRegex);
        }
    }
    
    let vlan = selectedWanType.vlanId;
    
    // Настраиваем PVID
    for (let cmd of PVID.commands) {
        await connection.executeCommand(cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? vlan : null), universalPromptRegex);
    }
    
    await connection.executeCommand("no inactive", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    
    // Заново входим в configure для VLAN
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    // Настраиваем VLAN
    await connection.executeCommand("vlan", vlan, universalPromptRegex);
    for (let cmd of VLAN.commands) {
        await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
    }
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
}

// ✅ ФУНКЦИЯ ДЛЯ ВЫКЛЮЧЕНИЯ WAN (сохраняем оригинальную логику)
async function configureWanOffLegacy(connection, device, wanVlan, universalPromptRegex, OFF_VLAN, PVID) {
    console.log(`Выключение WAN для устройства`);
    
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    // Очищаем порт от всех VLAN
    for (let cmd of OFF_VLAN.commands) {
        for (let wan of wanVlan) {
            await connection.executeCommand("vlan", wan, universalPromptRegex);
            await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
            await connection.executeCommand("exit", null, universalPromptRegex);
        }
    }
    
    let fakeVlan = "4094";
    for (let cmd of PVID.commands) {
        await connection.executeCommand(cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? fakeVlan : null), universalPromptRegex);
    }
    
    await connection.executeCommand("inactive", null, universalPromptRegex);
    console.log(`✅ Порт ${device.switchPortWan} деактивирован`);
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
}

// Отключение WAN порта
async function configureWanOff(connection, port, wanVlan, universalPromptRegex, OFF_VLAN, PVID) {
    console.log(`🔧 Отключение порта ${port}`);
    
    let fakeVlan = "4094";
    
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    for (let cmd of OFF_VLAN.commands) {
        for (let wan of wanVlan) {
            try {
                await connection.executeCommand("vlan", wan, universalPromptRegex);
                await connection.executeCommand(cmd, port, universalPromptRegex);
                await connection.executeCommand("exit", null, universalPromptRegex);
            } catch (error) {
                console.warn(`⚠️ Ошибка очистки VLAN ${wan}: ${error.message}`);
            }
        }
    }
    
    for (let cmd of PVID.commands) {
        await connection.executeCommand(cmd, cmd === 'interface port-channel' ? port : (cmd === 'pvid' ? fakeVlan : null), universalPromptRegex);
    }
    
    await connection.executeCommand("inactive", null, universalPromptRegex);
    console.log(`✅ Порт ${port} деактивирован`);
    
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
}

export {
    changeWanType
}