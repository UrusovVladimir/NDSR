import {Telnet} from "telnet-client"
class TelnetConnection {
    constructor(host,login,password,port) {
        this.params = {
            host: host,
            port: port,
            negotiationMandatory: false,
            timeout: 3500,
            sendTimeout: 2500,
            loginPrompt: 'User name: ',
            passwordPrompt: 'Password: ',
            username: process.env.VES_LOGIN,
            password: process.env.VES_PASSWORD,
            shellPrompt: 'ras> '
        };
        this.connection = null;
    }

    async connect() {
        try {
            this.connection = new Telnet();
            await this.connection.connect(this.params);
            console.log("Соединение установлено");
        } catch (error) {
            console.error("Ошибка при установлении соединения:", error);
            throw error;
        }
    }

    async end() {
        if (this.connection) {
            await this.connection.end();
            console.log("Соединение завершено");
        } else {
            console.log("Соединение не было установлено");
        }
    }

    async executeCommand(command, params = null, promptRegex) {
        // ✅ ПРОВЕРЯЕМ СОЕДИНЕНИЕ ПЕРЕД ВЫПОЛНЕНИЕМ
        if (!this.connection || !this.connection.isConnected) {
            console.error(`❌ Telnet connection is not established. Reconnecting...`);
            await this.connect();
        }
        
        let fullCommand = command;
        if (params !== null && params !== undefined) {
            fullCommand = `${command} ${params}`;
        }
        
        console.log(`📤 Executing command: ${fullCommand}`);
        
        try {
            const result = await this.connection.exec(fullCommand, {
                shellPrompt: promptRegex,
                timeout: 15000,
                execCommand: false
            });
            return result;
        } catch (error) {
            console.error(`❌ Error executing command: ${fullCommand}`, error.message);
            throw error;
        }
    }

    async reconnect() {
        if (this.connection) {
            try {
                await this.connection.end();
            } catch (e) {
                // ignore
            }
        }
        await this.connect();
    }
}
export{
    TelnetConnection
}
