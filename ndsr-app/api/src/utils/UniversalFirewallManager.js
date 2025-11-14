import { NftablesManager } from './nftablesManager.js';

export class UniversalFirewallManager {
    constructor(sshManager) {
        this.ssh = sshManager;
        this.nftManager = new NftablesManager(sshManager);
    }

    /**
     * Проверяет существование правила
     */
    async checkRuleExists(port, destinationIp) {
        return await this.nftManager.checkRuleExists(port, destinationIp);
    }

    /**
     * Удаляет правило
     */
    async deleteRule(port, destinationIp) {
        return await this.nftManager.deleteRule(port, destinationIp);
    }

    /**
     * Добавляет правило в НАЧАЛО цепочки
     */
    async addRule(port, destinationIp, iface = null) { 
        return await this.nftManager.addRule(port, destinationIp, iface);
    }

    /**
     * Обновляет правило (удаляет ВСЕ старые, добавляет новое в НАЧАЛО)
     */
    async updateRule(port, destinationIp, iface = null) {  
        return await this.nftManager.updateRule(port, destinationIp, iface);
    }
    /**
     * Показывает все правила
     */
    async showAllRules() {
        return await this.nftManager.showAllRules();
    }

    /**
     * Показывает порядок правил для порта
     */
    async showRuleOrder(port) {
        return await this.nftManager.showRuleOrder(port);
    }

    /**
     * Удаляет ВСЕ правила для порта
     */
    async deleteAllRulesForPort(port) {
        return await this.nftManager.deleteAllRulesForPort(port);
    }

    async removeRule(deviceIp,port) {
        try {
            console.log(`🔧 Удаление правила фаервола для порта ${deviceIp}:${port}`);
            
            // ✅ УДАЛЯЕМ ПРАВИЛО В ТАБЛИЦЕ NAT
            const removeNatRule = `iptables -t nat -D PREROUTING -p tcp --dport ${port} -j DNAT --to-destination ${deviceIp}:${port} 2>/dev/null || true`;
            await this.ssh.executeCommand(removeNatRule);
            
            // // ✅ УДАЛЯЕМ ПРАВИЛО В ТАБЛИЦЕ FILTER
            // const removeFilterRule = `iptables -D FORWARD -p tcp --dport ${port} -j ACCEPT 2>/dev/null || true`;
            // await this.ssh.executeCommand(removeFilterRule);
            
            console.log(`✅ Правила фаервола удалены для порта адреса ${deviceIp} и порт ${port}`);
            return true;
        } catch (error) {
            console.error(`❌ Ошибка удаления правила фаервола:`, error);
            throw error;
        }
    }
}