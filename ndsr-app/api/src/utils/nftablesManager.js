import { SSHManager } from '../actions/sshManager.js';


export class NftablesManager {
    constructor(sshManager) {
        this.ssh = sshManager;
    }

    /**
     * Проверяет использование nftables vs iptables
     */
    async detectBackend() {
        try {
            const nftCheck = await this.ssh.executeCommand('which nft');
            if (nftCheck.stdout.includes('nft')) {
                console.log('✅ Обнаружен nftables');
                return 'nftables';
            }
            
            const iptablesCheck = await this.ssh.executeCommand('iptables --version');
            if (iptablesCheck.stdout.includes('nf_tables')) {
                console.log('✅ Обнаружен iptables с nf_tables бэкендом');
                return 'nf_tables';
            }
            
            console.log('✅ Используется legacy iptables');
            return 'legacy';
            
        } catch (error) {
            console.error('❌ Ошибка определения бэкенда:', error);
            return 'legacy';
        }
    }

    /**
     * Проверяет существование правила PREROUTING
     */
    async checkRuleExists(port, destination) {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                const escapedDestination = destination.replace(/:/g, '\\:');
                const command = `nft list ruleset | grep "tcp dport ${port}" | grep "dnat to ${escapedDestination}"`;
                const result = await this.ssh.executeCommand(command);
                return result.stdout.length > 0;
            } else {
                const command = `iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | grep "${destination}"`;
                const result = await this.ssh.executeCommand(command);
                return result.stdout.length > 0;
            }
        } catch (error) {
            console.log(`⚠️ Ошибка проверки правила: ${error.message}`);
            return false;
        }
    }

/**
 * Удаляет правило
 */
