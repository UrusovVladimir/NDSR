import { devices, getParamRouter, getDeviceById, getDeviceStatusCode } from "../devices.js";
import { makeAuthenticatedRequest, keeneticAuth } from "./athentication.js";
import axios from "axios";
import { connectToMws } from "./connectToMws.js"; 
import { SSHManager } from "./sshManager.js";
import { DockerManager } from "../utils/dockerManager.js";
import { HOST_CONFIG } from "../utils/hostConfig.js";
import { DisconnectManager } from "../utils/disconnectManager.js";

const universalPromptRegex = /.*[# ]/i;

// ✅ ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ ПРАВИЛЬНОГО URL ДЛЯ УСТРОЙСТВА
function getCorrectDeviceUrl(deviceId, scenario = 'status', targetMode = null) {
    const device = getDeviceById(deviceId);
    if (!device) {
        console.error(`❌ Устройство ${deviceId} не найдено`);
        return null;
    }
    
    console.log(`🔍 Получение URL для устройства ${deviceId}:`);
    console.log(`   - Сценарий: ${scenario}`);
    console.log(`   - Целевой режим: ${targetMode || 'не указан'}`);
    console.log(`   - CheckDeviceMode: ${device.checkDeviceMode}`);
    console.log(`   - CheckUrl: ${device.checkUrl}`);
    console.log(`   - URL: ${device.URL}`);
    
    // ✅ ЛОГИКА:
    // 1. Для смены режима на 'router' -> ВСЕГДА используем прямой URL (checkDeviceMode)
    // 2. Для смены режима на 'extender_connect' -> используем URL через роутер
    // 3. Для проверки статуса -> в зависимости от текущего режима
    
    if (scenario === 'mode_change') {
        if (targetMode === 'router') {
            // ✅ ПЕРЕВОД В ROUTER: ВСЕГДА используем прямой URL
            const directUrl = device.checkDeviceMode || device.checkUrl || device.URL;
            console.log(`🔧 Для перевода в router используем прямой URL: ${directUrl}`);
            return directUrl;
        } else if (targetMode === 'extender_connect' || targetMode === 'extender_disconnect') {
            // ✅ ДЛЯ ПОДКЛЮЧЕНИЯ/ОТКЛЮЧЕНИЯ: используем через роутер
            // Предполагаем, что routerId есть в контексте, или нужно передать его
            // Пока возвращаем стандартный URL, но эта логика должна быть дополнена
            const defaultUrl = device.checkUrl || device.URL;
            console.log(`🔧 Для ${targetMode} используем URL: ${defaultUrl}`);
            return defaultUrl;
        }
    }
    
    // ✅ По умолчанию возвращаем стандартный URL
    const defaultUrl = device.checkUrl || device.URL;
    console.log(`🔧 Используем URL по умолчанию: ${defaultUrl}`);
    return defaultUrl;
}

// ✅ ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ URL ЧЕРЕЗ РОУТЕР
function getRouterUrlForDevice(deviceId, routerId) {
    const device = getDeviceById(deviceId);
    const router = getParamRouter(routerId);
    
    if (!device || !router) {
        console.log(`❌ Устройство ${deviceId} или роутер ${routerId} не найдены`);
        return null;
    }
    
    if (router && router.ip) {
        const routerIp = router.ip.split('/')[0];
        const url = `http://${routerIp}:${deviceId}`;
        console.log(`🔧 URL через роутер ${routerId} для устройства ${deviceId}: ${url}`);
        return url;
    }
    
    console.log(`⚠️ Роутер ${routerId} не имеет IP`);
    return device.checkUrl || device.URL;
}

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
    
    // ✅ ОПРЕДЕЛЯЕМ ПРАВИЛЬНЫЙ URL ДЛЯ ПРОВЕРКИ
    let checkUrl = deviceUrl;
    if (mode === 'extender' && routerId) {
        const router = getParamRouter(routerId);
        if (router && router.ip) {
            const routerIp = router.ip.split('/')[0];
            checkUrl = `http://${routerIp}:${deviceId}`;
            console.log(`🔧 Для проверки загрузки экстендера используем URL через роутер: ${checkUrl}`);
        }
    }
    
    console.log(`🔧 Для проверки загрузки используем URL: ${checkUrl}`);
    
    broadcastDeviceStatus(io, deviceId, 0);
    
    console.log(`⏳ Защитная пауза 10 секунд перед началом проверок...`);
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    let stableAccessCount = 0;
    const requiredStableAccess = 2;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`🔍 Попытка ${attempt}/${maxAttempts}: проверка доступности устройства...`);
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const response = await axios.get(`${checkUrl}/`, { 
                timeout: 8000,
                validateStatus: (status) => status < 500
            });
            
            console.log(`✅ Базовая доступность есть! HTTP статус: ${response.status}`);
            
            broadcastDeviceStatus(io, deviceId, 100);
            
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
                broadcastDeviceStatus(io, deviceId, 0);
                return true;
            }
            
            console.log(`💤 Ожидание ${delay / 1000} секунд перед следующей попыткой...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return true;
}

// ✅ ОСНОВНАЯ ФУНКЦИЯ СМЕНЫ РЕЖИМА (принимает io)
export const changeSystemMode = async (deviceId, routerId, mode, password, routerPassword = null, io = null, connectionType = 'direct', targetUrl = null) => {
    let currentMode;
    
    try {
        console.log(`🔄 Смена режима для устройства ${deviceId} на ${mode} (connectionType: ${connectionType})`);
        
        const device = getDeviceById(deviceId);
        if (!device) {
            throw new Error(`Устройство ${deviceId} не найдено`);
        }

        if (!password) {
            throw new Error(`Пароль устройства не указан`);
        }

        // ✅ ОПРЕДЕЛЯЕМ ПРАВИЛЬНЫЙ URL
        let url;
        if (targetUrl) {
            // ✅ ЕСЛИ URL ПЕРЕДАН ЯВНО - ИСПОЛЬЗУЕМ ЕГО
            url = targetUrl;
            console.log(`🔧 Используем явно переданный URL: ${url}`);
        } else if (connectionType === 'router' && routerId) {
            // ✅ Используем URL через роутер
            const router = getParamRouter(routerId);
            if (!router || !router.ip) {
                throw new Error(`Роутер ${routerId} не найден или не имеет IP`);
            }
            const routerIp = router.ip.split('/')[0];
            url = `http://${routerIp}:${deviceId}`;
            console.log(`🔧 Используем URL через роутер ${routerId}: ${url}`);
        } else {
            // ✅ Используем прямой URL
            url = device.checkDeviceMode || device.checkUrl || device.URL;
            console.log(`🔧 Используем прямой URL: ${url}`);
        }

        // ✅ ОТПРАВЛЯЕМ СТАТУС "В ПРОЦЕССЕ" ПЕРЕД НАЧАЛОМ ОПЕРАЦИИ
        broadcastDeviceStatus(io, deviceId, 100);

        let finalRouterPassword = routerPassword;
        
        if (mode === 'extender' && routerId && !routerPassword) {
            console.log(`🔄 Пароль роутера не указан, используем пароль устройства`);
            finalRouterPassword = password;
        }

        const login = 'admin';

        // ✅ ШАГ 1: Проверяем текущий режим
        const currentModeResult = await checkDeviceMode(url, login, password);
        if (!currentModeResult.success) {
            throw new Error(`Не удалось проверить текущий режим: ${currentModeResult.message}`);
        }
        
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
        
        const modeToSend = mode === 'extender_connect' ? 'extender' : mode;
        await makeAuthenticatedRequest(url, login, password, '/rci/system/mode', 'POST', { mode: modeToSend });

        console.log(`⏳ Ожидание перед перезагрузкой...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log(`🔄 Отправка команды перезагрузки...`);
        await makeAuthenticatedRequest(url, login, password, '/rci/system/reboot', 'POST', {});

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
            console.log(`🔧 Переход в режим extender без подключения к роутеру`);
            console.log(`⏳ Ожидаем загрузки устройства в автономном режиме...`);
        }
        else if (mode === 'router') {
            console.log(`🔧 Переход в режим router - дополнительные действия не требуются`);
        }

        // ✅ ШАГ 6: ДОПОЛНИТЕЛЬНАЯ ПАУЗА ДЛЯ ВСЕХ РЕЖИМОВ
        console.log(`⏳ Дополнительная пауза для стабилизации устройства...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // ✅ ШАГ 7: Ждем полной загрузки устройства
        console.log(`⏳ Ожидание полной загрузки устройства...`);
        
        await waitForDeviceBoot(io, url, deviceId, routerId, mode, 30, 10000);

        // ✅ ШАГ 8: ФИНАЛЬНАЯ ПРОВЕРКА И ОТПРАВКА СТАТУСА
        console.log(`🔧 Финальная проверка статуса устройства...`);
        try {
            const finalDeviceStatus = await getDeviceStatusCode(device, url);
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

        // ✅ ШАГ 9: Проверяем новый режим после перезагрузки
        console.log(`🔧 Проверка нового режима после перезагрузки...`);

        const newModeResult = await checkDeviceMode(url, login, password);
                
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
            previousMode: currentMode,
            newMode: newModeResult.mode || mode,
            mwsConnected: (mode === 'extender' && routerId) ? true : false
        };

    } catch (error) {
        console.error('❌ Ошибка при смене режима:', error.message);
        broadcastDeviceStatus(io, deviceId, 0);
        
        return { 
            success: false, 
            message: `Ошибка при смене режима: ${error.message}`,
            previousMode: currentMode || 'unknown'
        };
    }
};

