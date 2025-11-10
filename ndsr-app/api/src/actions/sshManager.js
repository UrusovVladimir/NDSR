// [file name]: sshManager.js (ОБНОВЛЕННЫЙ)
import { Client } from 'ssh2';
import fs from 'fs';

export class SSHManager {
    constructor(host, port = 22, username, privateKeyPath, useSudo = true) {
        this.host = host;
        this.port = port;
        this.username = username;
        this.privateKeyPath = privateKeyPath;
        this.useSudo = useSudo;
        this.conn = new Client();
    }

    /**
     * Подключается к хосту по SSH с использованием ключа
     */
    connect() {
        return new Promise((resolve, reject) => {
            // Читаем приватный ключ
            const privateKey = fs.readFileSync(this.privateKeyPath);
            
            this.conn.on('ready', () => {
                console.log(`✅ SSH подключение установлено к ${this.host}`);
                resolve();
            }).on('error', (err) => {
                console.error(`❌ Ошибка SSH подключения к ${this.host}:`, err);
                reject(err);
            }).connect({
                host: this.host,
                port: this.port,
                username: this.username,
                privateKey: privateKey
            });
        });
    }

    /**
     * Выполняет команду на удаленном хосте с поддержкой sudo
     */
    executeCommand(command, useSudo = this.useSudo) {
        return new Promise((resolve, reject) => {
            // Добавляем sudo если нужно
            const finalCommand = useSudo ? `sudo ${command}` : command;
            
            this.conn.exec(finalCommand, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let stdout = '';
                let stderr = '';

                stream.on('close', (code, signal) => {
                    console.log(`🔧 Команда выполнена: ${finalCommand}`);
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code, signal });
                }).on('data', (data) => {
                    stdout += data.toString();
                }).stderr.on('data', (data) => {
                    stderr += data.toString();
                });
            });
        });
    }

    /**
     * Закрывает SSH соединение
     */
    disconnect() {
        this.conn.end();
        console.log(`🔌 SSH подключение к ${this.host} закрыто`);
    }
}