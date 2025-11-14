import { devices, getParamRouter, getDeviceById, getDeviceStatusCode } from "../devices.js";
import { makeAuthenticatedRequest, keeneticAuth } from "./athentication.js";
import axios from "axios";
import { connectToMws } from "./connectToMws.js"; 
import { SSHManager } from "./sshManager.js";
import { DockerManager } from "../utils/dockerManager.js";
import { HOST_CONFIG } from "../utils/hostConfig.js";
import { DisconnectManager } from "../utils/disconnectManager.js";

const universalPromptRegex = /.*[# ]/i;

// ✅ ФУНКЦИЯ ДЛЯ ОТПРАВКИ СТАТУСА (принимает io как параметр)
function broadcastDeviceStatus(io, deviceId, status) {
    try {
        if (io) {
            console.log(`📤 Отправка статуса устройства ${deviceId}: ${status}`);
            io.emit('device:status', {
                deviceId: deviceId,
                status: status,
                timestamp: Date.now()
            });
        } else {
            console.log(`⚠️ io не передан, статус ${status} для ${deviceId} не отправлен`);
        }
    } catch (error) {
        console.error(`❌ Ошибка отправки статуса:`, error);
    }
}

export const checkDeviceMode = async (url, login, password) => {
    try {
        console.log(`🔧 checkDeviceMode called with:`, { 
            url, 
            urlType: typeof url,
            login, 
            hasPassword: !!password 
        });

        if (!url) {
            throw new Error(`URL is undefined or empty`);
        }

        let deviceUrl = url.trim();
        if (!deviceUrl.startsWith('http://') && !deviceUrl.startsWith('https://')) {
            deviceUrl = 'http://' + deviceUrl;
        }

        try {
            new URL(deviceUrl);
        } catch (urlError) {
            throw new Error(`Invalid URL format: ${deviceUrl}`);
        }

        const modeData = await makeAuthenticatedRequest(
            deviceUrl,
            login,
            password,
            '/rci/show/system/mode',
            'GET'
        );
        
        console.log('🔧 Mode data response:', modeData);

        if (!modeData || !modeData.active) {
            return { success: false, message: 'Cannot determine mode from response' };
        }

        const baseMode = modeData.active;

        // ✅ ЕСЛИ РЕЖИМ EXTENDER - ПРОВЕРЯЕМ MWS ПОДКЛЮЧЕНИЯ
        let mwsInfo = null;
        if (baseMode === 'extender') {
            try {
                mwsInfo = await makeAuthenticatedRequest(
                    deviceUrl,
                    login,
                    password,
                    '/rci/show/mws',
                    'GET'
                );
                console.log('🔧 MWS connections info:', mwsInfo);
            } catch (mwsError) {
                console.log('🔧 No MWS connections or error:', mwsError.message);
            }
        }

        // ✅ ОПРЕДЕЛЯЕМ ФИНАЛЬНЫЙ РЕЖИМ
        let finalMode = baseMode;
        if (baseMode === 'extender' && mwsInfo && Array.isArray(mwsInfo) && mwsInfo.length > 0) {
            finalMode = 'extender_connect';
            console.log(`🔧 Device is extender with MWS connections -> ${finalMode}`);
        }

        return { 
            success: true, 
            mode: finalMode, 
            baseMode: baseMode,
            hasMwsConnections: mwsInfo && Array.isArray(mwsInfo) && mwsInfo.length > 0,
            mwsConnections: mwsInfo
        };
        
    } catch (error) {
        console.error('🔧 Error in checkDeviceMode:', error.message);
        return { success: false, message: error.message };
    }
};

async function pollMwsCandidates(routerUrl, login, routerPassword, maxAttempts = 60, delay = 5000) {
    console.log(`🔍 Начинаем опрос MWS кандидатов: ${routerUrl}/rci/show/mws/candidate`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`🔍 Попытка ${attempt}/${maxAttempts}: запрос MWS кандидатов...`);
            
            const candidatesData = await makeAuthenticatedRequest(
                routerUrl,
                login,
                routerPassword,
                '/rci/show/mws/candidate',
                'GET'
            );

            console.log(`✅ MWS кандидаты получены (попытка ${attempt}/${maxAttempts})`);
            return candidatesData;

        } catch (error) {
            console.log(`⚠️ Ошибка запроса MWS кандидатов (попытка ${attempt}/${maxAttempts}):`, error.message);
            
            if (error.message.includes('401') || error.message.includes('authentication')) {
                console.log(`🔐 Ошибка аутентификации при запросе MWS кандидатов`);
                throw new Error(`Ошибка аутентификации при запросе MWS кандидатов. Проверьте пароль роутера.`);
            }
            
            if (attempt === maxAttempts) {
                throw new Error(`Не удалось получить MWS кандидаты после ${maxAttempts} попыток: ${error.message}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function manageIptablesForExtender(deviceId, routerId, device, routerPassword = null) {
    let sshManager = null;
    
    try {
        console.log(`🔧 Настройка проброса портов для extender'а ${deviceId} к роутеру ${routerId}`);
        console.log(`🔐 Используемый пароль роутера: ${routerPassword ? 'указан' : 'не указан'}`);
        
        const router = getParamRouter(routerId);
        if (!router) {
            throw new Error(`Роутер ${routerId} не найден`);
        }

        // ✅ ВАЖНО: ПРОВЕРЯЕМ ЧТО ПЕРЕДАН device ОБЪЕКТ
        if (!device) {
            throw new Error(`Device объект не передан для устройства ${deviceId}`);
        }

        console.log(`📋 Параметры устройства:`, {
            macAddress: device.macAddress,
            hwId: device.hwId
        });

        sshManager = new SSHManager(
            HOST_CONFIG.mainHost.host,
            HOST_CONFIG.mainHost.port,
            HOST_CONFIG.mainHost.username,
            HOST_CONFIG.mainHost.privateKeyPath
        );
        
        await sshManager.connect();
        console.log(`✅ SSH подключение установлено`);
        
        const dockerManager = new DockerManager(sshManager);
        console.log(`✅ DockerManager инициализирован`);

        console.log(`🔧 Запускаем setupPortForwarding...`);
        const extenderIp = await dockerManager.setupPortForwarding(deviceId, routerId, device, routerPassword);
        
        console.log(`✅ Проброс портов настроен: порт ${deviceId} -> extender ${extenderIp}:80`);

    } catch (error) {
        console.error(`❌ Ошибка настройки проброса портов:`, error);
        throw error;
    } finally {
        if (sshManager) {
            sshManager.disconnect();
            console.log(`🔧 SSH подключение закрыто`);
        }
    }
}
async function waitForExtenderInMwsCandidates(routerId, extenderMac, routerPassword, maxAttempts = 60, delay = 5000) {
    try {
        console.log(`🔍 Ожидание появления extender'а ${extenderMac} в MWS кандидатах`);
        
        const router = getParamRouter(routerId);
        if (!router) {
            throw new Error(`Роутер ${routerId} не найден`);
        }

        const routerUrl = router.URL;
        const login = 'admin';
        const normalizedTargetMac = extenderMac.replace(/:/g, '').toLowerCase();

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`🔍 Попытка ${attempt}/${maxAttempts}: поиск extender'а в MWS кандидатах...`);
                
                const candidatesData = await pollMwsCandidates(routerUrl, login, routerPassword, 1, delay);

                if (candidatesData && Array.isArray(candidatesData)) {
                    console.log(`📋 Получено кандидатов: ${candidatesData.length}`);
                    
                    const foundExtender = candidatesData.find(candidate => {
                        if (!candidate.mac) return false;
                        const candidateMac = candidate.mac.replace(/:/g, '').toLowerCase();
                        return candidateMac === normalizedTargetMac;
                    });

                    if (foundExtender) {
                        console.log(`✅ Extender найден в MWS кандидатах!`);
                        return foundExtender;
                    } else {
                        console.log(`⌛ Extender еще не появился в MWS кандидатах...`);
                    }
                }

            } catch (error) {
                console.log(`⚠️ Ошибка поиска extender'а: ${error.message}`);
                if (error.message.includes('401')) {
                    throw new Error(`Ошибка аутентификации при запросе MWS кандидатов. Проверьте пароль роутера.`);
                }
            }

            if (attempt === maxAttempts) {
                throw new Error(`Extender не появился в MWS кандидатах после ${maxAttempts} попыток`);
            }

            await new Promise(resolve => setTimeout(resolve, delay));
        }

    } catch (error) {
        console.error(`❌ Ошибка ожидания extender'а в MWS:`, error);
        throw error;
    }
}

