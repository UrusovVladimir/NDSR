import { SSHManager } from "../actions/sshManager.js";
import { UniversalFirewallManager } from "./UniversalFirewallManager.js";
import { DockerManager } from "./dockerManager.js";
import { HOST_CONFIG } from "./hostConfig.js";
import { getDeviceById, getParamRouter, wanTypes } from "../devices.js";
import { getManagmentID } from "../actions/getManagmentID.js";
import { TelnetConnection } from "../actions/telnetClassEthernet.js";
import { makeAuthenticatedRequest } from "../actions/athentication.js";


const universalPromptRegex = /.*[# ]/i;

export class DisconnectManager {
    /**
     * ПРАВИЛЬНЫЙ порядок отключения extender'а
     */
    static async fullDisconnect(deviceId, routerId, devicePassword = null) {
        let sshManager = null;
        
        try {
            console.log(`🔧 Полное отключение extender'а ${deviceId} от роутера ${routerId}`);
            
            const device = getDeviceById(deviceId);
            const router = getParamRouter(routerId);
            
            if (!device || !router) {
                throw new Error(`Устройство или роутер не найдены`);
            }

            console.log(`📋 Device info:`, {
                id: device.id,
                URL: device.URL,
                macAddress: device.macAddress,
                vlanLocal: device.vlanLocal,
                switchPortLan: device.switchPortLan
            });

            console.log(`📋 Router info:`, {
                id: router.id,
                vlanLocal: router.vlanLocal,
                switchPortLan: router.switchPortLan
            });

            // ✅ ПРАВИЛЬНЫЙ ПОРЯДОК:

            // ✅ ШАГ 1: СНАЧАЛА ОТПРАВЛЯЕМ КОМАНДУ СМЕНЫ РЕЖИМА
            console.log(`🔄 ШАГ 1: Отправляем команду смены режима на устройство...`);
            await this.sendModeChangeCommand(device, devicePassword);
            
            // ✅ ШАГ 2: ЖДЕМ ГАРАНТИРОВАННОГО ПОЛУЧЕНИЯ КОМАНДЫ
            console.log(`⏳ ШАГ 2: Ждем гарантированного получения команды устройством... (15 секунд)`);
            await new Promise(resolve => setTimeout(resolve, 15000));

            // ✅ ШАГ 3: ПЕРЕНАСТРАИВАЕМ СВИЧ (РАСКОММЕНТИРОВАТЬ!)
            console.log(`🔧 ШАГ 3: Перенастраиваем свич...`);
            await this.reconfigureSwitchWithLocalVlan(deviceId, routerId);

            // ✅ ШАГ 4: УДАЛЯЕМ ФАЕРВОЛ ПРАВИЛА
            console.log(`🔧 ШАГ 4: Удаляем фаервол правила...`);
            await this.removeIptablesRulesOnly(deviceId, routerId);

            // ✅ ШАГ 5: ЖДЕМ ПОЛНОЙ ПЕРЕЗАГРУЗКИ УСТРОЙСТВА
            console.log(`⏳ ШАГ 5: Ожидаем полной перезагрузки устройства...`);
            await this.verifyDeviceAvailability(deviceId, 20, 15000);

            console.log(`✅ Полное отключение extender'а ${deviceId} завершено`);

        } catch (error) {
            console.error(`❌ Ошибка при полном отключении:`, error);
            throw error;
        }
    }

    /**
     * Улучшенная отправка команды с проверкой доставки
     */
    static async sendModeChangeCommand(device, password = null) {
        try {
            console.log(`🔧 Отправка команды смены режима на устройство ${device.id}`);
            
            if (!device.URL && !device.url) {
                throw new Error(`URL устройства ${device.id} не найден`);
            }

            const deviceUrl = device.URL || device.url;
            
            if (!password) {
                throw new Error(`Пароль устройства не указан для смены режима`);
            }

            console.log(`🔧 Используем URL: ${deviceUrl}`);

            // ✅ ДВОЙНАЯ ПРОВЕРКА ДОСТУПНОСТИ
            console.log(`🔍 Проверяем доступность устройства перед отправкой команды...`);
            const isAccessible = await this.simpleAvailabilityCheck(deviceUrl);
            if (!isAccessible) {
                throw new Error(`Устройство ${device.id} недоступно перед отправкой команды`);
            }
            console.log(`✅ Устройство доступно, отправляем команды...`);

            // ✅ ОТПРАВЛЯЕМ КОМАНДУ СМЕНЫ РЕЖИМА С ПОВТОРЕНИЕМ
            console.log(`🔄 Отправка команды смены режима...`);
            let changeResult;
            try {
                changeResult = await makeAuthenticatedRequest(
                    deviceUrl,
                    'admin',
                    password,
                    '/rci/system/mode',
                    'POST',
                    { mode: 'router' }
                );
                console.log(`✅ Команда смены режима отправлена:`, changeResult);
            } catch (error) {
                console.warn(`⚠️ Первая попытка отправки не удалась: ${error.message}`);
                console.log(`🔄 Повторная отправка команды смены режима...`);
                // Повторная попытка
                await new Promise(resolve => setTimeout(resolve, 3000));
                changeResult = await makeAuthenticatedRequest(
                    deviceUrl,
                    'admin',
                    password,
                    '/rci/system/mode',
                    'POST',
                    { mode: 'router' }
                );
                console.log(`✅ Команда смены режима отправлена (повторно):`, changeResult);
            }

            // ✅ КОРОТКАЯ ПАУЗА МЕЖДУ КОМАНДАМИ
            await new Promise(resolve => setTimeout(resolve, 2000));

            // ✅ ОТПРАВЛЯЕМ КОМАНДУ ПЕРЕЗАГРУЗКИ С ПОВТОРЕНИЕМ
            console.log(`🔄 Отправка команды перезагрузки...`);
            let rebootResult;
            try {
                rebootResult = await makeAuthenticatedRequest(
                    deviceUrl,
                    'admin',
                    password,
                    '/rci/system/reboot', 
                    'POST',
                    {}
                );
                console.log(`✅ Команда перезагрузки отправлена:`, rebootResult);
            } catch (error) {
                console.warn(`⚠️ Первая попытка перезагрузки не удалась: ${error.message}`);
                console.log(`🔄 Повторная отправка команды перезагрузки...`);
                // Повторная попытка
                await new Promise(resolve => setTimeout(resolve, 3000));
                rebootResult = await makeAuthenticatedRequest(
                    deviceUrl,
                    'admin',
                    password,
                    '/rci/system/reboot', 
                    'POST',
                    {}
                );
                console.log(`✅ Команда перезагрузки отправлена (повторно):`, rebootResult);
            }

            // ✅ ПРОВЕРЯЕМ ЧТО КОМАНДЫ УСПЕШНО ОТПРАВЛЕНЫ
            console.log(`📋 Итог отправки команд:`);
            console.log(`   - Смена режима: ${changeResult ? 'Успешно' : 'Ошибка'}`);
            console.log(`   - Перезагрузка: ${rebootResult ? 'Успешно' : 'Ошибка'}`);

            return { changeResult, rebootResult };

        } catch (error) {
            console.error(`❌ Критическая ошибка отправки команды смены режима:`, error);
            throw new Error(`Не удалось отправить команды на устройство: ${error.message}`);
        }
    }

    static async reconfigureSwitchWithLocalVlan(deviceId, routerId) {
        try {
            console.log(`🔧 Перенастройка свича для отключения экстендера ${deviceId} от роутера ${routerId}`);
            
            const device = getDeviceById(deviceId);
            if (!device) {
                throw new Error(`Устройство ${deviceId} не найдено`);
            }
            const router = getParamRouter(routerId);
            if (!router) {
                throw new Error(`Роутер ${routerId} недоступен или не найден`);
            }
    
            // Получаем команды для настройки VLAN
            let ON_PVID = wanTypes.find(command => "onVlanPVID" === command.setting);
            let OFF_VLAN_FIX_PORT = wanTypes.find(command => "offVlanFixPort" === command.setting);
            
            if (!ON_PVID || !OFF_VLAN_FIX_PORT) {
                throw new Error('Не найдены команды для настройки VLAN');
            }
    
            const deviceVlanLocal = device.vlanLocal;
            const routerVlanLocal = router.vlanLocal;
            const deviceSwitchPort = device.switchPortLan;
            
            console.log(`🔧 Настройка отключения:`);
            console.log(`   - Устройство ${deviceId}: порт ${deviceSwitchPort} -> VLAN ${deviceVlanLocal}`);
            console.log(`   - Роутер ${routerId}: убираем порт ${deviceSwitchPort} из VLAN ${routerVlanLocal}`);
    
            const IPs = process.env.SWITCH_IPs;
            const switchAddress = getManagmentID(IPs);
            
            // ✅ ПРОВЕРЯЕМ НАХОДЯТСЯ ЛИ УСТРОЙСТВО И РОУТЕР НА ОДНОМ СВИТЧЕ
            const switchBaseUrlDevice = switchAddress[device.switchID];
            const switchBaseUrlRouter = switchAddress[router.switchID];
            
            console.log(`🔍 Проверка расположения устройств:`);
            console.log(`   - Свич устройства: ${switchBaseUrlDevice}`);
            console.log(`   - Свич роутера: ${switchBaseUrlRouter}`);
            console.log(`   - На одном свитче: ${switchBaseUrlDevice === switchBaseUrlRouter}`);
    
            if (switchBaseUrlDevice === switchBaseUrlRouter) {
                // ✅ ВАРИАНТ 1: УСТРОЙСТВО И РОУТЕР НА ОДНОМ СВИТЧЕ
                console.log(`🔧 Устройство и роутер на одном свитче, выполняем все операции за одно подключение`);
                
                const connection = new TelnetConnection(switchBaseUrlDevice, process.env.SWITCH_LOGIN, process.env.SWITCH_PASSWORD);
                await connection.connect();
    
                try {
                    await connection.executeCommand('configure', null, universalPromptRegex);
                    
                    // 1. Настраиваем порт устройства на его VLAN
                    console.log(`🔧 Настраиваем порт ${deviceSwitchPort} на VLAN устройства ${deviceVlanLocal}`);
                    
                    for (let cmd of ON_PVID.commands) {
                        console.log(`   → ${cmd}`);
                        if (cmd === "interface port-channel") {
                            await connection.executeCommand(cmd, deviceSwitchPort, universalPromptRegex);
                        } else if (cmd === "pvid") {
                            console.log(`🔧 PVID на порту: ${deviceVlanLocal}`);
                            await connection.executeCommand(cmd, deviceVlanLocal, universalPromptRegex);
                            await connection.executeCommand(cmd, null, universalPromptRegex);
                        } else {
                            await connection.executeCommand('exit', null, universalPromptRegex);
                        }
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    await connection.executeCommand("exit", null, universalPromptRegex);
    
                    // 2. Убираем порт из VLAN роутера
                    console.log(`🔧 Убираем порт ${deviceSwitchPort} из VLAN роутера ${routerVlanLocal}`);
                    await connection.executeCommand("vlan", routerVlanLocal, universalPromptRegex);
                    
                    for (let cmd of OFF_VLAN_FIX_PORT.commands) {
                        console.log(`   → ${cmd}`);
                        if (cmd === "forbidden") {
                            await connection.executeCommand(cmd, deviceSwitchPort, universalPromptRegex);
                        } else {
                            await connection.executeCommand(cmd, deviceSwitchPort, universalPromptRegex);
                        }
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
    
                    console.log(`✅ На одном свитче: порт ${deviceSwitchPort} настроен на VLAN ${deviceVlanLocal} и убран из VLAN ${routerVlanLocal}`);
    
                } finally {
                    await connection.end();
                }
            } else {
                // ✅ ВАРИАНТ 2: УСТРОЙСТВО И РОУТЕР НА РАЗНЫХ СВИТЧАХ
                console.log(`🔧 Устройство и роутер на разных свитчах, выполняем операции последовательно`);
                
                // ✅ ШАГ 1: СНАЧАЛА НАСТРАИВАЕМ СВИЧ УСТРОЙСТВА
                if (switchBaseUrlDevice) {
                    console.log(`🔧 Настраиваем свич устройства: ${switchBaseUrlDevice}`);
                    const connectionDevice = new TelnetConnection(switchBaseUrlDevice, process.env.SWITCH_LOGIN, process.env.SWITCH_PASSWORD);
                    await connectionDevice.connect();
    
                    try {
                        await connectionDevice.executeCommand('configure', null, universalPromptRegex);
                        
                        // Настраиваем порт устройства на его собственный VLAN
                        console.log(`🔧 Настраиваем порт ${deviceSwitchPort} на VLAN устройства ${deviceVlanLocal}`);
                        
                        for (let cmd of ON_PVID.commands) {
                            console.log(`   → ${cmd}`);
                            if (cmd === "interface port-channel") {
                                await connectionDevice.executeCommand(cmd, deviceSwitchPort, universalPromptRegex);
                            } else if (cmd === "pvid") {
                                console.log(`🔧 PVID на порту: ${deviceVlanLocal}`);
                                await connectionDevice.executeCommand(cmd, deviceVlanLocal, universalPromptRegex);
                            } else {
                                await connectionDevice.executeCommand(cmd, null, universalPromptRegex);
                            }
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
    
                        console.log(`✅ Порт ${deviceSwitchPort} настроен на VLAN устройства ${deviceVlanLocal}`);
    
                    } finally {
                        await connectionDevice.end();
                    }
                }
    
                // ✅ ШАГ 2: ПОТОМ НАСТРАИВАЕМ СВИЧ РОУТЕРА
                if (switchBaseUrlRouter) {
                    console.log(`🔧 Настраиваем свич роутера: ${switchBaseUrlRouter}`);
                    const connectionRouter = new TelnetConnection(switchBaseUrlRouter, process.env.SWITCH_LOGIN, process.env.SWITCH_PASSWORD);
                    await connectionRouter.connect();
    
                    try {
                        // Убираем порт устройства из VLAN роутера
                        console.log(`🔧 Убираем порт ${deviceSwitchPort} из VLAN роутера ${routerVlanLocal}`);
                        
                        // Входим в режим vlan
                        await connectionRouter.executeCommand("vlan", routerVlanLocal, universalPromptRegex);
                        
                        for (let cmd of OFF_VLAN_FIX_PORT.commands) {
                            console.log(`   → ${cmd}`);
                            if (cmd === "forbidden") {
                                await connectionRouter.executeCommand(cmd, deviceSwitchPort, universalPromptRegex);
                            } else {
                                await connectionRouter.executeCommand(cmd, deviceSwitchPort, universalPromptRegex);
                            }
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
    
                        await connectionRouter.executeCommand("exit", null, universalPromptRegex);
    
                        console.log(`✅ Порт ${deviceSwitchPort} убран из VLAN роутера ${routerVlanLocal}`);
    
                    } finally {
                        await connectionRouter.end();
                    }
                }
            }
    
            // Ждем применения конфигурации
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log(`✅ Перенастройка свича завершена для отключения экстендера`);
    
        } catch (error) {
            console.error(`❌ Ошибка перенастройки свича:`, error);
            throw error;
        }
    }
static async verifyDeviceAvailability(deviceId, maxAttempts = 20, delay = 15000) {
    const device = getDeviceById(deviceId);
    if (!device) {
        throw new Error(`Устройство ${deviceId} не найдено`);
    }

    const deviceUrl = device.URL || device.url;
    
    console.log(`⏳ Ожидание доступности устройства ${deviceId} (${deviceUrl})...`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`🔍 Попытка ${attempt}/${maxAttempts}: проверка доступности...`);
            
            const isAccessible = await this.simpleAvailabilityCheck(deviceUrl);
            if (isAccessible) {
                console.log(`✅ Устройство ${deviceId} доступно! (попытка ${attempt}/${maxAttempts})`);
                return true;
            }
            
            console.log(`⌛ Устройство еще не доступно...`);
            
        } catch (error) {
            console.log(`⚠️ Ошибка проверки доступности: ${error.message}`);
        }

        if (attempt === maxAttempts) {
            throw new Error(`Устройство ${deviceId} не стало доступным после ${maxAttempts} попыток`);
        }

        const timeRemaining = ((maxAttempts - attempt) * delay) / 60000;
        console.log(`💤 Ожидание ${delay/1000} сек... (осталось ~${timeRemaining.toFixed(1)} мин)`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

/**
 * Простая проверка доступности устройства
 */
static async simpleAvailabilityCheck(url) {
    try {
        const response = await fetch(url, {
            method: 'GET',
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}
static async removeIptablesRulesOnly(deviceId, routerId) {
    let sshManager = null;
    
    try {
        console.log(`🔧 Удаление iptables правил для устройства ${deviceId} и роутера ${routerId}`);
        
        const device = getDeviceById(deviceId);
        const router = getParamRouter(routerId);
        
        if (!device || !router) {
            throw new Error(`Устройство или роутер не найдены`);
        }

        console.log(`📋 Параметры подключения:`, {
            host: HOST_CONFIG.mainHost.host,
            port: HOST_CONFIG.mainHost.port,
            username: HOST_CONFIG.mainHost.username
        });

        // ✅ ПОДКЛЮЧАЕМСЯ ПО SSH
        sshManager = new SSHManager(
            HOST_CONFIG.mainHost.host,
            HOST_CONFIG.mainHost.port,
            HOST_CONFIG.mainHost.username,
            HOST_CONFIG.mainHost.privateKeyPath
        );
        
        await sshManager.connect();
        console.log(`✅ SSH подключение установлено`);
        
        // ✅ ИНИЦИАЛИЗИРУЕМ DOCKER MANAGER
        const dockerManager = new DockerManager(sshManager);
        console.log(`✅ DockerManager инициализирован`);

        // ✅ УДАЛЯЕМ ПРАВИЛА ПРОБРОСА ПОРТОВ
        console.log(`🔧 Запускаем removePortForwarding...`);
        await dockerManager.removePortForwarding(deviceId, routerId);
        
        console.log(`✅ Правила проброса портов удалены для устройства ${deviceId}`);

    } catch (error) {
        console.error(`❌ Ошибка удаления iptables правил:`, error);
        throw error;
    } finally {
        if (sshManager) {
            sshManager.disconnect();
            console.log(`🔧 SSH подключение закрыто`);
        }
    }
}
}