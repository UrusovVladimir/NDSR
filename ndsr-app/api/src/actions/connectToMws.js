import {TelnetConnection} from "./telnetClassEthernet.js"
import {getParamRouter, devices, wanTypes} from "../devices.js";
import { getManagmentID } from "./getManagmentID.js";

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ - ПРИНИМАЕТ ОБЪЕКТ ДАННЫХ
async function connectToMws(data, universalPromptRegex) {
    // ✅ ОБЪЯВЛЯЕМ connection ВНЕ try блока
    let connection = null;
    
    try {
        const { 
            deviceId, 
            routerId, 
            action, 
            routerPassword, 
            useDevicePassword = true 
        } = data;

        console.log("🔗 MWS Connection Parameters (new format):", { 
            deviceId, 
            routerId, 
            action,
            hasRouterPassword: !!routerPassword,
            useDevicePassword
        });

        // ✅ ПОЛУЧАЕМ УСТРОЙСТВА С ПРОВЕРКОЙ
        const extender = devices.find(extender => String(extender.id) === String(deviceId));
        const router = getParamRouter(routerId);

        if (!extender) {
            throw new Error(`Extender with ID ${deviceId} not found`);
        }
        if (!router) {
            throw new Error(`Router with ID ${routerId} not found`);
        }

        // ✅ ПРОВЕРКА И УСТАНОВКА ЗНАЧЕНИЙ ПО УМОЛЧАНИЮ
        if (!router.vlanLocal) {
            console.warn('⚠️ Router missing vlanLocal property, using default value');
            router.vlanLocal = '100';
        }
        if (!extender.vlanLocal) {
            console.warn('⚠️ Extender missing vlanLocal property, using default value');
            extender.vlanLocal = '200';
        }

        let PVID = wanTypes.find(command => "onVlanPVID" === command.setting);
        let VLAN_ACCESS = wanTypes.find(command => "onVlanFixPort" === command.setting);
        let VLAN_TRUNKING = wanTypes.find(command => "VlanTrunking" === command.setting);
        let lanVlan = router.vlanLocal;
        let PORTS = [extender.switchPortLan, router.port];
        
        const IPs = process.env.SWITCH_IPs;
        const switchAddress = getManagmentID(IPs);
        const switchBaseUrl = switchAddress[extender.switchID];
        
        // ✅ СОЗДАЕМ СОЕДИНЕНИЕ
        connection = new TelnetConnection(switchBaseUrl, process.env.SWITCH_LOGIN, process.env.SWITCH_PASSWORD);
        
        console.log("🔗 MWS Connection Details:", { 
            extender: extender.hwId, 
            router: router.hwId, 
            action: action,
            extenderVlan: extender.vlanLocal,
            routerVlan: router.vlanLocal,
            switch: switchBaseUrl,
            ports: PORTS
        });

        await connection.connect();

        // ✅ ВХОДИМ В РЕЖИМ КОНФИГУРАЦИИ ОДИН РАЗ
        await connection.executeCommand('configure', null, universalPromptRegex);

        // ✅ ОПРЕДЕЛЯЕМ ТИП ОПЕРАЦИИ НА ОСНОВЕ ACTION
        const isDisconnect = action === 'disconnect';
        const isExtenderDisconnect = action === 'extender_disconnect';

        if (isDisconnect) {
            console.log(`🔗 DISCONNECT: Applying fake VLAN 4094 to port ${extender.switchPortLan}`, `Router VLAN: ${router.vlanLocal}`);

            let OFF_PVID = wanTypes.find(command => "offVlanPVID" === command.setting);
            
            // ✅ ПРИМЕНЯЕМ КОМАНДЫ ДЛЯ ОТКЛЮЧЕНИЯ
            for (let cmd of OFF_PVID.commands) {
                let param = null;
                if (cmd === 'interface port-channel') {
                    param = extender.switchPortLan;
                } else if (cmd === 'pvid') {
                    param = "4094"; // Fake VLAN
                }
                console.log(`➡️ Executing: ${cmd} ${param || ''}`);
                await connection.executeCommand(cmd, param, universalPromptRegex);
            }
            
            console.log(`🔧 Убираем порт ${extender.switchPortLan} из VLAN роутера ${router.vlanLocal}`);
            await connection.executeCommand("exit", null, universalPromptRegex);
            await connection.executeCommand("vlan", router.vlanLocal, universalPromptRegex);
            await connection.executeCommand("forbidden", extender.switchPortLan, universalPromptRegex);
            await new Promise(resolve => setTimeout(resolve, 500));
            

        } else if (isExtenderDisconnect) {
            console.log(`🔗 EXTENDER DISCONNECT: Applying device VLAN ${extender.vlanLocal} to port ${extender.switchPortLan}`);
            
            let OFF_PVID = wanTypes.find(command => "offVlanPVID" === command.setting);
            
            for (let cmd of OFF_PVID.commands) {
                let param = null;
                if (cmd === 'interface port-channel') {
                    param = extender.switchPortLan;
                } else if (cmd === 'pvid') {
                    param = extender.vlanLocal;
                }
                console.log(`➡️ Executing: ${cmd} ${param || ''}`);
                await connection.executeCommand(cmd, param, universalPromptRegex);
            }
            
        } else {
            // ✅ ПОДКЛЮЧЕНИЕ
            console.log(`🔗 CONNECT: Applying router VLAN ${lanVlan} to ports ${PORTS.join(', ')}`);
            
            // 1. Настройка PVID для порта экстендера
            console.log("📋 Applying PVID commands:");
            for (let cmd of PVID.commands) {
                let param = null;
                if (cmd === 'interface port-channel') {
                    param = extender.switchPortLan;
                } else if (cmd === 'pvid') {
                    param = lanVlan;
                }
                console.log(`➡️ PVID: ${cmd} ${param || ''}`);
                await connection.executeCommand(cmd, param, universalPromptRegex);
            }

            // 2. Выходим из интерфейса перед настройкой VLAN
            await connection.executeCommand("exit", null, universalPromptRegex);

            // 3. Настройка VLAN access
            console.log("📋 Applying VLAN Access commands:");
            await connection.executeCommand("vlan", lanVlan, universalPromptRegex);
            for (let cmd of VLAN_ACCESS.commands) {
                console.log(`➡️ VLAN Access: ${cmd} ${extender.switchPortLan}`);
                await connection.executeCommand(cmd, extender.switchPortLan, universalPromptRegex);
            }
            await connection.executeCommand("exit", null, universalPromptRegex);

            // 4. Настройка VLAN trunking для всех портов
            console.log("📋 Applying VLAN Trunking commands:");
            for (let port of PORTS) {
                await connection.executeCommand("vlan", lanVlan, universalPromptRegex);
                for (let cmd of VLAN_TRUNKING.commands) {
                    let param = null;
                    if (cmd === 'interface port-channel') {
                        param = port;
                    }
                    console.log(`➡️ VLAN Trunking: ${cmd} ${param || ''} (port: ${port})`);
                    await connection.executeCommand(cmd, param, universalPromptRegex);
                }
                await connection.executeCommand("exit", null, universalPromptRegex);
            }
        }

        // ✅ ВЫХОДИМ ИЗ РЕЖИМА КОНФИГУРАЦИИ
        await connection.executeCommand("exit", null, universalPromptRegex);
        
        console.log("✅ MWS operation completed successfully");

    } catch (error) {
        console.error('❌ MWS Connection Error:', error);
        throw error;
    } finally {
        // ✅ ГАРАНТИРОВАННОЕ ЗАКРЫТИЕ СОЕДИНЕНИЯ С ПРОВЕРКОЙ
        if (connection) {
            try {
                await connection.end();
                console.log("🔒 Connection closed successfully");
            } catch (closeError) {
                console.warn("⚠️ Error closing connection:", closeError.message);
            }
        }
    }
}

export {
    connectToMws
}