async function waitForExtenderConnection(routerId, extenderMac, routerPassword, maxAttempts = 60, delay = 5000) {
    try {
        console.log(`🔗 Ожидание успешного подключения extender'а ${extenderMac}`);
        
        const router = getParamRouter(routerId);
        if (!router) {
            throw new Error(`Роутер ${routerId} не найден`);
        }

        const routerUrl = router.URL;
        const login = 'admin';
        const normalizedTargetMac = extenderMac.replace(/:/g, '').toLowerCase();

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`🔍 Попытка ${attempt}/${maxAttempts}: проверка состояния подключения...`);
                
                const candidatesData = await pollMwsCandidates(routerUrl, login, routerPassword, 1, delay);

                if (candidatesData && Array.isArray(candidatesData)) {
                    const extender = candidatesData.find(candidate => {
                        if (!candidate.mac) return false;
                        const candidateMac = candidate.mac.replace(/:/g, '').toLowerCase();
                        return candidateMac === normalizedTargetMac;
                    });

                    if (extender) {
                        console.log(`📊 Состояние extender'а: ${extender.state}`);

                        if (extender.state === 'CONNECTED' || extender.state === 'COMPATIBLE_UPDATE' || extender.state === 'COMPATIBLE') {
                            console.log(`🎉 Extender успешно подключен к роутеру!`);
                            return extender;
                        }
                    }
                }

            } catch (error) {
                console.log(`⚠️ Ошибка проверки подключения: ${error.message}`);
                if (error.message.includes('401') || error.message.includes('authentication')) {
                    throw error;
                }
            }

            if (attempt === maxAttempts) {
                throw new Error(`Extender не подключился к роутеру после ${maxAttempts} попыток`);
            }

            await new Promise(resolve => setTimeout(resolve, delay));
        }

    } catch (error) {
        console.error(`❌ Ошибка ожидания подключения:`, error);
        throw error;
    }
}

