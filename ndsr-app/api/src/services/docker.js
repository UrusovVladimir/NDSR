// services/docker.js — ленивый singleton SSH + DockerManager (TFTP-контейнеры).
import { getSSHConfig } from '../utils/hostConfig.js';
import { DockerManager } from '../utils/dockerManager.js';
import { SSHManager } from '../actions/sshManager.js';

let dockerManager = null;
let dockerManagerPromise = null;
let sshConnection = null;

// 🔧 B2: мемоизация промиса инициализации. Раньше при двух параллельных
// вызовах обе проверки `if (!dockerManager)` проходили до завершения первой —
// создавались ДВА SSHManager'а, и первый утекал навсегда.
// Теперь все параллельные вызовы ожидают ОДИН и тот же промис.
const initializeDockerManager = () => {
    dockerManagerPromise ??= (async () => {
        try {
            // Проверяем наличие необходимых переменных окружения
            if (!process.env.SSH_HOST || !process.env.SSH_USERNAME) {
                console.error('❌ SSH configuration missing in .env file');
                throw new Error('SSH configuration missing');
            }

            // Создаем и подключаем SSHManager если еще нет
            // 🔧 правка 28: единый SSH-конфиг (fail-fast, без кредо-дефолтов)
            const cfg = getSSHConfig();

            if (!sshConnection) {
                sshConnection = new SSHManager(
                    cfg.host,
                    cfg.port,
                    cfg.username,
                    cfg.privateKeyPath,
                    true  // 5-й аргумент (keepalive) — сохранить!
                );

                console.log(`🔧 Подключение к SSH серверу ${process.env.SSH_HOST}...`);
                await sshConnection.connect();
                console.log(`✅ SSHManager подключен к ${process.env.SSH_HOST}`);
            }

            // Создаем DockerManager с существующим SSH соединением
            dockerManager = new DockerManager(sshConnection);
            console.log('✅ DockerManager initialized successfully');
            return dockerManager;

        } catch (error) {
            console.error('❌ Failed to initialize DockerManager:', error.message);
            throw error;
        }
    })();

    // Если инициализация упала — сбрасываем промис, чтобы следующий вызов
    // повторил попытку (упавшая инициализация не должна кэшироваться навсегда)
    dockerManagerPromise.catch(() => {
        dockerManagerPromise = null;
    });

    return dockerManagerPromise;
};

const initDockerManagerOnStart = async () => {
    try {
        console.log('🔧 [STARTUP] Initializing DockerManager...');
        await initializeDockerManager();
        console.log('✅ [STARTUP] DockerManager ready for TFTP operations');
        console.log('📡 [STARTUP] SSH connection established to:', process.env.SSH_HOST);
    } catch (error) {
        console.warn('⚠️ [STARTUP] DockerManager initialization failed:', error.message);
        console.log('📌 [STARTUP] TFTP interface IP queries will be attempted on first request');
        console.log('💡 [STARTUP] Check SSH configuration in .env file');
    }
};

export { initializeDockerManager, initDockerManagerOnStart };
