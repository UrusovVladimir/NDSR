import axios from 'axios';
import crypto from 'crypto';
import { sessionManager } from './sessionManager.js';

const isAuthenticated = async (ip, sessionCookie = null) => {
  try {
    const headers = {};
    if (sessionCookie) {
      headers['Cookie'] = sessionCookie;
    }

    const response = await axios.get(`${ip}/auth`, {
      headers,
      validateStatus: null,
      timeout: 5000
    });

    return response.status === 200;
  } catch (error) {
    return false;
  }
}

const authenticate = async (ip, login, password) => {
  try {
    console.log('🔐 Получаем challenge...');
    
    // ✅ ПРОВЕРЯЕМ - МОЖЕТ УСТРОЙСТВО УЖЕ АВТОРИЗОВАНО?
    const alreadyAuthenticated = await isAuthenticated(ip);
    if (alreadyAuthenticated) {
      console.log('✅ Устройство уже авторизовано, сессия не требуется');
      // Возвращаем специальный маркер для уже авторизованных устройств
      return 'ALREADY_AUTHENTICATED';
    }

    const challengeRes = await axios.get(`${ip}/auth`, {
      validateStatus: status => status === 401,
      timeout: 10000
    });

    // ✅ ПРОВЕРЯЕМ - ЕСЛИ ПОЛУЧИЛИ 200, ТО УСТРОЙСТВО УЖЕ АВТОРИЗОВАНО
    if (challengeRes.status === 200) {
      console.log('✅ Устройство уже авторизовано (получили 200 на challenge)');
      return 'ALREADY_AUTHENTICATED';
    }

    const realm = challengeRes.headers['x-ndm-realm'];
    const challenge = challengeRes.headers['x-ndm-challenge'];
    const sessionCookie = challengeRes.headers['set-cookie']?.[0]?.split(';')[0];
    
    if (!sessionCookie) {
      throw new Error('Не удалось получить session cookie');
    }

    const sessionId = sessionCookie.split('=')[1];

    console.log('📋 Полученные параметры:', {
      realm,
      challenge: challenge ? 'получен' : 'отсутствует',
      sessionId: sessionId ? 'получен' : 'отсутствует'
    });

    //  хэши
    const md5Hash = crypto.createHash('md5')
      .update(`${login}:${realm}:${password}`)
      .digest('hex');

    const sha256Hash = crypto.createHash('sha256')
      .update(challenge + md5Hash)
      .digest('hex');

    //  запрос авторизации
    const authData = {
      login,
      password: sha256Hash,
      session_cookie: sessionId,
      session_id: sessionId
    };

    const authRes = await axios.post(`${ip}/auth`, authData, {
      headers: {
        'Cookie': sessionCookie,
        'Content-Type': 'application/json',
      },
      maxRedirects: 0,
      validateStatus: null,
      timeout: 10000
    });

    console.log('📡 Ответ от сервера:', {
      status: authRes.status,
      authenticated: authRes.status === 200
    });

    if (authRes.status !== 200) {
      throw new Error(`Ошибка авторизации. Статус: ${authRes.status}`);
    }

    console.log('✅ Авторизация успешна пройдена!');
    
    //  сессия в кэш
    sessionManager.setSession(ip, login, sessionCookie);
    
    return sessionCookie;
  } catch (error) {
    console.error('❌ Ошибка аутентификации:', error.message);

    if (error.response) {
      console.error('📋 Детали ошибки:', {
        status: error.response.status,
        data: error.response.data
      });
      
      // ✅ ЕСЛИ 200 - УСТРОЙСТВО УЖЕ АВТОРИЗОВАНО
      if (error.response.status === 200) {
        console.log('✅ Устройство уже авторизовано (в catch блоке)');
        return 'ALREADY_AUTHENTICATED';
      }
    }

    return null;
  }
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ ДЛЯ ВЫПОЛНЕНИЯ ЗАПРОСОВ С КЭШИРОВАНИЕМ СЕССИЙ
export const makeAuthenticatedRequest = async (ip, login, password, endpoint, method = 'GET', data = null) => {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };

    // ✅ ПЕРВЫЙ ПРИОРИТЕТ: Пробуем использовать кэшированную сессию
    let sessionCookie = sessionManager.getSession(ip, login);
    let useSessionCookie = false;
    
    if (sessionCookie && sessionCookie !== 'ALREADY_AUTHENTICATED') {
      headers['Cookie'] = sessionCookie;
      useSessionCookie = true;
      console.log(`🔐 Используем кэшированную сессию для ${ip}`);
    }

    // Пробуем выполнить запрос
    const config = {
      method: method,
      url: `${ip}${endpoint}`,
      headers: headers,
      timeout: 10000,
      validateStatus: null // Обрабатываем все статусы
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      config.data = data;
    }

    let response;
    try {
      response = await axios(config);
    } catch (requestError) {
      console.log(`⚠️ Ошибка запроса: ${requestError.message}`);
      throw requestError;
    }

    // ✅ ЕСЛИ ЗАПРОС УСПЕШЕН - возвращаем данные
    if (response.status >= 200 && response.status < 300) {
      return response.data;
    }

    // ✅ ЕСЛИ ПОЛУЧИЛИ 401 И ЕСТЬ ПАРОЛЬ - пробуем аутентифицироваться
    if (response.status === 401 && password) {
      console.log(`🔐 Получили 401, пробуем аутентифицироваться...`);
      
      // Очищаем невалидную сессию
      if (sessionCookie) {
        sessionManager.clearSession(ip, login);
      }
      
      // Пробуем аутентифицироваться
      sessionCookie = await authenticate(ip, login, password);
      
      if (sessionCookie === 'ALREADY_AUTHENTICATED') {
        console.log(`🔐 Устройство уже авторизовано, повторяем запрос без сессии`);
        // Повторяем запрос без сессии
        delete headers['Cookie'];
        config.headers = headers;
        
        const retryResponse = await axios(config);
        if (retryResponse.status >= 200 && retryResponse.status < 300) {
          return retryResponse.data;
        }
      } else if (sessionCookie) {
        // Повторяем запрос с новой сессией
        headers['Cookie'] = sessionCookie;
        config.headers = headers;
        
        const retryResponse = await axios(config);
        
        if (retryResponse.status >= 200 && retryResponse.status < 300) {
          return retryResponse.data;
        } else {
          throw new Error(`Запрос не удался после аутентификации: ${retryResponse.status}`);
        }
      } else {
        throw new Error('Не удалось аутентифицироваться');
      }
    }

    // ✅ ДРУГИЕ ОШИБКИ HTTP
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  } catch (error) {
    console.error(`❌ Ошибка запроса к ${endpoint}:`, error.message);
    throw error;
  }
}

