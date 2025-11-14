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
                const command = `nft list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "dnat to ${destination}"`;
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

    async deleteRule(port, destination) {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                console.log(`🔧 Удаление правил nftables: порт ${port} -> ${destination}`);
                
                // ✅ ИЩЕМ ТОЛЬКО ПРАВИЛА С ЭТИМ PORT И DESTINATION
                const findCommand = `nft -a list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "dnat to ${destination}" | grep -o "handle [0-9]*" | awk '{print $2}'`;
                const findResult = await this.ssh.executeCommand(findCommand);
                
                const handles = findResult.stdout.split('\n').filter(handle => handle.trim());
                
                for (const handle of handles) {
                    if (handle) {
                        await this.ssh.executeCommand(`nft delete rule ip nat PREROUTING handle ${handle}`);
                        console.log(`✅ Удалено правило handle ${handle} (порт ${port} -> ${destination})`);
                    }
                }
                
            } else {
                // ✅ ДЛЯ IPTABLES: УДАЛЯЕМ ТОЛЬКО ПРАВИЛА С ЭТИМ PORT И DESTINATION
                const findCommand = `iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | grep "${destination}" | awk '{print $1}' | sort -rn`;
                const findResult = await this.ssh.executeCommand(findCommand);
                
                const lineNumbers = findResult.stdout.split('\n').filter(line => line.trim());
                
                for (const lineNum of lineNumbers) {
                    if (lineNum.trim()) {
                        await this.ssh.executeCommand(`iptables -t nat -D PREROUTING ${lineNum.trim()}`);
                        console.log(`✅ Удалено правило строка ${lineNum} (порт ${port} -> ${destination})`);
                    }
                }
            }
            
            return true;
        } catch (error) {
            console.log(`ℹ️ Правила для порта ${port} -> ${destination} не найдены: ${error.message}`);
            return false;
        }
    }

    async addRule(port, destination, iface = null) {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                let rule;
                
                if (iface) {
                    // ✅ ДОБАВЛЯЕМ В САМОЕ НАЧАЛО
                    rule = `nft insert rule ip nat PREROUTING position 0 iifname "${iface}" tcp dport ${port} dnat to ${destination}`;
                } else {
                    // ✅ ДОБАВЛЯЕМ В САМОЕ НАЧАЛО
                    rule = `nft insert rule ip nat PREROUTING position 0 tcp dport ${port} dnat to ${destination}`;
                }
                
                console.log(`🔧 Добавляем nftables правило В НАЧАЛО: ${rule}`);
                const result = await this.ssh.executeCommand(rule);
                
                if (result.stderr) {
                    // Пробуем добавить без position если не поддерживается
                    if (result.stderr.includes('position') || result.stderr.includes('Position') || 
                        result.stderr.includes('Invalid position')) {
                        console.log(`⚠️ Position не поддерживается, пробуем обычное добавление...`);
                        const altRule = rule.replace('insert rule ip nat PREROUTING position 0', 'add rule ip nat PREROUTING');
                        const altResult = await this.ssh.executeCommand(altRule);
                        
                        if (altResult.stderr) {
                            throw new Error(`nftables error: ${altResult.stderr}`);
                        }
                        console.log(`✅ Правило добавлено (без position): порт ${port} -> ${destination}`);
                    } else {
                        throw new Error(`nftables error: ${result.stderr}`);
                    }
                } else {
                    console.log(`✅ Правило добавлено В НАЧАЛО цепочки: порт ${port} -> ${destination}`);
                }
                
                return true;
                
            } else {
                let rule;
                
                if (iface) {
                    rule = `iptables -t nat -I PREROUTING 1 -i ${iface} -p tcp -m tcp --dport ${port} -j DNAT --to-destination ${destination}`;
                } else {
                    rule = `iptables -t nat -I PREROUTING 1 -p tcp -m tcp --dport ${port} -j DNAT --to-destination ${destination}`;
                }
                
                console.log(`🔧 Добавляем iptables правило: ${rule}`);
                const result = await this.ssh.executeCommand(rule);
                
                if (result.stderr) {
                    if (result.stderr.includes('Permission denied')) {
                        throw new Error('Недостаточно прав для выполнения iptables команд.');
                    }
                    throw new Error(`iptables error: ${result.stderr}`);
                }
                
                console.log(`✅ Добавлено правило: порт ${port} -> ${destination}${iface ? ` (интерфейс: ${iface})` : ' (все интерфейсы)'}`);
                return true;
            }
        } catch (error) {
            console.error(`❌ Ошибка добавления правила:`, error);
            throw error;
        }
    }

    async updateRule(port, destination, iface = null) {
        console.log(`🔄 Обновление правила: порт ${port} -> ${destination}${iface ? ` (интерфейс: ${iface})` : ' (все интерфейсы)'}`);
        
        try {
            // ✅ УДАЛЯЕМ ТОЛЬКО ПРАВИЛА ДЛЯ ЭТОГО DESTINATION
            const deleted = await this.deleteRule(port, destination);
            
            if (!deleted) {
                console.log(`⚠️ Не удалось удалить старые правила, продолжаем...`);
            }
            
            // ✅ ДОБАВЛЯЕМ НОВОЕ ПРАВИЛО
            await this.addRule(port, destination, iface);
            
            console.log(`✅ Правило обновлено: порт ${port} -> ${destination}${iface ? ` (интерфейс: ${iface})` : ' (все интерфейсы)'}`);
            return true;
            
        } catch (error) {
            console.error(`❌ Ошибка обновления правила:`, error);
            throw error;
        }
    }


    async deleteAllRulesForPort(port) {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                const findCommand = `nft -a list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep -o "handle [0-9]*" | awk '{print $2}'`;
                const findResult = await this.ssh.executeCommand(findCommand);
                
                const handles = findResult.stdout.split('\n').filter(handle => handle.trim());
                
                let deletedCount = 0;
                for (const handle of handles) {
                    if (handle) {
                        try {
                            await this.ssh.executeCommand(`nft delete rule ip nat PREROUTING handle ${handle}`);
                            console.log(`✅ Удалено правило handle ${handle}`);
                            deletedCount++;
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (error) {
                            console.log(`⚠️ Не удалось удалить handle ${handle}: ${error.message}`);
                        }
                    }
                }
                
                console.log(`✅ Удалено ${deletedCount} правил для порта ${port}`);
                return deletedCount > 0;
                
            } else {
                const findCommand = `iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | awk '{print $1}' | sort -rn`;
                const findResult = await this.ssh.executeCommand(findCommand);
                
                const lineNumbers = findResult.stdout.split('\n').filter(line => line.trim());
                
                let deletedCount = 0;
                for (const lineNum of lineNumbers) {
                    if (lineNum.trim()) {
                        try {
                            await this.ssh.executeCommand(`iptables -t nat -D PREROUTING ${lineNum.trim()}`);
                            console.log(`✅ Удалено правило строка ${lineNum}`);
                            deletedCount++;
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (error) {
                            console.log(`⚠️ Не удалось удалить строку ${lineNum}: ${error.message}`);
                        }
                    }
                }
                
                console.log(`✅ Удалено ${deletedCount} правил для порта ${port}`);
                return deletedCount > 0;
            }
        } catch (error) {
            console.log(`ℹ️ Правила для порта ${port} не найдены: ${error.message}`);
            return false;
        }
    }


    async showFirstRules(count = 10) {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                const command = `nft list chain ip nat PREROUTING | head -${count + 2}`;
                const result = await this.ssh.executeCommand(command);
                console.log(`📋 Первые ${count} правил PREROUTING (nftables):`);
                console.log(result.stdout || 'Правил нет');
            } else {
                const command = `iptables -t nat -L PREROUTING -n --line-numbers | head -${count + 2}`;
                const result = await this.ssh.executeCommand(command);
                console.log(`📋 Первые ${count} правил PREROUTING (iptables):`);
                console.log(result.stdout || 'Правил нет');
            }
        } catch (error) {
            console.error('❌ Ошибка показа правил:', error);
        }
    }

    async debugPortRules(port) {
        try {
            const backend = await this.detectBackend();
            console.log(`🔍 ДЕБАГ Правила для порта ${port} (${backend}):`);
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                const command = `nft list chain ip nat PREROUTING | grep -A 2 -B 2 "dport ${port}" || echo "Правила не найдены"`;
                const result = await this.ssh.executeCommand(command);
                console.log(result.stdout);
            } else {
                const command = `iptables -t nat -L PREROUTING -n --line-numbers | grep -A 2 -B 2 ":${port} " || echo "Правила не найдены"`;
                const result = await this.ssh.executeCommand(command);
                console.log(result.stdout);
            }
        } catch (error) {
            console.error('❌ Ошибка отладки:', error);
        }
    }
}