async deleteRule(port, destination) {
    try {
        const backend = await this.detectBackend();
        
        if (backend === 'nftables' || backend === 'nf_tables') {
            // Сначала покажем сколько правил есть
            const countCommand = `nft -a list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "dnat to ${destination.replace(/:/g, '\\:')}" | wc -l`;
            const countResult = await this.ssh.executeCommand(countCommand);
            const initialCount = parseInt(countResult.stdout);
            console.log(`📊 Найдено правил для удаления: ${initialCount}`);
            
            if (initialCount === 0) {
                console.log(`ℹ️ Правила для порта ${port} -> ${destination} не найдены`);
                return true;
            }

            // Получаем ВСЕ handles за один раз
            const findCommand = `nft -a list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "dnat to ${destination.replace(/:/g, '\\:')}" | grep -o "handle [0-9]*" | awk '{print $2}'`;
            const findResult = await this.ssh.executeCommand(findCommand);
            
            const handles = findResult.stdout.split('\n')
                .filter(handle => handle.trim())
                .filter((handle, index, self) => self.indexOf(handle) === index); // Убираем дубликаты
            
            console.log(`🔧 Найдены handles для удаления: ${handles.join(', ')}`);
            
            let deletedCount = 0;
            
            // Удаляем ВСЕ найденные handles
            for (const handle of handles) {
                if (handle) {
                    try {
                        await this.ssh.executeCommand(`nft delete rule ip nat PREROUTING handle ${handle}`);
                        console.log(`✅ Удалено правило handle ${handle}`);
                        deletedCount++;
                        
                        // Пауза между удалениями
                        await new Promise(resolve => setTimeout(resolve, 200));
                    } catch (error) {
                        console.log(`⚠️ Не удалось удалить handle ${handle}: ${error.message}`);
                    }
                }
            }
            
            console.log(`✅ Удалено ${deletedCount} правил для порта ${port} -> ${destination}`);
            
            // Финальная проверка с обновлением кэша
            await new Promise(resolve => setTimeout(resolve, 500));
            const finalCountCommand = `nft -a list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "dnat to ${destination.replace(/:/g, '\\:')}" | wc -l`;
            const finalCountResult = await this.ssh.executeCommand(finalCountCommand);
            const finalCount = parseInt(finalCountResult.stdout);
            
            if (finalCount === 0) {
                console.log(`✅ Все правила успешно удалены`);
            } else {
                console.log(`⚠️ Осталось ${finalCount} правил`);
                // Покажем оставшиеся правила для диагностики
                const remainingCommand = `nft -a list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "dnat to ${destination.replace(/:/g, '\\:')}"`;
                const remainingResult = await this.ssh.executeCommand(remainingCommand);
                console.log(`📋 Оставшиеся правила:\n${remainingResult.stdout}`);
            }
            
        } else {
            // Код для legacy iptables остается без изменений
            const findCommand = `iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | grep "${destination}" | awk '{print $1}'`;
            const findResult = await this.ssh.executeCommand(findCommand);
            
            const lineNumbers = findResult.stdout.split('\n').filter(line => line.trim());
            
            for (let i = lineNumbers.length - 1; i >= 0; i--) {
                const lineNum = lineNumbers[i];
                await this.ssh.executeCommand(`iptables -t nat -D PREROUTING ${lineNum}`);
                console.log(`✅ Удалено правило PREROUTING строка ${lineNum}`);
            }
        }
        
        return true;
    } catch (error) {
        console.log(`❌ Ошибка удаления правил: ${error.message}`);
        return false;
    }
}
    /**
     * Добавляет правило в НАЧАЛО цепочки
     */
    async addRule(port, destination, iface = 'internet') {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                // Простая команда для добавления в начало
                const rule = `nft insert rule ip nat PREROUTING iifname ${iface} tcp dport ${port} dnat to ${destination}`;
                console.log(`🔧 Добавляем правило В НАЧАЛО: ${rule}`);
                const result = await this.ssh.executeCommand(rule);
                
                if (result.stderr) {
                    throw new Error(result.stderr);
                }
                
                console.log(`✅ Добавлено правило В НАЧАЛО: порт ${port} -> ${destination}`);
                return true;
                
            } else {
                const rule = `iptables -t nat -I PREROUTING 1 -i ${iface} -p tcp -m tcp --dport ${port} -j DNAT --to-destination ${destination}`;
                console.log(`🔧 Добавляем iptables правило: ${rule}`);
                const result = await this.ssh.executeCommand(rule);
                
                if (result.stderr && result.stderr.includes('Permission denied')) {
                    throw new Error('Недостаточно прав для выполнения iptables команд.');
                }
                
                console.log(`✅ Добавлено правило: порт ${port} -> ${destination}`);
                return true;
            }
        } catch (error) {
            console.error(`❌ Ошибка добавления правила:`, error);
            throw error;
        }
    }

    /**
     * Обновляет правило (удаляет ВСЕ старые, добавляет новое в НАЧАЛО)
     */
    async updateRule(port, destination, iface = 'internet') {
        console.log(`🔄 Обновление правила: порт ${port} -> ${destination}`);
        
        // 1. Удаляем ВСЕ существующие правила для этого порта и destination
        await this.deleteRule(port, destination);
        
        // 2. Добавляем новое правило в НАЧАЛО
        await this.addRule(port, destination, iface);
        
        console.log(`✅ Правило обновлено: порт ${port} -> ${destination}`);
    }

    /**
     * Получает handle правила по порту и destination
     */
    async getRuleHandle(port, destination) {
        try {
            const escapedDestination = destination.replace(/:/g, '\\:');
            const command = `nft list ruleset -a | grep "tcp dport ${port}" | grep "dnat to ${escapedDestination}" | grep -o "handle [0-9]*" | awk '{print $2}' | head -1`;
            const result = await this.ssh.executeCommand(command);
            return result.stdout.trim();
        } catch (error) {
            console.log(`⚠️ Не удалось найти handle правила: ${error.message}`);
            return null;
        }
    }

    /**
     * Показывает порядок правил для порта
     */
    async showRuleOrder(port) {
        try {
            const command = `nft list chain ip nat PREROUTING | grep -n "tcp dport ${port}"`;
            const result = await this.ssh.executeCommand(command);
            console.log(`📋 Порядок правил для порта ${port}:`);
            if (result.stdout) {
                result.stdout.split('\n').forEach(line => {
                    console.log(`   ${line}`);
                });
            } else {
                console.log('   Правила не найдены');
            }
        } catch (error) {
            console.error('❌ Ошибка показа порядка правил:', error);
        }
    }

    /**
     * Удаляет ВСЕ правила для порта (любые destination)
     */
    async deleteAllRulesForPort(port) {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                const findCommand = `nft list ruleset -a | grep "tcp dport ${port}" | grep -o "handle [0-9]*" | awk '{print $2}'`;
                const findResult = await this.ssh.executeCommand(findCommand);
                
                const handles = findResult.stdout.split('\n').filter(handle => handle.trim());
                
                let deletedCount = 0;
                for (const handle of handles) {
                    if (handle) {
                        await this.ssh.executeCommand(`nft delete rule ip nat PREROUTING handle ${handle}`);
                        console.log(`✅ Удалено правило handle ${handle}`);
                        deletedCount++;
                    }
                }
                
                console.log(`✅ Удалено ${deletedCount} правил для порта ${port}`);
                
            } else {
                const findCommand = `iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | awk '{print $1}'`;
                const findResult = await this.ssh.executeCommand(findCommand);
                
                const lineNumbers = findResult.stdout.split('\n').filter(line => line.trim());
                
                for (let i = lineNumbers.length - 1; i >= 0; i--) {
                    const lineNum = lineNumbers[i];
                    await this.ssh.executeCommand(`iptables -t nat -D PREROUTING ${lineNum}`);
                    console.log(`✅ Удалено правило строка ${lineNum}`);
                }
            }
            
            return true;
        } catch (error) {
            console.log(`ℹ️ Правила для порта ${port} не найдены: ${error.message}`);
            return false;
        }
    }

    /**
     * Показывает первые правила PREROUTING
     */
    async showFirstRules(count = 10) {
        try {
            const command = `nft list chain ip nat PREROUTING | head -${count + 2}`;
            const result = await this.ssh.executeCommand(command);
            console.log(`📋 Первые ${count} правил PREROUTING:`);
            console.log(result.stdout);
        } catch (error) {
            console.error('❌ Ошибка показа правил:', error);
        }
    }
}