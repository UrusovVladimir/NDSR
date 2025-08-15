import axios from 'axios';
import crypto from 'crypto';



const isAuthenticated = async (ip) => {
  const response = await axios.get(
    `${ip}/auth`,
    { validateStatus: null },
  );

  return response.status === 200;
}

const authenticate = async (ip,login, password) => {
  try {
    // 1. Получаем challenge и session cookie
    console.log('Получаем challenge...');
    const challengeRes = await axios.get(`${ip}/auth`, {
      validateStatus: status => status === 401
    });

    const realm = challengeRes.headers['x-ndm-realm'];
    const challenge = challengeRes.headers['x-ndm-challenge'];
    const sessionCookie = challengeRes.headers['set-cookie'][0].split(';')[0];
    const sessionId = sessionCookie.split('=')[1];

    console.log('Полученные параметры:', {
      realm,
      challenge,
      sessionCookie,
      sessionId
    });

    // 2. Вычисляем хэши
    const md5Hash = crypto.createHash('md5')
      .update(`${login}:${realm}:${password}`)
      .digest('hex');

    const sha256Hash = crypto.createHash('sha256')
      .update(challenge + md5Hash)
      .digest('hex');

    console.log('Вычисленные хэши:', {
      md5: md5Hash,
      sha256: sha256Hash
    });

    // 3. собираем запрос авторизации
    const authData = {
      login,
      password: sha256Hash,
      session_cookie: sessionId,
      session_id: sessionId
    };

    console.log('Отправляемые данные:', JSON.stringify(authData, null, 2));

    // 4. Отправляем запрос авторизации на роутер
    const authRes = await axios.post(`${ip}/auth`, authData, {
      headers: {
        'Cookie': sessionCookie,
        'Content-Type': 'application/json',
      },
      maxRedirects: 0,
      validateStatus: null
    });

    console.log('Ответ от сервера:', {
      status: authRes.status,
      headers: authRes.headers,
      data: authRes.data
    });

    if (authRes.status !== 200) {
      throw new Error(`Ошибка авторизации. Статус: ${authRes.status}`);
    }

    console.log('Авторизация успешна пройдена!');

    return sessionCookie;
  } catch (error) {
    console.error('Ошибка:', error.message);

    if (error.response) {
      console.error('Детали ошибки:', {
        status: error.response.status,
        headers: error.response.headers,
        data: error.response.data
      });
    }

    return false;
  }
}

const queryShowVersion = async (ip,sessionCookie) => {
  return await axios.get(`${ip}/rci/show/version`, {
    headers: {
      'Cookie': sessionCookie
    }
  });
}

async function keeneticAuth(KEENETIC_IP, LOGIN, PASSWORD) {
    console.log("Начинаем авторизацию на Keenetic...", KEENETIC_IP, LOGIN, PASSWORD);
  try {
    const isLoggedIn = await isAuthenticated(KEENETIC_IP);

    let showVersionResponse;

    if (isLoggedIn) {
      console.log("Устройство уже авторизовано, получаем версию прошивки...");
      console.log("Проверяем авторизацию на роутере...", KEENETIC_IP, LOGIN, PASSWORD);
      showVersionResponse = await queryShowVersion(KEENETIC_IP, null);
    } else {
      const sessionCookie = await authenticate(KEENETIC_IP,LOGIN, PASSWORD);

      if (!sessionCookie) {
        throw new Error('Ошибка авторизации');
      }

      showVersionResponse = await queryShowVersion(KEENETIC_IP,sessionCookie);
    }

    console.log('Версия прошивки:', showVersionResponse.data.release);
    return showVersionResponse.data
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

export{
    keeneticAuth
}

