// 🔧 этап 3 п.4 / правка 28: единый SSH-конфиг хоста
// (TFTP-контейнеры, iptables-пробросы, docker-менеджмент).
// БЕЗ дефолтов: нет env → fail-fast с понятной ошибкой в момент операции.
// Раньше здесь молча подставлялись '10.10.19.1' / 9678 / 'v.urusov' —
// креды в исходнике и риск подключиться не к тому хосту.
// Функция (а не const при загрузке модуля), чтобы сервер стартовал и без
// SSH-конфига: см. деградацию в initDockerManagerOnStart.
export function getSSHConfig() {
    const host = process.env.SSH_HOST;
    const username = process.env.SSH_USERNAME;
    if (!host || !username) {
        throw new Error('SSH config missing: set SSH_HOST and SSH_USERNAME in .env');
    }
    return {
        host,
        port: parseInt(process.env.SSH_PORT) || 22,
        username,
        privateKeyPath: process.env.SSH_PRIVATE_KEY_PATH
    };
}