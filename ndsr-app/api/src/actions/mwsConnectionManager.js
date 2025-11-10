import { SSHManager } from "../actions/sshManager.js";
import { DockerManager } from "../utils/dockerManager.js";
import { HOST_CONFIG } from "../utils/hostConfig.js";
import { getDeviceById, getParamRouter } from "../devices.js";
import { IpDiscoveryService } from "../utils/ipDiscovery.js"; // ✅ ДОБАВИТЬ ИМПОРТ

export class MWSConnectionManager {
    // ✅ УДАЛИТЬ ВЕСЬ ДУБЛИРУЮЩИЙСЯ КОД И ОСТАВИТЬ ТОЛЬКО ЭТО:
    
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

    // ✅ ОСТАВИТЬ ТОЛЬКО УНИКАЛЬНЫЕ МЕТОДЫ MWSConnectionManager:
    
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
                extenderMac: device.macAddress
            });

            // ✅ ИСПОЛЬЗУЕМ КОМБИНИРОВАННЫЙ МЕТОД ПОЛУЧЕНИЯ IP
            console.log(`🔧 Получаем IP адрес extender'а...`);
            let extenderIp;
            try {
                extenderIp = await this.getExtenderIp(extenderId, routerId, routerPassword);
                console.log(`✅ Получен IP extender'а: ${extenderIp}`);
            } catch (ipError) {
                console.warn(`⚠️ Не удалось получить точный IP extender'а: ${ipError.message}`);
                console.log(`🔄 Используем IP роутера для проброса: ${router.ip}`);
                extenderIp = router.ip;
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
            
            // ✅ ИНИЦИАЛИЗИРУЕМ DOCKER MANAGER
            const dockerManager = new DockerManager(sshManager);
            console.log(`✅ DockerManager инициализирован`);

            // ✅ ШАГ 2: НАСТРАИВАЕМ ПРОБРОС ПОРТОВ НА ХОСТЕ
            console.log(`🔧 Настраиваем проброс портов на хосте...`);
            await dockerManager.manageHostFirewall(extenderId, router.ip, 'setup', extenderIp);

            // ✅ ШАГ 3: НАСТРАИВАЕМ ПРОБРОС В КОНТЕЙНЕРЕ РОУТЕРА
            console.log(`🔧 Настраиваем проброс портов в контейнере роутера...`);
            await dockerManager.manageContainerFirewall(router.hwId, extenderId, extenderIp, 'setup');

            console.log(`✅ MWS подключение настроено: порт ${extenderId} -> ${extenderIp}:80`);
            
            return {
                success: true,
                extenderIp: extenderIp,
                routerIp: router.ip,
                port: extenderId,
                routerContainer: router.hwId
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

    /**
     * Удаляет MWS подключение и правила проброса портов
     */
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
                router: router.hwId
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
            await dockerManager.manageContainerFirewall(router.hwId, extenderId, '0.0.0.0', 'remove');

            // ✅ ШАГ 2: УДАЛЯЕМ ПРАВИЛА ПРОБРОСА НА ХОСТЕ
            console.log(`🔧 Удаляем правила проброса на хосте...`);
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

    /**
     * ФОРСИРОВАННОЕ УДАЛЕНИЕ ПРАВИЛ НА ХОСТЕ (исправление проблемы с nftables)
     */
    static async forceRemoveHostFirewallRules(sshManager, port, routerIp) {
        try {
            console.log(`🔧 Форсированное удаление правил на хосте для порта ${port}`);
            
            // ✅ СПОСОБ 1: УДАЛЕНИЕ ЧЕРЕЗ NFTABLES ПО HANDLE
            console.log(`🔧 Поиск и удаление правил nftables по handle...`);
            
            // Получаем все handles для этого порта
            const findHandlesCommand = `nft -a list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep -o "handle [0-9]*" | awk '{print $2}'`;
            const findResult = await sshManager.executeCommand(findHandlesCommand);
            
            const handles = findResult.stdout.split('\n').filter(handle => handle.trim());
            console.log(`📋 Найдено handles для удаления: ${handles.length}`);
            
            // Удаляем все найденные handles
            for (const handle of handles) {
                if (handle) {
                    try {
                        await sshManager.executeCommand(`nft delete rule ip nat PREROUTING handle ${handle}`);
                        console.log(`✅ Удалено правило handle ${handle}`);
                    } catch (error) {
                        console.log(`⚠️ Не удалось удалить handle ${handle}: ${error.message}`);
                    }
                }
            }
            
            // ✅ СПОСОБ 2: УДАЛЕНИЕ ЧЕРЕЗ IPTABLES (LEGACY)
            console.log(`🔧 Удаление через iptables (legacy)...`);
            try {
                const findIptablesCommand = `iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | awk '{print $1}' | sort -rn`;
                const iptablesResult = await sshManager.executeCommand(findIptablesCommand);
                
                const lineNumbers = iptablesResult.stdout.split('\n').filter(line => line.trim());
                
                for (const lineNum of lineNumbers) {
                    if (lineNum.trim()) {
                        await sshManager.executeCommand(`iptables -t nat -D PREROUTING ${lineNum.trim()}`);
                        console.log(`✅ Удалено iptables правило строка ${lineNum}`);
                    }
                }
            } catch (error) {
                console.log(`ℹ️ iptables правила не найдены или уже удалены: ${error.message}`);
            }
            
            // ✅ СПОСОБ 3: УДАЛЕНИЕ ПО КОНКРЕТНОМУ IP (ДОПОЛНИТЕЛЬНАЯ ОЧИСТКА)
            console.log(`🔧 Дополнительная очистка по IP ${routerIp}...`);
            try {
                const cleanupCommand = `nft list ruleset | grep "tcp dport ${port}" | grep "${routerIp}" | grep -o "handle [0-9]*" | awk '{print $2}'`;
                const cleanupResult = await sshManager.executeCommand(cleanupCommand);
                
                const cleanupHandles = cleanupResult.stdout.split('\n').filter(handle => handle.trim());
                
                for (const handle of cleanupHandles) {
                    if (handle) {
                        await sshManager.executeCommand(`nft delete rule ip nat PREROUTING handle ${handle}`);
                        console.log(`✅ Удалено правило cleanup handle ${handle}`);
                    }
                }
            } catch (error) {
                console.log(`ℹ️ Дополнительная очистка не требуется: ${error.message}`);
            }
            
            // ✅ ФИНАЛЬНАЯ ПРОВЕРКА
            console.log(`🔧 Проверка что правила удалены...`);
            const finalCheckCommand = `nft list chain ip nat PREROUTING | grep "tcp dport ${port}" | wc -l`;
            const finalCheck = await sshManager.executeCommand(finalCheckCommand);
            const remainingRules = parseInt(finalCheck.stdout);
            
            if (remainingRules === 0) {
                console.log(`✅ Все правила для порта ${port} успешно удалены`);
            } else {
                console.log(`⚠️ Осталось ${remainingRules} правил для порта ${port}`);
                // Покажем оставшиеся правила для диагностики
                const showRemainingCommand = `nft list chain ip nat PREROUTING | grep "tcp dport ${port}"`;
                const remainingResult = await sshManager.executeCommand(showRemainingCommand);
                console.log(`📋 Оставшиеся правила:\n${remainingResult.stdout}`);
            }
            
        } catch (error) {
            console.error(`❌ Ошибка форсированного удаления правил:`, error);
            throw error;
        }
    }

    /**
     * Проверяет статус проброса портов для MWS подключения
     */
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