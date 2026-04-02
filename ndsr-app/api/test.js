import { Telnet } from "telnet-client";

class JeromeClient {
    constructor(host, port = 2424) {
        this.host = host;
        this.port = port;
        this.connection = null;
    }
    
    async connect() {
        if (this.connection) return;
        
        this.connection = new Telnet();
        await this.connection.connect({
            host: this.host,
            port: this.port,
            negotiationMandatory: false,
            timeout: 2000,
            sendTimeout: 2000,
            execTimeout: 3000,
        });
        
        // Минимальная задержка после подключения
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    async getPortStatus(portNumber) {
        await this.connect();
        
        const response = await this.connection.send(`$KE,RID,${portNumber}`, { 
            ors: "\r\n",
            waitfor: /#RID,\d+,\d+/
        });
        
        const match = response.match(/#RID,(\d+),(\d+)/);
        if (match) {
            return {
                port: parseInt(match[1]),
                status: match[2] === '1' ? 'on' : 'off'
            };
        }
        
        return null;
    }
    
    async end() {
        if (this.connection) {
            await this.connection.end();
            this.connection = null;
        }
    }
}

// Тестирование
(async () => {
    const startTime = Date.now();
    const jerome = new JeromeClient("172.16.77.246", 2424);
    
    try {
        // Проверяем несколько портов за одно соединение
        for (let i = 1; i <= 11; i++) {
            const status = await jerome.getPortStatus(i);
            console.log(`Port ${status.port}: ${status.status === 'on' ? '🟢 ON' : '🔴 OFF'}`);
        }
        
        const endTime = Date.now();
        console.log(`\n⏱️ Total time for 3 ports: ${endTime - startTime}ms`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await jerome.end();
    }
})();