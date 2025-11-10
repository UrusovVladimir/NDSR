// [file name]: dockerManager.js (ИСПРАВЛЕННАЯ ВЕРСИЯ)
import { SSHManager } from '../actions/sshManager.js';
import { UniversalFirewallManager } from './universalFirewallManager.js';
import { getParamRouter } from '../devices.js';
import { makeAuthenticatedRequest } from '../actions/athentication.js';

const globalExtenderIps = new Map();
const globalRouterIps = new Map();

export class DockerManager {
    constructor(sshManager) {
        this.ssh = sshManager;
        this.firewallManager = new UniversalFirewallManager(sshManager);
        this.extenderIps = globalExtenderIps;
        this.routerIps = globalRouterIps;
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

                // ✅ СОХРАНЯЕМ IP РОУТЕРА В ГЛОБАЛЬНОЕ ХРАНИЛИЩЕ
                this.routerIps.set(routerId, router.ip);

                const dhcpBindings = await makeAuthenticatedRequest(
                    router.URL,
                    'admin',
                    routerPassword,
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
                
                if (attempt === maxAttempts) {
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.log(`🔄 Не удалось получить IP через DHCP, пробуем через neighbour...`);
        try {
            return await this.getExtenderIpFromRouterFallback(routerId, extenderMac, routerPassword);
        } catch (fallbackError) {
            throw lastError || new Error(`Не удалось получить IP адрес extender'а после ${maxAttempts} попыток`);
        }
    }


    async manageContainerFirewall(containerName, port, extenderIp, action = 'setup') {
        try {
            if (action === 'setup') {
                console.log(`🔧 Настраиваем проброс порта ${port} -> ${extenderIp}:80 в контейнере ${containerName}`);
            } else {
                console.log(`🔧 Удаляем проброс порта ${port} в контейнере ${containerName}`);
            }
            
            const isRunning = await this.isContainerRunning(containerName);
            if (!isRunning) {
                throw new Error(`Контейнер ${containerName} не запущен`);
            }

            if (action === 'setup') {
                const containerInterface = 'eth0';
                
                console.log(`🔧 Используем iptables и интерфейс ${containerInterface} в контейнере`);
                
                await this.removeContainerFirewallRules(containerName, port);
                
                await this.execInContainer(containerName,
                    `iptables -t nat -I PREROUTING 1 -p tcp --dport ${port} -i ${containerInterface} -j DNAT --to-destination ${extenderIp}:80`
                );

                const verifyCommand = `docker exec ${containerName} iptables -t nat -L PREROUTING -n | grep ":${port} " | grep "${extenderIp}:80"`;
                const verifyResult = await this.ssh.executeCommand(verifyCommand);
                
                if (!verifyResult.stdout) {
                    throw new Error(`Не удалось проверить добавление правила фаервола в контейнере`);
                }

                console.log(`✅ Обновлен фаервол в контейнере ${containerName}: порт ${port} -> extender ${extenderIp}:80`);
            } else {
                await this.removeContainerFirewallRules(containerName, port);
            }
            
            return true;
        } catch (error) {
            console.error(`❌ Ошибка управления фаерволом в контейнере:`, error);
            throw error;
        }
    }

    /**
     * Настраивает проброс порта на хосте для extender'а
     */
    async manageHostFirewall(port, routerIp, action = 'setup', extenderIp = null) {
        try {
            if (action === 'setup') {
                console.log(`🔧 Настраиваем проброс порта на хосте: ${port} -> ${routerIp}`);
                await this.firewallManager.updateRule(port, routerIp);
                console.log(`✅ Обновлен фаервол на хосте: порт ${port} -> роутер ${routerIp}`);
            } else {
                // ✅ ИСПОЛЬЗУЕМ ГЛОБАЛЬНЫЕ ХРАНИЛИЩА
                const storedExtenderIp = this.extenderIps.get(port);
                const storedRouterIp = this.routerIps.get(port);
                
                console.log(`🔍 Поиск IP для удаления в глобальном хранилище:`, {
                    port: port,
                    storedExtenderIp: storedExtenderIp,
                    storedRouterIp: storedRouterIp,
                    providedExtenderIp: extenderIp
                });

                let ipToUse = storedRouterIp;
                
                if (!ipToUse) {

                    console.warn(`⚠️ Не найден IP для порта ${port} в глобальном хранилище, используем fallback`);
                    await this.firewallManager.deleteRule(port,'0.0.0.0');
                } else {
                    console.log(`🔧 Удаляем проброс порта на хосте: ${port} (IP: ${ipToUse})`);
                    await this.firewallManager.deleteRule(port,ipToUse);
                }
                console.log(`✅ Удален фаервол на хосте для порта ${port}`);
            }
            return true;
        } catch (error) {
            console.error(`❌ Ошибка управления фаерволом на хосте:`, error);
            throw error;
        }
    }

    /**
     * Полная настройка проброса портов для extender'а
     */
    async setupPortForwarding(deviceId, routerId, device, routerPassword = null) {
        try {
            console.log(`🔧 Полная настройка проброса портов для extender'а ${deviceId} к роутеру ${routerId}`);
            
            const router = getParamRouter(routerId);
            if (!router) {
                throw new Error(`Роутер ${routerId} не найден`);
            }

            console.log(`📋 Параметры роутера:`, {
                hwId: router.hwId,
                ip: router.ip,
                containerName: router.hwId
            });

            console.log(`📋 Параметры extender'а:`, {
                deviceId: device.id,
                macAddress: device.macAddress,
                hwId: device.hwId
            });

            // ✅ 1. ПОЛУЧАЕМ И СОХРАНЯЕМ IP EXTENDER'А В ГЛОБАЛЬНОЕ ХРАНИЛИЩЕ
            let extenderIp;
            try {
                extenderIp = await this.getExtenderIpFromRouter(routerId, device.macAddress, routerPassword);
                console.log(`✅ Получен IP extender'а: ${extenderIp}`);
                
                // ✅ СОХРАНЯЕМ В ГЛОБАЛЬНЫЕ ХРАНИЛИЩА
                this.extenderIps.set(deviceId, extenderIp);
                this.routerIps.set(deviceId, router.ip);
                
                console.log(`💾 Сохранены IP в глобальное хранилище для порта ${deviceId}:`, {
                    extenderIp: extenderIp,
                    routerIp: router.ip,
                    totalExtenderIps: this.extenderIps.size,
                    totalRouterIps: this.routerIps.size
                });
            } catch (ipError) {
                console.warn(`⚠️ Не удалось получить IP extender'а: ${ipError.message}`);
                console.log(`🔄 Используем IP роутера для проброса: ${router.ip}`);
                extenderIp = router.ip;
                
                // ✅ СОХРАНЯЕМ IP РОУТЕРА В ГЛОБАЛЬНЫЕ ХРАНИЛИЩА
                this.extenderIps.set(deviceId, router.ip);
                this.routerIps.set(deviceId, router.ip);
                
                console.log(`💾 Сохранен IP роутера в глобальное хранилище: ${router.ip}`);
            }

            // ✅ 2. НАСТРАИВАЕМ ПРОБРОС НА ХОСТЕ
            await this.manageHostFirewall(deviceId, router.ip, 'setup', extenderIp);

            // ✅ 3. НАСТРАИВАЕМ ПРОБРОС В КОНТЕЙНЕРЕ
            const storedExtenderIp = this.extenderIps.get(deviceId);
            if (storedExtenderIp) {
                try {
                    await this.manageContainerFirewall(router.hwId, deviceId, storedExtenderIp, 'setup');
                } catch (containerError) {
                    console.warn(`⚠️ Не удалось настроить проброс в контейнере: ${containerError.message}`);
                }
            }

            console.log(`✅ Полная настройка проброса портов завершена: порт ${deviceId} -> ${extenderIp}:80`);
            return extenderIp;

        } catch (error) {
            console.error(`❌ Ошибка настройки проброса портов:`, error);
            throw error;
        }
    }

    /**
     * Удаляет правила проброса портов для extender'а
     */
    async removePortForwarding(deviceId, routerId, device) {
        try {
            console.log(`🔧 Удаление правил проброса портов для устройства ${deviceId} и роутера ${routerId}`);
            
            const router = getParamRouter(routerId);
            if (!router) {
                throw new Error(`Роутер ${routerId} не найден`);
            }

            console.log(`📋 Параметры удаления:`, {
                deviceId: deviceId,
                routerId: routerId,
                routerHwId: router.hwId,
                routerIp: router.ip
            });

            // ✅ 1. ПОЛУЧАЕМ ВСЕ СОХРАНЕННЫЕ IP ИЗ ГЛОБАЛЬНОГО ХРАНИЛИЩА
            const storedExtenderIp = this.extenderIps.get(deviceId);
            const storedRouterIp = this.routerIps.get(deviceId);
            
            console.log(`💾 Найдены сохраненные IP в глобальном хранилище:`, {
                extenderIp: storedExtenderIp,
                routerIp: storedRouterIp,
                totalExtenderIps: this.extenderIps.size,
                totalRouterIps: this.routerIps.size
            });

            // ✅ 2. УДАЛЯЕМ ПРАВИЛА НА ХОСТЕ
            await this.manageHostFirewall(deviceId, null, 'remove', storedExtenderIp);

            // ✅ 3. УДАЛЯЕМ ПРАВИЛА В КОНТЕЙНЕРЕ
            try {
                await this.manageContainerFirewall(router.hwId, deviceId, storedExtenderIp || '0.0.0.0', 'remove');
            } catch (containerError) {
                console.warn(`⚠️ Не удалось удалить правила в контейнере: ${containerError.message}`);
            }

            // ✅ 4. УДАЛЯЕМ СОХРАНЕННЫЕ IP ИЗ ГЛОБАЛЬНОГО ХРАНИЛИЩА
            this.extenderIps.delete(deviceId);
            this.routerIps.delete(deviceId);
            console.log(`🧹 Удалены сохраненные IP из глобального хранилища для порта ${deviceId}`);

            console.log(`✅ Все правила проброса портов удалены для устройства ${deviceId}`);

        } catch (error) {
            console.error(`❌ Ошибка удаления правил проброса портов:`, error);
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