// ✅ ФУНКЦИЯ ДЛЯ ПРОВЕРКИ И ОБНОВЛЕНИЯ СЕССИИ
export const verifyAndRefreshSession = async (ip, login, password) => {
  try {
    const sessionCookie = sessionManager.getSession(ip, login);
    
    // ✅ ЕСЛИ УСТРОЙСТВО УЖЕ АВТОРИЗОВАНО - ВОЗВРАЩАЕМ СПЕЦИАЛЬНЫЙ МАРКЕР
    if (sessionCookie === 'ALREADY_AUTHENTICATED') {
      console.log(`🔐 Устройство уже авторизовано (из кэша)`);
      return 'ALREADY_AUTHENTICATED';
    }
    
    if (!sessionCookie) {
      console.log(`🔐 Сессия не найдена, требуется проверка аутентификации`);
      return await authenticate(ip, login, password);
    }

    // Проверяем валидность сессии
    const isValid = await isAuthenticated(ip, sessionCookie);
    
    if (!isValid) {
      console.log(`🔐 Сессия устарела, обновляем...`);
      sessionManager.clearSession(ip, login);
      return await authenticate(ip, login, password);
    }

    console.log(`🔐 Сессия валидна`);
    return sessionCookie;
  } catch (error) {
    console.error(`❌ Ошибка проверки сессии:`, error.message);
    return null;
  }
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ
async function keeneticAuth(KEENETIC_IP, LOGIN, PASSWORD) {
  console.log("🔐 Начинаем авторизацию на Keenetic...", KEENETIC_IP, LOGIN);
  try {
    // Используем новую систему сессий
    const sessionCookie = await verifyAndRefreshSession(KEENETIC_IP, LOGIN, PASSWORD);
    
    if (!sessionCookie) {
      throw new Error('Ошибка авторизации');
    }

    const headers = {};
    
    // ✅ ЕСЛИ НУЖНА СЕССИЯ - ДОБАВЛЯЕМ В ЗАГОЛОВКИ
    if (sessionCookie !== 'ALREADY_AUTHENTICATED') {
      headers['Cookie'] = sessionCookie;
    }

    const showVersionResponse = await axios.get(`${KEENETIC_IP}/rci/show/version`, { 
      headers,
      timeout: 10000 
    });

    console.log('✅ Версия прошивки:', showVersionResponse.data.release);
    return showVersionResponse.data;
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    throw error;
  }
}

export {
  keeneticAuth,
  sessionManager
};