export const disconnectAndChangeToRouter = async (deviceId, routerId, password, routerPassword = null, io = null, connectionType = 'router', targetUrl = null) => {
    try {
        console.log(`🔄 Отключение экстендера ${deviceId} и перевод в режим router (connectionType: ${connectionType})`);
        
        const device = getDeviceById(deviceId);
        if (!device) {
            throw new Error(`Устройство ${deviceId} не найдено`);
        }

        // ✅ ОПРЕДЕЛЯЕМ URL В ЗАВИСИМОСТИ ОТ ТИПА ПОДКЛЮЧЕНИЯ
        let url;
        if (targetUrl) {
            // ✅ ЕСЛИ URL ПЕРЕДАН ЯВНО - ИСПОЛЬЗУЕМ ЕГО
            url = targetUrl;
            console.log(`🔧 Используем явно переданный URL: ${url}`);
        } else if (connectionType === 'router' && routerId) {
            // ✅ Используем URL через роутер
            const router = getParamRouter(routerId);
            if (!router || !router.ip) {
                throw new Error(`Роутер ${routerId} не найден или не имеет IP`);
            }
            const routerIp = router.ip.split('/')[0];
            url = `http://${routerIp}:${deviceId}`;
            console.log(`🔧 Для отключения используем URL через роутер: ${url}`);
        } else {
            // ✅ Используем прямой URL
            url = device.checkDeviceMode || device.checkUrl || device.URL;
            console.log(`🔧 Для отключения используем прямой URL: ${url}`);
        }

        // ✅ ОТПРАВЛЯЕМ СТАТУС "В ПРОЦЕССЕ"
        broadcastDeviceStatus(io, deviceId, 100);

        // ✅ ИСПОЛЬЗУЕМ ПОЛНОЕ ОТКЛЮЧЕНИЕ ИЗ DISCONNECT MANAGER
        console.log(`🔧 Запускаем полное отключение через DisconnectManager...`);
        await DisconnectManager.fullDisconnect(deviceId, routerId, password, url);

        // ✅ ВАЖНОЕ ИСПРАВЛЕНИЕ: ДАЕМ ВРЕМЯ НА ПЕРЕЗАГРУЗКУ ПЕРЕД ПРОВЕРКОЙ
        console.log(`⏳ Даем время на перезагрузку устройства (30 секунд)...`);
        await new Promise(resolve => setTimeout(resolve, 30000));

        // ✅ ЖДЕМ ПОЛНОЙ ЗАГРУЗКИ УСТРОЙСТВА В РЕЖИМЕ ROUTER
        console.log(`⏳ Ожидание полной загрузки устройства в режиме router...`);
        
        // ✅ ДЛЯ ROUTER РЕЖИМА ИСПОЛЬЗУЕМ ПРЯМОЙ URL
        const directUrl = device.checkDeviceMode || device.checkUrl || device.URL;
        
        // ✅ УПРОЩЕННАЯ ПРОВЕРКА: делаем быструю проверку вместо долгого ожидания
        let deviceOnline = false;
        for (let attempt = 1; attempt <= 10; attempt++) {
          try {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const finalDeviceStatus = await getDeviceStatusCode(device, directUrl);
            console.log(`📊 Проверка доступности ${deviceId} (${attempt}/10): ${finalDeviceStatus}`);
            
            if (finalDeviceStatus === 200) {
              deviceOnline = true;
              console.log(`✅ Устройство ${deviceId} доступно после отключения`);
              break;
            }
          } catch (error) {
            console.log(`⚠️ Проверка ${attempt} не удалась:`, error.message);
          }
        }

        // ✅ ОТПРАВЛЯЕМ ФИНАЛЬНЫЙ СТАТУС
        try {
            const finalDeviceStatus = deviceOnline ? 200 : 0;
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
            rebooted: true,
            deviceOnline: deviceOnline // ✅ ВАЖНО: сообщаем что устройство онлайн
        };

    } catch (error) {
        console.error('❌ Ошибка при отключении и смене режима:', error.message);
        broadcastDeviceStatus(io, deviceId, 0);
        
        if (error.message.includes('timeout') || error.message.includes('slow to respond')) {
            console.log(`⚠️ Устройство перезагружается, это нормально`);
            return { 
                success: true, 
                message: `Устройство отключено от роутера и перезагружается. Оно станет доступно через несколько минут.`,
                previousMode: 'extender', 
                newMode: 'router',
                mwsConnected: false,
                deviceOnline: false, // ✅ Устройство еще не online
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