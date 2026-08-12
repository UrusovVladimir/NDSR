import {Telnet} from "telnet-client"

class TelnetConnection {
    constructor(host, login, password) {
        this.params = {
            host: host,
            port: "23",
            negotiationMandatory: false,
            timeout: 3500,
            sendTimeout: 2500,
            login: login,
            password: password,
            ors: '\r\n'
        };
        this.connection = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            if (this.connection) {
                try {
                    await this.connection.end();
                } catch (e) {}
                this.connection = null;
            }

            this.connection = new Telnet();
            await this.connection.connect(this.params);
            console.log("Соединение установлено");
            this.isConnected = true;
            
            // Отправляем логин
            await this.connection.send(this.params.login);
            
            // Задержка для стабилизации
            await new Promise(resolve => setTimeout(resolve, 200));
            
            return true;
        } catch (error) {
            console.error("Ошибка при установлении соединения:", error);
            this.isConnected = false;
            throw error;
        }
    }

    async end() {
        try {
            if (this.connection) {
                await this.connection.end();
                console.log("Соединение завершено");
            }
        } catch (error) {
            console.error("Ошибка при завершении соединения:", error);
        } finally {
            this.connection = null;
            this.isConnected = false;
        }
    }

    async executeCommand(cmd, arg, prompt) {
        if (!this.connection) {
            throw new Error("Соединение не установлено!! Аварийный выход");
        }
    
        const command = arg ? `${cmd} ${arg}` : cmd;
        
        try {
            const res = await this.connection.exec(command, { 
                shellPrompt: prompt || /[#>$]\s*$/,
                timeout: 10000
            });
            return res;
        } catch (error) {
            console.error("Ошибка выполнения команды:", error.message);
            
            // Проверяем, является ли ошибка фатальной для соединения
            if (error.message && (
                error.message.includes('socket not writable') || 
                error.message.includes('closed') ||
                error.message.includes('Connection lost')
            )) {
                // Переподключаемся
                console.log("🔄 Переподключение после разрыва соединения...");
                await this.connect();
                
                // ✅ ВАЖНО: Не пытаемся повторить команду здесь!
                // Вместо этого выбрасываем специальную ошибку,
                // которую обработает вызывающий код
                throw new Error('RECONNECTED');
            }
            
            throw error;
        }
    }
}

export {
    TelnetConnection
}