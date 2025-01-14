import {Telnet} from "telnet-client"
class TelnetConnection {
    constructor(host,login,password) {
        this.params = {
            host: host,
            port: "23",
            negotiationMandatory: false,
            timeout: 3500,
            sendTimeout: 2500,
            login: login,
            password: password
        };
        this.connection = null;
    }

    async connect() {
        try {
            this.connection = new Telnet();
            await this.connection.connect(this.params);
            console.log("Соединение установлено");
            await this.connection.send(this.params.login);
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

    async executeCommand(cmd, arg, prompt) {
        if (!this.connection) {
            throw new Error("Сначала установите соединение");
        }

        const command = arg ? `${cmd} ${arg}` : cmd;
        try {
            const res = await this.connection.exec(command, { shellPrompt: prompt });
            console.log(command, res);
            return res;
        } catch (error) {
            console.error("Ошибка выполнения команды:", error);
            throw error;
        }
    }
}

// Пример использования
(async () => {
    const telnetConnection = new TelnetConnection("192.168.77.112");

    try {
        await telnetConnection.connect();
        const result = await telnetConnection.executeCommand("show login",null,/MGS3520-Techsupport[# ]/i);
        console.log("Результат команды:", result);
    } catch (error) {
        console.error("Ошибка:", error);
    } finally {
        await telnetConnection.end();
    }
})();