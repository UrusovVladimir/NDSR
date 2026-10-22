// services/consoleCapture.js — вывод последовательной консоли устройства в окно
// прогресса во время перезагрузки / сброса.
//
// Подключение к консоли общее с окном консоли (services/consoleHub.js): захват
// подписывается на него и окно консоли не выбивает. Захват только по запросу
// фронта; заканчивается по stop, отключению браузера, лимиту времени или
// закрытию порта (его забрал клиент не из портала).
//
// В браузер — событие device:consoleLog { deviceId, text? , note?, ended? }
// только сокету, запросившему захват. Текст очищен от ANSI и \r.
import { subscribeConsole, isConsoleHubEnabled } from './consoleHub.js';

const MAX_MS = Number(process.env.CONSOLE_CAPTURE_MAX_MS) || 6 * 60 * 1000;
const FLUSH_MS = 250;

const captures = new Map(); // deviceId -> { socketId, stop }

// Перевод строки — только \n, \r выкидываем целиком: серийные консоли шлют
// и \r\n, и \n\r, и \r\r\n — замена \r\n? → \n давала пустую строку после
// каждой строки (и на стыке пачек TCP тоже)
const cleanText = (s) => s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')   // ANSI
    .replace(/\r/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

export const isConsoleCaptureEnabled = isConsoleHubEnabled;

export function startConsoleCapture(socket, device) {
    const deviceId = String(device.id);
    stopConsoleCapture(deviceId, 'restarted');

    const emit = (payload) => socket.emit('device:consoleLog', { deviceId, ...payload });
    const decoder = new TextDecoder('utf-8');
    let pending = '';
    let flushTimer = null;
    let limitTimer = null;
    let ended = false;
    let unsubscribe = null;

    const flush = () => {
        flushTimer = null;
        if (pending) {
            emit({ text: pending });
            pending = '';
        }
    };

    // fromHub — подключение уже закрыто хабом, отписываться не нужно
    const finish = (note, fromHub) => {
        if (ended) return;
        ended = true;
        clearTimeout(limitTimer);
        if (flushTimer) clearTimeout(flushTimer);
        flush();
        if (!fromHub) unsubscribe?.();
        if (captures.get(deviceId)?.stop === stop) captures.delete(deviceId);
        emit({ note, ended: true });
        console.log(`🖥️ Console capture ${device.hwId} ended: ${note}`);
    };
    const stop = (note) => finish(note, false);

    unsubscribe = subscribeConsole(device, {
        onData: (buf) => {
            const text = cleanText(decoder.decode(buf, { stream: true }));
            if (!text) return;
            pending += text;
            if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
        },
        onNote: (note) => emit({ note }),
        onEnd: (note) => finish(note, true)
    });

    limitTimer = setTimeout(() => stop('time limit reached'), MAX_MS);
    captures.set(deviceId, { socketId: socket.id, stop });
    console.log(`🖥️ Console capture ${device.hwId} for ${socket.clientIp}`);
}

// socketId — останавливаем только свой захват (если указан)
export function stopConsoleCapture(deviceId, note = 'stopped', socketId = null) {
    const c = captures.get(String(deviceId));
    if (!c || (socketId && c.socketId !== socketId)) return false;
    c.stop(note);
    return true;
}

export function stopCapturesOfSocket(socketId) {
    for (const [deviceId, c] of captures) {
        if (c.socketId === socketId) stopConsoleCapture(deviceId, 'browser disconnected');
    }
}
