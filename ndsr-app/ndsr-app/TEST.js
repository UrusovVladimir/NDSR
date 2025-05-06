import {Telnet} from "telnet-client"
const VES_LOGIN="admin"
const VES_PASSWORD="6Crz7QLR"
const VES_IP="192.168.77.99"
const VES_PORT="23"
const PVID = wanTypes.find(command => "adslIPoe" === command.setting)

class TelnetConnection {
    constructor(host,login,password,port) {
        this.params = {
            host: host,
            port: port,
            timeout: 3500,
            sendTimeout: 2500,
            loginPrompt: 'User name: ',
            passwordPrompt: 'Password: ',
            username: login,
            password: password,
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
            console.log("Получено:",command, res);
            console.log(res)
            return res;
        } catch (error) {
            console.error("Ошибка выполнения команды:", error);
            throw error;
        }
    }
}

const connection = new TelnetConnection(VES_IP,VES_LOGIN,VES_PASSWORD,VES_PORT);
connection.connect().then(() => {
    connection.executeCommand(`switch vlan pvid ${port} ${vlan}`, null, /ras> /).then(() => {
    connection.end();
    });
    
});
