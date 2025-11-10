import { SSHManager } from '../actions/sshManager.js';
import { NetworkManager } from './networkManager.js';

export class NftablesManager {
    constructor(sshManager) {
        this.ssh = sshManager;
    }

    /**
     * Проверяет использование nftables vs iptables
     */
    async detectBackend() {
        try {
            // Проверяем наличие nft
            const nftCheck = await this.ssh.executeCommand('which nft');
            if (nftCheck.stdout.includes('nft')) {
                console.log('✅ Обнаружен nftables');
                return 'nftables';
            }
            
            // Проверяем версию iptables
            const iptablesCheck = await this.ssh.executeCommand('iptables --version');
            if (iptablesCheck.stdout.includes('nf_tables')) {
                console.log('✅ Обнаружен iptables с nf_tables бэкендом');
                return 'nf_tables';
            }
            
            console.log('✅ Используется legacy iptables');
            return 'legacy';
            
        } catch (error) {
            console.error('❌ Ошибка определения бэкенда:', error);
            return 'legacy'; // fallback
        }
    }

    /**
     * Проверяет существование правила PREROUTING
     */
    async checkRuleExists(port, destinationIp) {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                // Для nftables
                const command = `nft list ruleset | grep "dport ${port}" | grep "${destinationIp}"`;
                const result = await this.ssh.executeCommand(command);
                return result.stdout.length > 0;
            } else {
                // Для legacy iptables
                const command = `iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | grep "${destinationIp}"`;
                const result = await this.ssh.executeCommand(command);
                return result.stdout.length > 0;
            }
        } catch (error) {
            console.log(`⚠️ Ошибка проверки правила: ${error.message}`);
            return false;
        }
    }

    /**
     * Удаляет правило PREROUTING
     */
    async deleteRule(port, destinationIp) {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                // Для nftables - нам нужно найти handle правила
                const findCommand = `nft list ruleset -a | grep "dport ${port}" | grep "${destinationIp}" | grep -o "handle [0-9]*" | awk '{print $2}'`;
                const findResult = await this.ssh.executeCommand(findCommand);
                
                const handles = findResult.stdout.split('\n').filter(handle => handle.trim());
                
                for (const handle of handles) {
                    if (handle) {
                        await this.ssh.executeCommand(`nft delete rule ip nat PREROUTING handle ${handle}`);
                        console.log(`✅ Удалено правило nftables handle ${handle}`);
                    }
                }
                
            } else {
                // Для legacy iptables
                const findCommand = `iptables -t nat -L PREROUTING -n --line-numbers | grep ":${port} " | grep "${destinationIp}" | awk '{print $1}'`;
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
            console.log(`ℹ️ Правило для порта ${port} не найдено или уже удалено: ${error.message}`);
            return false;
        }
    }

    /**
     * Добавляет новое правило PREROUTING
     */
    async addRule(port, destinationIp, iface = 'internet') {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                // Для nftables
                const rule = `nft add rule ip nat PREROUTING iifname ${iface} tcp dport ${port} dnat to ${destinationIp}`;
                console.log(`🔧 Добавляем nftables правило: ${rule}`);
                await this.ssh.executeCommand(rule);
                
            } else {
                // Для legacy iptables
                const rule = `iptables -t nat -I PREROUTING 1 -i ${iface} -p tcp -m tcp --dport ${port} -j DNAT --to-destination ${destinationIp}`;
                console.log(`🔧 Добавляем iptables правило: ${rule}`);
                await this.ssh.executeCommand(rule);
            }
            
            console.log(`✅ Добавлено правило: порт ${port} -> ${destinationIp}`);
            return true;
        } catch (error) {
            console.error(`❌ Ошибка добавления правила:`, error);
            throw error;
        }
    }

    /**
     * Обновляет правило (удаляет старое, добавляет новое)
     */
    async updateRule(port, destinationIp, iface = 'internet') {
        await this.deleteRule(port, destinationIp);
        await this.addRule(port, destinationIp, iface);
    }

    /**
     * Показывает все правила nftables
     */
    async showAllRules() {
        try {
            const backend = await this.detectBackend();
            
            if (backend === 'nftables' || backend === 'nf_tables') {
                const result = await this.ssh.executeCommand('nft list ruleset');
                console.log('📋 Все правила nftables:');
                console.log(result.stdout || 'ПУСТО');
            } else {
                const result = await this.ssh.executeCommand('iptables -t nat -L -n --line-numbers');
                console.log('📋 Все правила iptables:');
                console.log(result.stdout || 'ПУСТО');
            }
        } catch (error) {
            console.error('❌ Ошибка показа правил:', error);
        }
    }
}
