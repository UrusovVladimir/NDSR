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

    async executeCommand(cmd, arg, prompt) {
        if (!this.connection) {
            throw new Error("Соединение не установлено!!Аварийный выход");
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

export{
    TelnetConnection
}
