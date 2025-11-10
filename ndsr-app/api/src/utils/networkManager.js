import { SSHManager } from '../actions/sshManager.js';
import { HOST_CONFIG } from './hostConfig.js';

export class NetworkManager {
    constructor(sshManager) {
        this.ssh = sshManager;
    }

    /**
     * Определяет имя интерфейса из имени Docker контейнера
     */
    async getInterfaceFromContainer(containerName) {
        try {
            console.log(`🔧 Определение интерфейса для контейнера: ${containerName}`);
            
            // ✅ ПОЛУЧАЕМ ИМЯ СЕТИ И ПРЕОБРАЗУЕМ В ИНТЕРФЕЙС
            const networkCommand = `docker inspect ${containerName} --format='{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | grep -oE "^[a-z]{2}[0-9]+" | head -1`;
            console.log(`🔧 Выполняем команду: ${networkCommand}`);
            
            const networkResult = await this.ssh.executeCommand(networkCommand);
            const networkName = networkResult.stdout.trim();
            
            console.log(`📋 Результат команды: "${networkName}"`);
            
            if (networkName) {
                const interfaceName = networkName + '0';
                console.log(`✅ Определен интерфейс из контейнера: ${interfaceName}`);
                return interfaceName;
            }
            
            throw new Error(`Не удалось определить интерфейс для контейнера ${containerName}`);
            
        } catch (error) {
            console.error(`❌ Ошибка определения интерфейса из контейнера:`, error);
            return 'eth0'; // fallback
        }
    }

    /**
     * Определяет подсеть для указанного интерфейса ВНУТРИ КОНТЕЙНЕРА
     */
    async getSubnetForInterface(containerName, interfaceName) {
        try {
            console.log(`🔧 Определение подсети для интерфейса ${interfaceName} в контейнере ${containerName}`);
            
            // ✅ ОСНОВНОЙ СПОСОБ: через ip route ВНУТРИ КОНТЕЙНЕРА
            const routeCommand = `docker exec ${containerName} ip route | grep ${interfaceName} | awk '{print $1}' | head -1`;
            console.log(`🔧 Выполняем команду в контейнере: ${routeCommand}`);
            const routeResult = await this.ssh.executeCommand(routeCommand);
            
            if (routeResult.stdout.trim()) {
                const subnet = routeResult.stdout.trim();
                console.log(`✅ Определена подсеть через ip route в контейнере: ${subnet}`);
                return subnet;
            }
            
            // ✅ АЛЬТЕРНАТИВНЫЙ СПОСОБ: через ip addr ВНУТРИ КОНТЕЙНЕРА
            const addrCommand = `docker exec ${containerName} ip addr show ${interfaceName} | grep "inet " | awk '{print $2}' | head -1`;
            console.log(`🔧 Выполняем команду в контейнере: ${addrCommand}`);
            const addrResult = await this.ssh.executeCommand(addrCommand);
            
            if (addrResult.stdout.trim()) {
                const ipWithMask = addrResult.stdout.trim();
                // Преобразуем IP/маску в подсеть
                const [ip, mask] = ipWithMask.split('/');
                const ipParts = ip.split('.');
                ipParts[3] = '0';
                const subnet = `${ipParts.join('.')}/${mask}`;
                
                console.log(`✅ Определена подсеть через ip addr в контейнере: ${subnet}`);
                return subnet;
            }
            
            // ✅ РЕЗЕРВНЫЙ СПОСОБ: через default route ВНУТРИ КОНТЕЙНЕРА
            const defaultRouteCommand = `docker exec ${containerName} ip route | grep default | awk '{print $3 "/24"}' | head -1`;
            console.log(`🔧 Выполняем команду в контейнере: ${defaultRouteCommand}`);
            const defaultRouteResult = await this.ssh.executeCommand(defaultRouteCommand);
            
            if (defaultRouteResult.stdout.trim()) {
                const gatewayWithMask = defaultRouteResult.stdout.trim();
                const [gatewayIp, mask] = gatewayWithMask.split('/');
                const ipParts = gatewayIp.split('.');
                ipParts[3] = '0';
                const subnet = `${ipParts.join('.')}/${mask}`;
                
                console.log(`✅ Определена подсеть через default route в контейнере: ${subnet}`);
                return subnet;
            }
            
            throw new Error(`Не удалось определить подсеть для интерфейса ${interfaceName} в контейнере ${containerName}`);
            
        } catch (error) {
            console.error(`❌ Ошибка определения подсети:`, error);
            throw error;
        }
    }

    /**
     * Получает полную конфигурацию сети для контейнера
     */
    async getNetworkConfig(containerName) {
        try {
            console.log(`🔧 Получение сетевой конфигурации для контейнера: ${containerName}`);
            
            const interfaceName = await this.getInterfaceFromContainer(containerName);
            console.log(`✅ Для контейнера ${containerName} определен интерфейс: ${interfaceName}`);
            
            const subnet = await this.getSubnetForInterface(containerName, interfaceName);
            console.log(`✅ Для интерфейса ${interfaceName} определена подсеть: ${subnet}`);
            
            const config = {
                interface: interfaceName,
                subnet: subnet,
                internetInterface: 'internet',
                containerName: containerName
            };
            
            console.log(`✅ Сетевая конфигурация получена:`, config);
            return config;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сетевой конфигурации:`, error);
            throw error;
        }
    }
}