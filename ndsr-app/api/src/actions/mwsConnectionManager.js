import { SSHManager } from "../actions/sshManager.js";
import { DockerManager } from "../utils/dockerManager.js";
import { HOST_CONFIG } from "../utils/hostConfig.js";
import { getDeviceById, getParamRouter } from "../devices.js";
import { IpDiscoveryService } from "../utils/ipDiscovery.js"; 

export class MWSConnectionManager {
    static async getExtenderIpFromRouter(routerId, extenderMac, routerPassword = null, maxAttempts = 10, delay = 5000) {
        return await IpDiscoveryService.getExtenderIpFromRouter(routerId, extenderMac, routerPassword, maxAttempts, delay);
    }
    
    static async getExtenderIpFromArp(routerId, extenderMac, routerPassword = null) {
        return await IpDiscoveryService.getExtenderIpFromArp(routerId, extenderMac, routerPassword);
    }
    
    static async getExtenderIp(extenderId, routerId, routerPassword = null) {
        return await IpDiscoveryService.getExtenderIp(extenderId, routerId, routerPassword);
    }
    
    static normalizeMac(mac) {
        return IpDiscoveryService.normalizeMac(mac);
    }
    static async setupMWSConnection(extenderId, routerId, devicePassword = null, routerPassword = null) {
    let sshManager = null;
    
    try {
        console.log(`🔗 Настройка MWS подключения: extender ${extenderId} -> router ${routerId}`);
        
        const device = getDeviceById(extenderId);
        const router = getParamRouter(routerId);
        
        if (!device || !router) {
            throw new Error(`Устройство или роутер не найдены`);
        }

        console.log(`📋 Параметры подключения:`, {
            extender: device.hwId,
            router: router.hwId,
            extenderMac: device.macAddress,
            deviceType: device.type,
            isAP: device.type === 'AP'
        });

        const isAPDevice = device.type === 'AP' && device.hWtype === 'true';
        
        // ✅ ВСЕГДА получаем реальный IP через ARP/NDP, НЕ используем device.ip из конфига
        console.log(`🔧 Получаем реальный IP устройства через ARP/NDP...`);
        
        let hostTargetIp;      // IP для проброса на хосте (IP роутера в сети хоста)
        let containerTargetIp; // IP для проброса в контейнере (реальный IP устройства)
        
        // ✅ ПОЛУЧАЕМ IP РОУТЕРА ДЛЯ ХОСТА (это единственный IP из конфига, который нужен)
        hostTargetIp = router.ip.split('/')[0];
        
        // ✅ ПОЛУЧАЕМ РЕАЛЬНЫЙ IP УСТРОЙСТВА ЧЕРЕЗ ARP/NDP
        if (isAPDevice) {
            // Для AP — ждём появления в DHCP, затем получаем IP из ARP
            console.log(`📡 AP устройство - ожидаем получение IP из DHCP...`);
            try {
                await this.waitForAPInDHCP(routerId, device.macAddress, routerPassword);
                containerTargetIp = await IpDiscoveryService.getExtenderIpFromRouter(
                    routerId, device.macAddress, routerPassword, 10, 5000
                );
                console.log(`✅ AP получил IP из ARP/NDP: ${containerTargetIp}`);
            } catch (dhcpError) {
                console.error(`❌ Не удалось получить IP AP: ${dhcpError.message}`);
                throw new Error(`Не удалось определить IP адрес AP ${device.hwId}: ${dhcpError.message}`);
            }
        } else {
            // Для остальных устройств — сразу получаем IP из ARP
            try {
                containerTargetIp = await IpDiscoveryService.getExtenderIpFromRouter(
                    routerId, device.macAddress, routerPassword, 8, 3000
                );
                console.log(`✅ Получен реальный IP устройства через ARP/NDP: ${containerTargetIp}`);
            } catch (ipError) {
                console.error(`❌ Не удалось получить IP устройства: ${ipError.message}`);
                throw new Error(`Не удалось определить IP адрес устройства ${device.hwId}: ${ipError.message}`);
            }
        }

        console.log(`🎯 Финальные IP для пробросов:`, {
            hostTarget: hostTargetIp, 
            containerTarget: containerTargetIp,
            deviceType: isAPDevice ? 'AP' : 'Standard'
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
        
        const dockerManager = new DockerManager(sshManager);
        console.log(`✅ DockerManager инициализирован`);

        // ✅ ШАГ 1: НАСТРАИВАЕМ ПРОБРОС НА ХОСТЕ
        console.log(`🔧 Настраиваем проброс портов на хосте...`);
        console.log(`   → Хост: порт ${extenderId} -> ${hostTargetIp}:80`);
        await dockerManager.manageHostFirewall(extenderId, hostTargetIp, 'setup');

        // ✅ ШАГ 2: НАСТРАИВАЕМ ПРОБРОС В КОНТЕЙНЕРЕ
        console.log(`🔧 Настраиваем проброс портов в контейнере роутера...`);
        console.log(`   → Контейнер: порт ${extenderId} -> ${containerTargetIp}:80`);
        await dockerManager.manageContainerFirewall(router.hwId, extenderId, containerTargetIp, 'setup');

        console.log(`✅ MWS подключение настроено:`);
        console.log(`   - Хост: порт ${extenderId} -> ${hostTargetIp}:80`);
        console.log(`   - Контейнер: порт ${extenderId} -> ${containerTargetIp}:80`);
        console.log(`   - Тип устройства: ${isAPDevice ? 'AP' : 'Standard'}`);
        
        return {
            success: true,
            hostTargetIp: hostTargetIp,
            containerTargetIp: containerTargetIp,
            routerIp: router.ip,
            port: extenderId,
            routerContainer: router.hwId,
            isAPDevice: isAPDevice
        };

    } catch (error) {
        console.error(`❌ Ошибка настройки MWS подключения:`, error);
        throw error;
    } finally {
        if (sshManager) {
            sshManager.disconnect();
            console.log(`🔧 SSH подключение закрыто`);
        }
    }
}


    static async waitForAPInDHCP(routerId, apMac, routerPassword = null, maxAttempts = 15, delay = 5000) {
        console.log(`⏳ Ожидание появления AP ${apMac} в DHCP bindings...`);
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`🔍 Попытка ${attempt}/${maxAttempts} поиска AP в DHCP...`);
                
                const dhcpBindings = await IpDiscoveryService.getDhcpBindingsSmart(
                    getParamRouter(routerId).URL, 
                    routerPassword
                );
    
                const normalizedMac = IpDiscoveryService.normalizeMac(apMac);
                const apBinding = dhcpBindings?.lease?.find(binding => 
                    binding.mac && IpDiscoveryService.normalizeMac(binding.mac) === normalizedMac
                );
    
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

    
static async removeMWSConnection(extenderId, routerId) {
    let sshManager = null;
    
    try {
        console.log(`🔗 Удаление MWS подключения: extender ${extenderId} -> router ${routerId}`);
        
        const device = getDeviceById(extenderId);
        const router = getParamRouter(routerId);
        
        if (!device || !router) {
            throw new Error(`Устройство или роутер не найдены`);
        }

        console.log(`📋 Параметры удаления:`, {
            extender: device.hwId,
            router: router.hwId,
            routerIp: router.ip
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

        // ✅ ШАГ 1: УДАЛЯЕМ ПРАВИЛА ПРОБРОСА В КОНТЕЙНЕРЕ РОУТЕРА
        console.log(`🔧 Удаляем правила проброса в контейнере роутера...`);
        
        // ✅ ИСПРАВЛЕНИЕ: Получаем реальный IP устройства для удаления из контейнера
        let deviceIpForContainer = '0.0.0.0';
        try {
            // Для контейнера нужен реальный IP устройства в сети роутера
            deviceIpForContainer = await this.getExtenderIpFromRouter(routerId, device.macAddress, null, 3, 2000);
            console.log(`✅ Получен IP устройства для удаления из контейнера: ${deviceIpForContainer}`);
        } catch (ipError) {
            console.warn(`⚠️ Не удалось получить IP устройства для контейнера: ${ipError.message}`);
            console.log(`🔄 Используем fallback IP для удаления из контейнера`);
        }
        
        await dockerManager.manageContainerFirewall(router.hwId, extenderId, deviceIpForContainer, 'remove');

        // ✅ ШАГ 2: УДАЛЯЕМ ПРАВИЛА ПРОБРОСА НА ХОСТЕ (ТОЛЬКО ДЛЯ РОУТЕРА)
        console.log(`🔧 Удаляем правила проброса на хосте (только для роутера ${router.ip})...`);
        await this.forceRemoveHostFirewallRules(sshManager, extenderId, router.ip);

        console.log(`✅ MWS подключение удалено для порта ${extenderId}`);
        
        return {
            success: true,
            port: extenderId,
            routerContainer: router.hwId
        };

    } catch (error) {
        console.error(`❌ Ошибка удаления MWS подключения:`, error);
        throw error;
    } finally {
        if (sshManager) {
            sshManager.disconnect();
            console.log(`🔧 SSH подключение закрыто`);
        }
    }
}



    static async forceRemoveHostFirewallRules(sshManager, port, routerIp) {
        try {
            console.log(`🔧 Форсированное удаление правил на хосте для порта ${port} (только для роутера ${routerIp})`);
            
            // ✅ ФОРМАТИРУЕМ IP РОУТЕРА (убираем маску если есть)
            const formattedRouterIp = routerIp.split('/')[0];
            
            // ✅ СПОСОБ 1: УДАЛЕНИЕ ЧЕРЕЗ NFTABLES ПО HANDLE И КОНКРЕТНОМУ IP
            console.log(`🔧 Поиск и удаление правил nftables для порта ${port} и роутера ${formattedRouterIp}...`);
            
            // Получаем все handles для этого порта И роутера
            const findHandlesCommand = `nft -a list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "${formattedRouterIp}" | grep -o "handle [0-9]*" | awk '{print $2}'`;
            const findResult = await sshManager.executeCommand(findHandlesCommand);
            
            const handles = findResult.stdout.split('\n').filter(handle => handle.trim());
            console.log(`📋 Найдено handles для удаления (порт ${port} -> ${formattedRouterIp}): ${handles.length}`);
            
            // Удаляем все найденные handles
            for (const handle of handles) {
                if (handle) {
                    try {
                        await sshManager.executeCommand(`nft delete rule ip nat PREROUTING handle ${handle}`);
                        console.log(`✅ Удалено правило handle ${handle} (порт ${port} -> ${formattedRouterIp})`);
                    } catch (error) {
                        console.log(`⚠️ Не удалось удалить handle ${handle}: ${error.message}`);
                    }
                }
            }
            
            // ✅ СПОСОБ 2: УДАЛЕНИЕ ЧЕРЕЗ IPTABLES (LEGACY) С ФИЛЬТРАЦИЕЙ ПО IP
            console.log(`🔧 Удаление через iptables (legacy) для роутера ${formattedRouterIp}...`);
            try {
                // Ищем правила только для конкретного IP роутера
                const findIptablesCommand = `iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | grep "${formattedRouterIp}" | awk '{print $1}' | sort -rn`;
                const iptablesResult = await sshManager.executeCommand(findIptablesCommand);
                
                const lineNumbers = iptablesResult.stdout.split('\n').filter(line => line.trim());
                console.log(`📋 Найдено iptables правил для удаления: ${lineNumbers.length}`);
                
                for (const lineNum of lineNumbers) {
                    if (lineNum.trim()) {
                        await sshManager.executeCommand(`iptables -t nat -D PREROUTING ${lineNum.trim()}`);
                        console.log(`✅ Удалено iptables правило строка ${lineNum} (порт ${port} -> ${formattedRouterIp})`);
                    }
                }
            } catch (error) {
                console.log(`ℹ️ iptables правила для роутера ${formattedRouterIp} не найдены или уже удалены: ${error.message}`);
            }
            
            // ✅ ДОПОЛНИТЕЛЬНАЯ ОЧИСТКА: удаляем только по конкретному IP роутера
            console.log(`🔧 Дополнительная очистка по IP ${formattedRouterIp}...`);
            try {
                const cleanupCommand = `nft list ruleset | grep "tcp dport ${port}" | grep "${formattedRouterIp}" | grep -o "handle [0-9]*" | awk '{print $2}'`;
                const cleanupResult = await sshManager.executeCommand(cleanupCommand);
                
                const cleanupHandles = cleanupResult.stdout.split('\n').filter(handle => handle.trim());
                
                for (const handle of cleanupHandles) {
                    if (handle) {
                        await sshManager.executeCommand(`nft delete rule ip nat PREROUTING handle ${handle}`);
                        console.log(`✅ Удалено правило cleanup handle ${handle} (порт ${port} -> ${formattedRouterIp})`);
                    }
                }
            } catch (error) {
                console.log(`ℹ️ Дополнительная очистка не требуется: ${error.message}`);
            }
            
            // ✅ ФИНАЛЬНАЯ ПРОВЕРКА - проверяем только правила для этого роутера
            console.log(`🔧 Проверка что правила для роутера ${formattedRouterIp} удалены...`);
            const finalCheckCommand = `nft list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "${formattedRouterIp}" | wc -l`;
            const finalCheck = await sshManager.executeCommand(finalCheckCommand);
            const remainingRules = parseInt(finalCheck.stdout);
            
            if (remainingRules === 0) {
                console.log(`✅ Все правила для порта ${port} -> ${formattedRouterIp} успешно удалены`);
            } else {
                console.log(`⚠️ Осталось ${remainingRules} правил для порта ${port} -> ${formattedRouterIp}`);
                // Покажем оставшиеся правила для диагностики
                const showRemainingCommand = `nft list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "${formattedRouterIp}"`;
                const remainingResult = await sshManager.executeCommand(showRemainingCommand);
                console.log(`📋 Оставшиеся правила:\n${remainingResult.stdout}`);
            }
            
        } catch (error) {
            console.error(`❌ Ошибка форсированного удаления правил:`, error);
            throw error;
        }
    }
    static async checkMWSConnectionStatus(extenderId, routerId) {
        let sshManager = null;
        
        try {
            console.log(`🔍 Проверка статуса MWS подключения: extender ${extenderId}`);
            
            const device = getDeviceById(extenderId);
            const router = getParamRouter(routerId);
            
            if (!device || !router) {
                throw new Error(`Устройство или роутер не найдены`);
            }

            // ✅ ПОДКЛЮЧАЕМСЯ ПО SSH
            sshManager = new SSHManager(
                HOST_CONFIG.mainHost.host,
                HOST_CONFIG.mainHost.port,
                HOST_CONFIG.mainHost.username,
                HOST_CONFIG.mainHost.privateKeyPath
            );
            
            await sshManager.connect();
            console.log(`✅ SSH подключение установлено`);
            
            // ✅ ПРОВЕРЯЕМ ПРАВИЛА НА ХОСТЕ
            const hostRuleExists = await this.checkHostFirewallRule(sshManager, extenderId);
            
            // ✅ ПРОВЕРЯЕМ ПРАВИЛА В КОНТЕЙНЕРЕ
            let containerRuleExists = false;
            try {
                const checkCommand = `docker exec ${router.hwId} iptables -t nat -L PREROUTING -n | grep ":${extenderId} "`;
                const checkResult = await sshManager.executeCommand(checkCommand);
                containerRuleExists = checkResult.stdout.length > 0;
            } catch (error) {
                console.log(`⚠️ Не удалось проверить правила в контейнере: ${error.message}`);
            }
            
            console.log(`📊 Статус правил проброса порта ${extenderId}:`);
            console.log(`   - На хосте: ${hostRuleExists ? 'активно' : 'отсутствует'}`);
            console.log(`   - В контейнере: ${containerRuleExists ? 'активно' : 'отсутствует'}`);
            
            return {
                success: true,
                port: extenderId,
                hostRuleExists: hostRuleExists,
                containerRuleExists: containerRuleExists,
                routerIp: router.ip,
                status: (hostRuleExists && containerRuleExists) ? 'active' : 'inactive'
            };

        } catch (error) {
            console.error(`❌ Ошибка проверки статуса MWS подключения:`, error);
            throw error;
        } finally {
            if (sshManager) {
                sshManager.disconnect();
                console.log(`🔧 SSH подключение закрыто`);
            }
        }
    }

    /**
     * Проверяет наличие правила на хосте
     */
    static async checkHostFirewallRule(sshManager, port) {
        try {
            const checkCommand = `nft list chain ip nat PREROUTING | grep "tcp dport ${port}" | wc -l`;
            const checkResult = await sshManager.executeCommand(checkCommand);
            const ruleCount = parseInt(checkResult.stdout);
            return ruleCount > 0;
        } catch (error) {
            console.log(`⚠️ Ошибка проверки правил на хосте: ${error.message}`);
            return false;
        }
    }

    /**
     * Получает текущий IP адрес extender'а из DHCP
     */
    static async getCurrentExtenderIp(extenderId, routerId, routerPassword = null) {
        try {
            console.log(`🔍 Получение текущего IP адреса extender'а ${extenderId}`);
            
            const device = getDeviceById(extenderId);
            const router = getParamRouter(routerId);
            
            if (!device || !router) {
                throw new Error(`Устройство или роутер не найдены`);
            }

            const extenderIp = await this.getExtenderIpFromRouter(routerId, device.macAddress, routerPassword, 3, 3000);
            
            return {
                success: true,
                extenderIp: extenderIp,
                extenderMac: device.macAddress,
                router: router.hwId
            };

        } catch (error) {
            console.error(`❌ Ошибка получения IP адреса extender'а:`, error);
            throw error;
        }
    }
}

export default MWSConnectionManager;