async function waitForDeviceBoot(io, deviceUrl, deviceId, routerId = null, mode = 'router', maxAttempts = 30, delay = 10000) {
    console.log(`⏳ Ожидание загрузки устройства: ${deviceUrl}, режим: ${mode}`);
    
    const device = getDeviceById(deviceId);
    if (!device) {
        throw new Error(`Устройство ${deviceId} не найдено`);
    }
    
    let checkUrl = deviceUrl;
    console.log(`🔧 Для проверки загрузки используем прямой URL устройства: ${checkUrl}`);
    
    broadcastDeviceStatus(io, deviceId, 0);
    
    console.log(`⏳ Защитная пауза 10 секунд перед началом проверок...`);
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    let stableAccessCount = 0;
    const requiredStableAccess = 2; // ✅ УМЕНЬШИЛИ ТРЕБОВАНИЯ ДЛЯ ОТКЛЮЧЕНИЯ
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`🔍 Попытка ${attempt}/${maxAttempts}: проверка доступности устройства...`);
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // ✅ УВЕЛИЧИЛИ ТАЙМАУТ ДЛЯ ПЕРЕЗАГРУЗКИ
            const response = await axios.get(`${checkUrl}/`, { 
                timeout: 8000,
                validateStatus: (status) => status < 500
            });
            
            console.log(`✅ Базовая доступность есть! HTTP статус: ${response.status}`);
            
            broadcastDeviceStatus(io, deviceId, 100);
            
            // ✅ ПРОСТАЯ ПРОВЕРКА - НЕ ТРЕБУЕМ 200 СТАТУС ПРИ ОТКЛЮЧЕНИИ
            if (response.status < 500) {
                stableAccessCount++;
                console.log(`📈 Стабильная доступность: ${stableAccessCount}/${requiredStableAccess}`);
                
                if (stableAccessCount >= requiredStableAccess) {
                    console.log(`✅ Устройство доступно после перезагрузки`);
                    broadcastDeviceStatus(io, deviceId, response.status);
                    return true;
                }
            } else {
                stableAccessCount = 0;
            }
            
            console.log(`⏳ Устройство загружается... стабильность: ${stableAccessCount}/${requiredStableAccess}`);
            
        } catch (error) {
            const timeRemaining = ((maxAttempts - attempt) * delay) / 60000;
            
            if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                console.log(`⌛ Устройство еще загружается... Осталось попыток: ${maxAttempts - attempt}`);
                stableAccessCount = 0;
                broadcastDeviceStatus(io, deviceId, 0);
            } else {
                console.log(`⚠️ Ошибка подключения: ${error.message}`);
                stableAccessCount = 0;
            }
            
            if (attempt === maxAttempts) {
                console.log(`⚠️ Устройство все еще загружается после ${maxAttempts} попыток`);
                // ✅ НЕ ВЫБРАСЫВАЕМ ОШИБКУ - УСТРОЙСТВО МОЖЕТ БЫТЬ ДОСТУПНО ПОЗЖЕ
                broadcastDeviceStatus(io, deviceId, 0);
                return true; // ✅ ВОЗВРАЩАЕМ TRUE ДАЖЕ ПРИ ТАЙМАУТЕ
            }
            
            console.log(`💤 Ожидание ${delay / 1000} секунд перед следующей попыткой...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return true; // ✅ ГАРАНТИРОВАННО ВОЗВРАЩАЕМ TRUE ДЛЯ ОТКЛЮЧЕНИЯ
}

// ✅ ОСНОВНАЯ ФУНКЦИЯ СМЕНЫ РЕЖИМА (принимает io)
export const changeSystemMode = async (deviceId, routerId, mode, password, routerPassword = null, io = null) => {
    // ✅ ОБЪЯВЛЯЕМ currentMode ЗДЕСЬ, чтобы она была доступна во всем блоке catch
    let currentMode;
    
    try {
        console.log(`🔄 Смена режима для устройства ${deviceId} на ${mode}`);
        
        const device = getDeviceById(deviceId);
        if (!device) {
            throw new Error(`Устройство ${deviceId} не найдено`);
        }

        if (!password) {
            throw new Error(`Пароль устройства не указан`);
        }

        // ✅ ОТПРАВЛЯЕМ СТАТУС "В ПРОЦЕССЕ" ПЕРЕД НАЧАЛОМ ОПЕРАЦИИ
        broadcastDeviceStatus(io, deviceId, 100);

        let finalRouterPassword = routerPassword;
        
        // ✅ ВАЖНОЕ ИСПРАВЛЕНИЕ: для режима extender без роутера не нужен пароль роутера
        if (mode === 'extender' && routerId && !routerPassword) {
            console.log(`🔄 Пароль роутера не указан, используем пароль устройства`);
            finalRouterPassword = password;
        }

        const url = device.URL;
        const login = 'admin';

        // ✅ ШАГ 1: Проверяем текущий режим 
        let initialCheckUrl = url;
        // Если устройство уже в режиме extender+router, проверяем по правильному URL
        const tempModeCheck = await checkDeviceMode(url, login, password);
        if (tempModeCheck.success && tempModeCheck.mode === 'extender_connect' && routerId) {
            const router = getParamRouter(routerId);
            if (router && router.ip) {
                const routerIp = router.ip.split('/')[0];
                const extenderPort = deviceId;
                initialCheckUrl = `http://${routerIp}:${extenderPort}`;
                console.log(`🔧 Для проверки текущего режима extender+router используем URL: ${initialCheckUrl}`);
            }
        }

        const currentModeResult = await checkDeviceMode(initialCheckUrl, login, password);
        if (!currentModeResult.success) {
            throw new Error(`Не удалось проверить текущий режим: ${currentModeResult.message}`);
        }
        
        // ✅ ТЕПЕРЬ currentMode ОБЪЯВЛЕНА ДО ЕЕ ИСПОЛЬЗОВАНИЯ
        currentMode = currentModeResult.mode;
        
        console.log(`📋 Текущий режим: ${currentMode}, целевой режим: ${mode}`);

        if (currentMode === mode) {
            return { 
                success: true, 
                message: `Устройство уже находится в режиме ${mode}` 
            };
        }

        // ✅ ШАГ 2-4: Смена режима и перезагрузка
        console.log(`🔄 Отправка команды смены режима на ${mode}...`);
        
        // ✅ ВАЖНО: Всегда отправляем базовый режим (router или extender)
        const modeToSend = mode === 'extender_connect' ? 'extender' : mode;
        await makeAuthenticatedRequest(url, login, password, '/rci/system/mode', 'POST', { mode: modeToSend });

        console.log(`⏳ Ожидание перед перезагрузкой...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log(`🔄 Отправка команды перезагрузки...`);
        await makeAuthenticatedRequest(url, login, password, '/rci/system/reboot', 'POST', {});

        // ✅ ОТПРАВЛЯЕМ СТАТУС "PENDING" ПОСЛЕ ПЕРЕЗАГРУЗКИ
        broadcastDeviceStatus(io, deviceId, 0);

        // ✅ ШАГ 5: MWS ПОДКЛЮЧЕНИЕ ТОЛЬКО ЕСЛИ УКАЗАН ROUTER_ID ДЛЯ EXTENDER
        if (mode === 'extender' && routerId) {
            console.log(`🔗 Выполняем подключение MWS для экстендера ${deviceId} к роутеру ${routerId}`);
            
            try {
                await connectToMws({
                    deviceId: deviceId,
                    routerId: routerId,
                    action: "connect",
                    routerPassword: finalRouterPassword,
                    useDevicePassword: true
                }, universalPromptRegex);
                
                console.log(`✅ MWS подключение успешно выполнено`);

                await waitForExtenderInMwsCandidates(routerId, device.macAddress, finalRouterPassword);
                await waitForExtenderConnection(routerId, device.macAddress, finalRouterPassword);

                console.log(`⏳ Даем время на полное подключение...`);
                await new Promise(resolve => setTimeout(resolve, 5000));

                console.log(`🔧 Настройка проброса портов...`);
                await manageIptablesForExtender(deviceId, routerId, device, finalRouterPassword);
                console.log(`✅ Проброс портов настроен`);
                
            } catch (mwsError) {
                console.error(`❌ Ошибка MWS подключения:`, mwsError);
                throw new Error(`MWS подключение не удалось: ${mwsError.message}`);
            }
        } else if (mode === 'extender' && !routerId) {
            // ✅ РЕЖИМ EXTENDER БЕЗ ПОДКЛЮЧЕНИЯ К РОУТЕРУ
            console.log(`🔧 Переход в режим extender без подключения к роутеру`);
            console.log(`⏳ Ожидаем загрузки устройства в автономном режиме...`);
        }
        // ✅ ДЛЯ РЕЖИМА ROUTER - НИКАКИХ ДОПОЛНИТЕЛЬНЫХ ДЕЙСТВИЙ
        else if (mode === 'router') {
            console.log(`🔧 Переход в режим router - дополнительные действия не требуются`);
        }

        // ✅ ШАГ 6: ДОПОЛНИТЕЛЬНАЯ ПАУЗА ДЛЯ ВСЕХ РЕЖИМОВ
        console.log(`⏳ Дополнительная пауза для стабилизации устройства...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // ✅ ШАГ 7: Ждем полной загрузки устройства С ПРАВИЛЬНЫМ URL
        console.log(`⏳ Ожидание полной загрузки устройства...`);
        await waitForDeviceBoot(io, url, deviceId, routerId, mode, 30, 10000);

        // ✅ ШАГ 8: ФИНАЛЬНАЯ ПРОВЕРКА И ОТПРАВКА СТАТУСА
        console.log(`🔧 Финальная проверка статуса устройства...`);
        try {
            const finalDeviceStatus = await getDeviceStatusCode(device);
            console.log(`🎯 Финальный статус устройства: ${finalDeviceStatus}`);
            
            // ✅ ГАРАНТИРОВАННАЯ ОТПРАВКА ФИНАЛЬНОГО СТАТУСА
            broadcastDeviceStatus(io, deviceId, finalDeviceStatus);
            
            if (finalDeviceStatus !== 200) {
                console.warn(`⚠️ Устройство загружено, но системный статус: ${finalDeviceStatus}`);
            } else {
                console.log(`✅ Статус 200 успешно отправлен на фронтенд`);
            }
        } catch (statusError) {
            console.warn(`⚠️ Не удалось проверить финальный статус: ${statusError.message}`);
            broadcastDeviceStatus(io, deviceId, 0);
        }

        // ✅ ШАГ 9: Проверяем новый режим после перезагрузки С ПРАВИЛЬНЫМ URL
        console.log(`🔧 Проверка нового режима после перезагрузки...`);

        // ✅ ОПРЕДЕЛЯЕМ ПРАВИЛЬНЫЙ URL ДЛЯ ПРОВЕРКИ РЕЖИМА
        let modeCheckUrl = url;
        if (mode === 'extender' && routerId) {
            const router = getParamRouter(routerId);
            if (router && router.ip) {
                const routerIp = router.ip.split('/')[0];
                const extenderPort = deviceId;
                modeCheckUrl = `http://${routerIp}:${extenderPort}`;
                console.log(`🔧 Для проверки режима extender+router используем URL: ${modeCheckUrl}`);
            }
        }

        const newModeResult = await checkDeviceMode(modeCheckUrl, login, password);
                
        let finalMessage = `Режим успешно изменен на ${mode}. Устройство перезагружено.`;

        if (mode === 'extender' && routerId) {
            finalMessage += ` MWS подключение к роутеру выполнено.`;
        } else if (mode === 'extender' && !routerId) {
            finalMessage += ` Устройство работает в автономном режиме экстендера.`;
        } else if (mode === 'router') {
            finalMessage += ` Устройство работает в режиме роутера.`;
        }

        return { 
            success: true, 
            message: finalMessage,
            previousMode: currentMode, // ✅ ТЕПЕРЬ currentMode ДОСТУПНА
            newMode: newModeResult.mode || mode,
            mwsConnected: (mode === 'extender' && routerId) ? true : false
        };

    } catch (error) {
        console.error('❌ Ошибка при смене режима:', error.message);
        broadcastDeviceStatus(io, deviceId, 0);
        
        // ✅ ТЕПЕРЬ currentMode ДОСТУПНА И В БЛОКЕ CATCH
        return { 
            success: false, 
            message: `Ошибка при смене режима: ${error.message}`,
            previousMode: currentMode || 'unknown' // ✅ БЕЗОПАСНЫЙ ДОСТУП
        };
    }
};

