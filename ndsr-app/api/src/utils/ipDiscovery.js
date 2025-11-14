import { getParamRouter } from '../devices.js';
import { makeAuthenticatedRequest, sessionManager } from '../actions/athentication.js';

export class IpDiscoveryService {
    /**
     * Умный запрос DHCP bindings с кэшированием сессий
     */
    static async getDhcpBindingsSmart(routerUrl, routerPassword = null) {
        try {
            console.log(`🔧 Умный запрос DHCP bindings: ${routerUrl}`);
            
            // ✅ ПРОБУЕМ С КЭШИРОВАННОЙ СЕССИЕЙ СНАЧАЛА
            try {
                const dhcpBindings = await makeAuthenticatedRequest(
                    routerUrl,
                    'admin',
                    routerPassword,
                    '/rci/show/ip/dhcp/bindings',
                    'GET'
                );

                console.log(`✅ DHCP bindings получены (с кэшированной сессией)`);
                return dhcpBindings;

            } catch (error) {
                console.error(`❌ Ошибка получения DHCP bindings:`, error.message);
                throw error;
            }

        } catch (error) {
            console.error(`❌ Критическая ошибка получения DHCP bindings:`, error);
            throw error;
        }
    }

    /**
     * Получает IP адрес extender'а через DHCP bindings роутера
     */
    static async getExtenderIpFromRouter(routerId, extenderMac, routerPassword = null, maxAttempts = 10, delay = 5000) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`🔧 Попытка ${attempt}/${maxAttempts} получения IP extender'а ${extenderMac} через DHCP bindings`);
                
                const router = getParamRouter(routerId);
                if (!router) {
                    throw new Error(`Роутер ${routerId} не найден`);
                }
    
                // ✅ ИСПОЛЬЗУЕМ УМНЫЙ ЗАПРОС
                const dhcpBindings = await this.getDhcpBindingsSmart(router.URL, routerPassword);
    
                console.log(`📋 Получены DHCP bindings (попытка ${attempt}):`, 
                    dhcpBindings?.lease?.length || 0, 'записей');
    
                if (!dhcpBindings || !Array.isArray(dhcpBindings.lease)) {
                    console.log(`⚠️ Некорректный ответ DHCP bindings, пробуем ARP таблицу...`);
                    // Пробуем получить через ARP таблицу
                    try {
                        const arpIp = await this.getExtenderIpFromArp(routerId, extenderMac, routerPassword);
                        if (arpIp) {
                            console.log(`✅ Найден IP через ARP таблицу: ${arpIp}`);
                            return arpIp;
                        }
                    } catch (arpError) {
                        console.log(`⚠️ ARP метод также не сработал: ${arpError.message}`);
                    }
                    throw new Error('Некорректный ответ от роутера при запросе DHCP bindings');
                }
    
                // ✅ УЛУЧШЕННОЕ СРАВНЕНИЕ MAC-АДРЕСОВ
                const normalizedTargetMac = this.normalizeMac(extenderMac);
                console.log(`🔍 Ищем MAC: ${extenderMac} -> нормализованный: ${normalizedTargetMac}`);
                
                const extenderBinding = dhcpBindings.lease.find(binding => {
                    if (!binding.mac) return false;
                    const bindingMac = this.normalizeMac(binding.mac);
                    console.log(`  📝 Сравниваем с: ${binding.mac} -> ${bindingMac}`);
                    return bindingMac === normalizedTargetMac;
                });
    
                if (!extenderBinding) {
                    console.log(`⌛ Extender еще не появился в DHCP bindings (попытка ${attempt}/${maxAttempts})`);
                    
                    if (attempt === maxAttempts) {
                        // Детальный лог для диагностики
                        console.log('📋 Все MAC адреса в DHCP bindings:');
                        dhcpBindings.lease.forEach((binding, index) => {
                            console.log(`  ${index + 1}. MAC: ${binding.mac} -> IP: ${binding.ip} (нормализованный: ${this.normalizeMac(binding.mac)})`);
                        });
                        console.log(`🔍 Ищем: ${extenderMac} (нормализованный: ${normalizedTargetMac})`);
                        
                        // Пробуем ARP как последнюю попытку
                        try {
                            const arpIp = await this.getExtenderIpFromArp(routerId, extenderMac, routerPassword);
                            if (arpIp) {
                                console.log(`✅ Найден IP через ARP таблицу (последняя попытка): ${arpIp}`);
                                return arpIp;
                            }
                        } catch (arpError) {
                            console.log(`⚠️ ARP метод также не сработал: ${arpError.message}`);
                        }
                        
                        throw new Error(`Extender с MAC ${extenderMac} не появился в DHCP bindings после ${maxAttempts} попыток. Проверьте подключение устройства к роутеру.`);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
    
                if (!extenderBinding.ip) {
                    console.log(`⌛ У extender'а еще не назначен IP адрес в DHCP (попытка ${attempt}/${maxAttempts})`);
                    
                    if (attempt === maxAttempts) {
                        throw new Error(`У extender'а не назначен IP адрес в DHCP после ${maxAttempts} попыток`);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
    
                console.log(`✅ Найден IP extender'а через DHCP: ${extenderBinding.ip} (попытка ${attempt})`);
                return extenderBinding.ip;
    
            } catch (error) {
                lastError = error;
                console.log(`⚠️ Ошибка получения IP через DHCP (попытка ${attempt}/${maxAttempts}): ${error.message}`);
                
                if (attempt === maxAttempts) {
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    
        throw lastError || new Error(`Не удалось получить IP адрес extender'а после ${maxAttempts} попыток`);
    }

    /**
     * Альтернативный метод получения IP через ARP таблицу
     */
    static async getExtenderIpFromArp(routerId, extenderMac, routerPassword = null) {
        try {
            console.log(`🔍 Пробуем получить IP через ARP таблицу для MAC: ${extenderMac}`);
            
            const router = getParamRouter(routerId);
            if (!router) {
                throw new Error(`Роутер ${routerId} не найден`);
            }

            const arpTable = await makeAuthenticatedRequest(
                router.URL,
                'admin',
                routerPassword,
                '/rci/show/ip/arp',
                'GET'
            );

            console.log('📊 ARP таблица получена, записей:', arpTable?.ip?.length || 0);

            if (!arpTable || !arpTable.ip || !Array.isArray(arpTable.ip)) {
                throw new Error('Некорректный ответ от роутера при запросе ARP таблицы');
            }

            const normalizedTargetMac = this.normalizeMac(extenderMac);

            const arpEntry = arpTable.ip.find(entry => 
                entry.mac && this.normalizeMac(entry.mac) === normalizedTargetMac
            );

            if (arpEntry && arpEntry.ip && arpEntry.ip !== '0.0.0.0') {
                console.log(`✅ Найден IP через ARP таблицу: ${arpEntry.ip}`);
                return arpEntry.ip;
            }

            throw new Error('Extender не найден в ARP таблице');

        } catch (error) {
            console.log(`⚠️ Не удалось получить IP через ARP: ${error.message}`);
            throw error;
        }
    }

    /**
     * Комбинированный метод получения IP
     */
    static async getExtenderIp(extenderId, routerId, routerPassword = null) {
        const device = getDeviceById(extenderId);
        if (!device) {
            throw new Error(`Устройство ${extenderId} не найдено`);
        }

        console.log(`🔍 Комбинированный поиск IP для ${device.macAddress}`);

        try {
            // Сначала пробуем через DHCP bindings
            return await this.getExtenderIpFromRouter(routerId, device.macAddress, routerPassword, 8, 3000);
        } catch (dhcpError) {
            console.log(`⚠️ DHCP метод не сработал: ${dhcpError.message}`);
            console.log(`🔄 Пробуем через ARP таблицу...`);
            
            try {
                // Пробуем через ARP таблицу
                return await this.getExtenderIpFromArp(routerId, device.macAddress, routerPassword);
            } catch (arpError) {
                console.log(`❌ Оба метода не сработали: ${arpError.message}`);
                
                const router = getParamRouter(routerId);
                if (!router) {
                    throw new Error(`Роутер не найден`);
                }
                
                console.log(`🔄 Используем IP роутера для проброса: ${router.ip}`);
                return router.ip;
            }
        }
    }

    /**
     * Нормализует MAC адрес для сравнения
     */
    static normalizeMac(mac) {
        if (!mac) return '';
        return mac.toLowerCase().replace(/[:.-]/g, '');
    }
}

export default IpDiscoveryService;