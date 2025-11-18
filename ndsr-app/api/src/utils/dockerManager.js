import { UniversalFirewallManager } from './UniversalFirewallManager.js';
import { getParamRouter } from '../devices.js';
import { makeAuthenticatedRequest } from '../actions/athentication.js';
import { SSHManager } from '../actions/sshManager.js';
const globalExtenderIps = new Map();
const globalRouterIps = new Map();

export class DockerManager {
    constructor(sshManager) {  // ✅ меняем на маленькую букву
        if (!sshManager) {
            throw new Error('SSHManager is required for DockerManager');
        }
        this.sshManager = sshManager;  // ✅ меняем на маленькую букву
        this.firewallManager = new UniversalFirewallManager(sshManager);
        this.extenderIps = globalExtenderIps;
        this.routerIps = globalRouterIps;
        console.log(`✅ DockerManager initialized with SSHManager`);
    }

    /**
     * Получает IP адрес extender'а через запрос к роутеру
     */
    async getExtenderIpFromRouter(routerId, extenderMac, routerPassword = null, maxAttempts = 10, delay = 5000) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`🔧 Попытка ${attempt}/${maxAttempts} получения IP extender'а ${extenderMac} через DHCP bindings`);
                
                const router = getParamRouter(routerId);
                if (!router) {
                    throw new Error(`Роутер ${routerId} не найден`);
                }
    
                // ✅ ВАЖНОЕ ИСПРАВЛЕНИЕ: ПРАВИЛЬНАЯ АУТЕНТИФИКАЦИЯ
                console.log(`🔐 Аутентификация на роутере ${router.URL} для получения DHCP bindings`);
                
                const dhcpBindings = await makeAuthenticatedRequest(
                    router.URL,
                    'admin',
                    routerPassword, // ✅ ДОЛЖЕН БЫТЬ ПРАВИЛЬНЫЙ ПАРОЛЬ
                    '/rci/show/ip/dhcp/bindings',
                    'GET'
                );
    
                console.log(`📋 Получены DHCP bindings (попытка ${attempt}):`, 
                    dhcpBindings?.lease?.length || 0, 'записей');
    
                if (!dhcpBindings || !Array.isArray(dhcpBindings.lease)) {
                    throw new Error('Некорректный ответ от роутера при запросе DHCP bindings');
                }
    
                const normalizedTargetMac = extenderMac.toLowerCase().replace(/:/g, '');
                
                const extenderBinding = dhcpBindings.lease.find(binding => {
                    if (!binding.mac) return false;
                    const bindingMac = binding.mac.toLowerCase().replace(/:/g, '');
                    return bindingMac === normalizedTargetMac;
                });
    
                if (!extenderBinding) {
                    console.log(`⌛ Extender еще не появился в DHCP bindings (попытка ${attempt}/${maxAttempts})`);
                    
                    if (attempt === maxAttempts) {
                        throw new Error(`Extender с MAC ${extenderMac} не появился в DHCP bindings после ${maxAttempts} попыток`);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
    
                if (!extenderBinding.ip) {
                    console.log(`⌛ У extender'а еще не назначен IP адрес в DHCP (попытка ${attempt}/${maxAttempts})`);
                    
                    if (attempt === maxAttempts) {
                        throw new Error(`У extender'а не назначен IP адрес в DHCP после ${maxAttempts} попыток`);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
    
                console.log(`✅ Найден IP extender'а через DHCP: ${extenderBinding.ip} (попытка ${attempt})`);
                return extenderBinding.ip;
    
            } catch (error) {
                lastError = error;
                console.log(`⚠️ Ошибка получения IP через DHCP (попытка ${attempt}/${maxAttempts}): ${error.message}`);
                
                if (error.message.includes('401') || error.message.includes('Unauthorized') || error.message.includes('Authentication')) {
                    console.error(`❌ Критическая ошибка аутентификации: неправильный пароль роутера`);
                    throw new Error(`Ошибка аутентификации на роутере: неправильный пароль. Проверьте routerPassword.`);
                }
                
                if (attempt === maxAttempts) {
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    
        console.error(`❌ Не удалось получить IP экстендера через DHCP`);
        throw new Error(`Не удалось получить IP адрес экстендера. Проверьте подключение устройства к роутеру и правильность пароля.`);
    }



    async manageContainerFirewall(containerName, port, targetIp, action = 'setup') {
        const formattedTargetIp = targetIp.split('/')[0];
        
        try {
            console.log(`🔧 КОНТЕЙНЕР ${containerName}: порт ${port} -> ${formattedTargetIp}:80`);
            
            if (!this.sshManager) {
                throw new Error('SSHManager не доступен');
            }
            
            // ✅ ПРОВЕРЯЕМ КОНТЕЙНЕР
            const checkContainerCmd = `docker ps --filter "name=${containerName}" --format "{{.Names}}" | grep -Ex "${containerName}"`
            const containerCheck = await this.sshManager.executeCommand(checkContainerCmd);
            const isContainerRunning = containerCheck.stdout.trim() === containerName;
            
            if (!isContainerRunning) {
                throw new Error(`Контейнер ${containerName} не запущен`);
            }
    
            if (action === 'setup') {
                // ✅ ДОБАВЛЯЕМ ПРАВИЛО В КОНТЕЙНЕР
                const addRuleCmd = `sudo docker exec ${containerName} bash -c "iptables -t nat -I PREROUTING 1 -p tcp --dport ${port} -i eth0 -j DNAT --to-destination ${formattedTargetIp}:80"`;
                await this.sshManager.executeCommand(addRuleCmd);
                console.log(`✅ КОНТЕЙНЕР: правило добавлено ${port} -> ${formattedTargetIp}:80`);
    
            } else if (action === 'remove') {
                // ✅ УДАЛЯЕМ ТОЛЬКО ПРАВИЛА ДЛЯ ЭТОГО ПОРТА И IP
                const listRulesCmd = `sudo docker exec ${containerName} iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | grep "${formattedTargetIp}" | awk '{print $1}' | sort -rn`;
                const listResult = await this.sshManager.executeCommand(listRulesCmd);
                
                const lineNumbers = listResult.stdout.split('\n').filter(line => line.trim());
                console.log(`📋 Найдено правил для удаления: ${lineNumbers.length}`);
                
                for (const lineNum of lineNumbers) {
                    if (lineNum.trim()) {
                        const deleteCmd = `sudo docker exec ${containerName} iptables -t nat -D PREROUTING ${lineNum.trim()}`;
                        await this.sshManager.executeCommand(deleteCmd);
                        console.log(`✅ КОНТЕЙНЕР: удалено правило строка ${lineNum}`);
                    }
                }
            }
        
        } catch (error) {
            console.error(`❌ Ошибка в контейнере ${containerName}:`, error);
            throw error;
        }
    }
    async manageHostFirewall(port, targetIp, action = 'setup') {
        try {
            const formattedIp = targetIp.split('/')[0];
            
            if (action === 'setup') {
                console.log(`🔧 ХОСТ: настраиваем проброс порта ${port} -> ${formattedIp}`);
                await this.firewallManager.updateRule(port, formattedIp);
            } else {
                // ✅ УДАЛЯЕМ ТОЛЬКО ПРАВИЛА С ЭТИМ IP
                console.log(`🔧 ХОСТ: удаляем проброс порта ${port} -> ${formattedIp}`);
                await this.firewallManager.deleteRule(port, formattedIp);
            }
            return true;
        } catch (error) {
            console.error(`❌ Ошибка управления фаерволом на хосте:`, error);
            throw error;
        }
    }

    async waitForAPInDHCP(routerId, apMac, routerPassword = null, maxAttempts = 15, delay = 5000) {
        console.log(`⏳ Ожидание появления AP ${apMac} в DHCP bindings...`);
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`🔍 Попытка ${attempt}/${maxAttempts} поиска AP в DHCP...`);
                
                const router = getParamRouter(routerId);
                const dhcpBindings = await makeAuthenticatedRequest(
                    router.URL,
                    'admin',
                    routerPassword,
                    '/rci/show/ip/dhcp/bindings',
                    'GET'
                );
    
                const normalizedMac = apMac.toLowerCase().replace(/:/g, '');
                const apBinding = dhcpBindings?.lease?.find(binding => {
                    if (!binding.mac) return false;
                    const bindingMac = binding.mac.toLowerCase().replace(/:/g, '');
                    return bindingMac === normalizedMac;
                });
    
                if (apBinding && apBinding.ip) {
                    console.log(`✅ AP найден в DHCP: ${apBinding.ip}`);
                    return apBinding.ip;
                }
    
                console.log(`⌛ AP еще не появился в DHCP bindings...`);
                
                if (attempt === maxAttempts) {
                    throw new Error(`AP не появился в DHCP bindings после ${maxAttempts} попыток`);
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
                
            } catch (error) {
                console.log(`⚠️ Ошибка поиска AP в DHCP (попытка ${attempt}): ${error.message}`);
                
                if (attempt === maxAttempts) {
                    throw error;
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async setupPortForwarding(deviceId, routerId, device, routerPassword = null) {
        try {
            console.log(`🔧 Полная настройка проброса портов для extender'а ${deviceId} к роутеру ${routerId}`);
            
            const router = getParamRouter(routerId);
            if (!router) {
                throw new Error(`Роутер ${routerId} не найден`);
            }
    
            const routerIp = router.ip.split('/')[0];
            
            console.log(`📋 Параметры:`, {
                deviceId: deviceId,
                routerId: routerId, 
                routerIp: routerIp,
                deviceMac: device.macAddress,
                deviceIp: device.ip,
                deviceType: device.type,
                isAP: device.type === 'AP'
            });
    
            // ✅ ОПРЕДЕЛЯЕМ ТИП УСТРОЙСТВА
            const isAPDevice = device.type === 'AP' && device.hWtype === 'true';
            let extenderIp;
    
            if (isAPDevice) {
                // ✅ ДЛЯ AP УСТРОЙСТВ: ЖДЕМ DHCP И ПОЛУЧАЕМ ДИНАМИЧЕСКИЙ IP
                console.log(`📡 AP устройство - ожидаем получение IP из DHCP...`);
                
                try {
                    // Ждем появления в DHCP
                    extenderIp = await this.waitForAPInDHCP(routerId, device.macAddress, routerPassword);
                    console.log(`✅ AP получил IP из DHCP: ${extenderIp}`);
                    
                } catch (dhcpError) {
                    console.warn(`⚠️ Не удалось получить IP AP из DHCP: ${dhcpError.message}`);
                    
                    // Fallback: используем device.ip или router.ip
                    if (device && device.ip) {
                        extenderIp = device.ip.split('/')[0];
                        console.log(`🔄 Используем IP устройства из конфигурации: ${extenderIp}`);
                    } else {
                        console.log(`🔄 Используем IP роутера как fallback: ${routerIp}`);
                        extenderIp = routerIp;
                    }
                }
            } else {
                // ✅ ДЛЯ ОБЫЧНЫХ УСТРОЙСТВ: стандартная логика
                try {
                    extenderIp = await this.getExtenderIpCombined(routerId, device.macAddress, routerPassword, device);
                    console.log(`✅ Получен IP устройства: ${extenderIp}`);
                } catch (ipError) {
                    console.error(`❌ Не удалось получить IP экстендера: ${ipError.message}`);
                    
                    if (device && device.ip) {
                        extenderIp = device.ip.split('/')[0];
                        console.log(`🔄 Используем IP устройства из конфигурации: ${extenderIp}`);
                    } else {
                        console.log(`🔄 Используем IP роутера как fallback: ${routerIp}`);
                        extenderIp = routerIp;
                    }
                }
            }
    
            // ✅ СОХРАНЯЕМ В ГЛОБАЛЬНЫЕ ХРАНИЛИЩА
            this.extenderIps.set(deviceId, extenderIp);
            this.routerIps.set(deviceId, routerIp);
            
            console.log(`💾 Сохранены IP:`, {
                extenderIp: extenderIp,
                routerIp: routerIp,
                deviceType: isAPDevice ? 'AP' : 'Standard'
            });
    
            // ✅ 2. НАСТРАИВАЕМ ПРОБРОС НА ХОСТЕ НА IP РОУТЕРА
            console.log(`🔧 ХОСТ: порт ${deviceId} -> ${routerIp}`);
            await this.manageHostFirewall(deviceId, routerIp, 'setup');
    
            // ✅ 3. НАСТРАИВАЕМ ПРОБРОС В КОНТЕЙНЕРЕ НА РЕАЛЬНЫЙ IP УСТРОЙСТВА
            console.log(`🔧 КОНТЕЙНЕР: порт ${deviceId} -> ${extenderIp}:80`);
            await this.manageContainerFirewall(router.hwId, deviceId, extenderIp, 'setup');
    
            console.log(`✅ Пробросы настроены:`);
            console.log(`   🏠 ХОСТ: ${deviceId} -> ${routerIp}`);
            console.log(`   🐳 КОНТЕЙНЕР ${router.hwId}: ${deviceId} -> ${extenderIp}:80`);
            console.log(`   📡 ТИП: ${isAPDevice ? 'AP (динамический IP)' : 'Standard'}`);
            
            return extenderIp;
    
        } catch (error) {
            console.error(`❌ Ошибка настройки проброса портов:`, error);
            throw error;
        }
    }

    async getExtenderIpCombined(routerId, extenderMac, routerPassword = null, device = null) {
        try {
            console.log(`🔍 Комбинированный поиск IP для MAC: ${extenderMac} через роутер ${routerId}`);
            
            // Сначала пробуем через DHCP bindings
            console.log(`🔄 Попытка 1: DHCP bindings`);
            const dhcpIp = await this.getExtenderIpFromRouter(routerId, extenderMac, routerPassword, 5, 3000);
            console.log(`✅ DHCP метод вернул IP: ${dhcpIp}`);
            
            // Проверяем, что это не IP роутера
            const router = getParamRouter(routerId);
            const routerIp = router?.ip?.split('/')[0];
            
            if (dhcpIp === routerIp) {
                console.log(`⚠️ ВНИМАНИЕ: DHCP вернул IP роутера (${routerIp}), пробуем ARP`);
                throw new Error('DHCP returned router IP instead of extender IP');
            }
            
            return dhcpIp;
            
        } catch (dhcpError) {
            console.log(`⚠️ DHCP метод не сработал: ${dhcpError.message}`);
            console.log(`🔄 Попытка 2: ARP таблица...`);
            
            try {
                // Пробуем через ARP таблицу
                const arpIp = await this.getExtenderIpFromArp(routerId, extenderMac, routerPassword);
                console.log(`✅ ARP метод вернул IP: ${arpIp}`);
                
                // Проверяем, что это не IP роутера
                const router = getParamRouter(routerId);
                const routerIp = router?.ip?.split('/')[0];
                
                if (arpIp === routerIp) {
                    console.log(`⚠️ ВНИМАНИЕ: ARP вернул IP роутера (${routerIp})`);
                    throw new Error('ARP returned router IP instead of extender IP');
                }
                
                return arpIp;
                
            } catch (arpError) {
                console.log(`❌ Оба метода не сработали: ${arpError.message}`);
                
                // ✅ ИСПРАВЛЕНИЕ: Используем device.ip вместо router.ip
                if (device && device.ip) {
                    const deviceIp = device.ip.split('/')[0];
                    console.log(`🔄 Используем IP устройства из конфигурации: ${deviceIp}`);
                    return deviceIp;
                }
                
                const router = getParamRouter(routerId);
                if (!router) {
                    throw new Error(`Роутер не найден`);
                }
                
                const routerIp = router.ip.split('/')[0];
                console.log(`🔄 Используем IP роутера как последний fallback: ${routerIp}`);
                return routerIp;
            }
        }
    }
    async removePortForwarding(deviceId, routerId) {
        try {
            console.log(`🔧 Удаление правил проброса для устройства ${deviceId} и роутера ${routerId}`);
            
            const router = getParamRouter(routerId);
            if (!router) {
                throw new Error(`Роутер ${routerId} не найден`);
            }
    
            const routerIp = this.routerIps.get(deviceId) || router.ip.split('/')[0];
            const extenderIp = this.extenderIps.get(deviceId) || routerIp;
            
            console.log(`📋 Параметры удаления:`, {
                deviceId: deviceId,
                routerId: routerId,
                routerIp: routerIp,
                extenderIp: extenderIp
            });
    
            // ✅ УДАЛЯЕМ ПРАВИЛА НА ХОСТЕ ТОЛЬКО ДЛЯ IP РОУТЕРА
            console.log(`🔧 Удаляем на ХОСТЕ: порт ${deviceId} -> ${routerIp}`);
            await this.manageHostFirewall(deviceId, routerIp, 'remove');
    
            // ✅ УДАЛЯЕМ ПРАВИЛА В КОНТЕЙНЕРЕ ТОЛЬКО ДЛЯ IP EXTENDER'А
            console.log(`🔧 Удаляем в КОНТЕЙНЕРЕ: порт ${deviceId} -> ${extenderIp}`);
            await this.manageContainerFirewall(router.hwId, deviceId, extenderIp, 'remove');
    
            // ✅ УДАЛЯЕМ СОХРАНЕННЫЕ IP
            this.extenderIps.delete(deviceId);
            this.routerIps.delete(deviceId);
            console.log(`🧹 Удалены сохраненные IP для порта ${deviceId}`);
    
            console.log(`✅ Правила проброса удалены для устройства ${deviceId}`);
    
        } catch (error) {
            console.error(`❌ Ошибка удаления правил:`, error);
            throw error;
        }
    }
    async removeContainerFirewallRules(containerName, port) {
        try {
            console.log(`🔧 Удаление правил фаервола в контейнере ${containerName} для порта ${port}`);
            
            const isRunning = await this.isContainerRunning(containerName);
            if (!isRunning) {
                console.log(`⚠️ Контейнер ${containerName} не запущен, пропускаем удаление правил`);
                return false;
            }

            const checkCommand = `docker exec ${containerName} iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | awk '{print $1}' | sort -rn`;
            
            try {
                const existingRules = await this.ssh.executeCommand(checkCommand);
                if (existingRules.stdout) {
                    const lineNumbers = existingRules.stdout.trim().split('\n').filter(line => line.trim());
                    
                    console.log(`🔧 Найдено правил для удаления: ${lineNumbers.length}`);
                    
                    for (const lineNumber of lineNumbers) {
                        if (lineNumber.trim()) {
                            console.log(`   → Удаляем правило в строке ${lineNumber}`);
                            await this.execInContainer(containerName,
                                `iptables -t nat -D PREROUTING ${lineNumber.trim()}`
                            );
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                    
                    console.log(`✅ Удалено ${lineNumbers.length} правил в контейнере ${containerName}`);
                } else {
                    console.log(`ℹ️ Правил для порта ${port} в контейнере ${containerName} не найдено`);
                }
            } catch (error) {
                console.log(`ℹ️ Ошибка при поиске правил (возможно их нет): ${error.message}`);
            }

            return true;
        } catch (error) {
            console.error(`❌ Ошибка удаления правил в контейнере:`, error);
            throw error;
        }
    }

    /**
     * Выполняет команду внутри Docker контейнера
     */
    async execInContainer(containerName, command) {
        try {
            const fullCommand = `docker exec ${containerName} bash -c "${command}"`;
            console.log(`🔧 Выполняем в контейнере: ${fullCommand}`);
            const result = await this.ssh.executeCommand(fullCommand);
            return result;
        } catch (error) {
            console.error(`❌ Ошибка выполнения команды в контейнере ${containerName}:`, error);
            throw error;
        }
    }

    /**
     * Проверяет запущен ли Docker контейнер
     */
    async isContainerRunning(containerName) {
        console.log(`🔍 Проверка запущен ли контейнер: ${containerName}`);
        try {
            const command = `docker ps --filter "name=${containerName}" --format "{{.Names}}"`;
            const result = await this.ssh.executeCommand(command);
            const isRunning = result.stdout.trim() === containerName;
            console.log(`✅ Контейнер ${containerName} запущен: ${isRunning}`);
            return isRunning;
        } catch (error) {
            console.error(`❌ Ошибка проверки контейнера ${containerName}:`, error);
            return false;
        }
    }
}