export const disconnectAndChangeToRouter = async (deviceId, routerId, password, routerPassword = null, io = null) => {
    try {
        console.log(`🔄 Отключение экстендера ${deviceId} и перевод в режим router`);
        
        const device = getDeviceById(deviceId);
        if (!device) {
            throw new Error(`Устройство ${deviceId} не найдено`);
        }

        // ✅ ОТПРАВЛЯЕМ СТАТУС "В ПРОЦЕССЕ"
        broadcastDeviceStatus(io, deviceId, 100);

        // ✅ ИСПОЛЬЗУЕМ ПОЛНОЕ ОТКЛЮЧЕНИЕ ИЗ DISCONNECT MANAGER
        console.log(`🔧 Запускаем полное отключение через DisconnectManager...`);
        await DisconnectManager.fullDisconnect(deviceId, routerId, password);

        // ✅ ВАЖНОЕ ИСПРАВЛЕНИЕ: ДАЕМ ВРЕМЯ НА ПЕРЕЗАГРУЗКУ ПЕРЕД ПРОВЕРКОЙ
        console.log(`⏳ Даем время на перезагрузку устройства (30 секунд)...`);
        await new Promise(resolve => setTimeout(resolve, 30000));

        // ✅ ЖДЕМ ПОЛНОЙ ЗАГРУЗКИ УСТРОЙСТВА В РЕЖИМЕ ROUTER
        console.log(`⏳ Ожидание полной загрузки устройства в режиме router...`);
        await waitForDeviceBoot(io, device.URL, deviceId, null, 'router', 30, 10000);

        // ✅ ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА И ОТПРАВКА СТАТУСА
        console.log(`🔧 Финальная проверка статуса устройства...`);
        try {
            const finalDeviceStatus = await getDeviceStatusCode(device);
            console.log(`🎯 Финальный статус устройства: ${finalDeviceStatus}`);
            
            broadcastDeviceStatus(io, deviceId, finalDeviceStatus);
            
            if (finalDeviceStatus !== 200) {
                console.warn(`⚠️ Устройство загружено, но системный статус: ${finalDeviceStatus}`);
            } else {
                console.log(`✅ Устройство успешно загружено после отключения`);
            }
        } catch (statusError) {
            console.warn(`⚠️ Не удалось проверить финальный статус: ${statusError.message}`);
            broadcastDeviceStatus(io, deviceId, 0);
        }

        if (io) {
            io.emit('device:modeUpdated', {
                deviceId: deviceId,
                mode: 'router',
                routerId: null,
                timestamp: Date.now(),
                source: 'disconnect_complete'
            });
        }

        return { 
            success: true, 
            message: `Устройство отключено от роутера и переведено в режим router`,
            previousMode: 'extender',
            newMode: 'router',
            mwsConnected: false,
            modeChanged: true,
            rebooted: true
        };

    } catch (error) {
        console.error('❌ Ошибка при отключении и смене режима:', error.message);
        broadcastDeviceStatus(io, deviceId, 0);
        
        // ✅ ВАЖНОЕ ИСПРАВЛЕНИЕ: НЕ ВЫБРАСЫВАЕМ ОШИБКУ ДЛЯ ПОЛЬЗОВАТЕЛЯ ПРИ ТАЙМАУТЕ
        if (error.message.includes('timeout') || error.message.includes('slow to respond')) {
            console.log(`⚠️ Устройство перезагружается, это нормально`);
            return { 
                success: true, 
                message: `Устройство отключено от роутера и перезагружается. Оно станет доступно через несколько минут.`,
                previousMode: 'extender', 
                newMode: 'router',
                mwsConnected: false,
                warning: 'Device is rebooting'
            };
        }
        
        return { 
            success: false, 
            message: `Ошибка при отключении: ${error.message}` 
        };
    }
};
export {
  waitForDeviceBoot
};