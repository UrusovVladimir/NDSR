// services/consoleCapture.js — вывод последовательной консоли устройства в окно
// прогресса во время перезагрузки / сброса.
//
// Консоль — telnet <хост консоли>:<consolePort>; хост по consoleID берётся из
// CONSOLE_HOSTS (через запятую, порядок как у MOXA_IPS: consoleID 1 — первый).
// Порт консоли пускает ОДНОГО клиента: новое подключение выбивает предыдущее.
// Поэтому захват только по запросу фронта и только когда у пользователя не
// открыто окно консоли этого устройства (webtelnet); если окно консоли откроют
// во время захвата — оно заберёт порт, захват завершится с пометкой.
//
// В браузер — событие device:consoleLog { deviceId, text? , note?, ended? }
// только сокету, запросившему захват. Текст очищен от telnet-команд, ANSI и \r.
import net from 'net';

const MAX_MS = Number(process.env.CONSOLE_CAPTURE_MAX_MS) || 6 * 60 * 1000;
const FLUSH_MS = 250;

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;

const captures = new Map(); // deviceId -> { conn, socketId, stop }

const consoleHosts = () => String(process.env.CONSOLE_HOSTS || '').split(',').map(s => s.trim());

function consoleTarget(device) {
    const host = consoleHosts()[Number(device.consoleID) - 1];
    const port = Number(device.consolePort);
    return host && Number.isInteger(port) && port > 0 ? { host, port } : null;
}

// Telnet-поток → данные; на DO/WILL отвечаем WONT/DONT (только читаем)
function makeTelnetParser(conn) {
    let state = 'data';
    let cmd = 0;
    return (buf) => {
        const out = [];
        for (const b of buf) {
            if (state === 'data') {
                if (b === IAC) state = 'iac';
                else out.push(b);
            } else if (state === 'iac') {
                if (b === IAC) { out.push(IAC); state = 'data'; }
                else if (b === SB) state = 'sb';
                else if (b >= WILL && b <= DONT) { cmd = b; state = 'opt'; }
                else state = 'data';
            } else if (state === 'opt') {
                if (cmd === DO) conn.write(Buffer.from([IAC, WONT, b]));
                else if (cmd === WILL) conn.write(Buffer.from([IAC, DONT, b]));
                state = 'data';
            } else if (state === 'sb') {
                if (b === IAC) state = 'sb-iac';
            } else if (state === 'sb-iac') {
                state = b === SE ? 'data' : 'sb';
            }
        }
        return Buffer.from(out);
    };
}

const cleanText = (s) => s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')   // ANSI
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

export const isConsoleCaptureEnabled = () => consoleHosts().some(Boolean);

export function startConsoleCapture(socket, device) {
    const deviceId = String(device.id);
    stopConsoleCapture(deviceId, 'restarted');

    const target = consoleTarget(device);
    if (!target) {
        throw new Error(isConsoleCaptureEnabled()
            ? `Console is not configured for ${device.hwId} (consoleID/consolePort)`
            : 'Console output is not configured on this stand (CONSOLE_HOSTS)');
    }

    const emit = (payload) => socket.emit('device:consoleLog', { deviceId, ...payload });
    const conn = net.connect(target.port, target.host);
    const parse = makeTelnetParser(conn);
    const decoder = new TextDecoder('utf-8');
    let pending = '';
    let flushTimer = null;
    let limitTimer = null;
    let ended = false;

    const flush = () => {
        flushTimer = null;
        if (pending) {
            emit({ text: pending });
            pending = '';
        }
    };

    const stop = (note) => {
        if (ended) return;
        ended = true;
        clearTimeout(limitTimer);
        if (flushTimer) clearTimeout(flushTimer);
        flush();
        conn.destroy();
        if (captures.get(deviceId)?.conn === conn) captures.delete(deviceId);
        emit({ note, ended: true });
        console.log(`🖥️ Console capture ${device.hwId} ended: ${note}`);
    };

    limitTimer = setTimeout(() => stop('time limit reached'), MAX_MS);

    conn.setNoDelay(true);
    conn.on('connect', () => {
        emit({ note: `connected to console ${target.host}:${target.port}` });
        console.log(`🖥️ Console capture ${device.hwId} → ${target.host}:${target.port} for ${socket.clientIp}`);
    });
    conn.on('data', (buf) => {
        const text = cleanText(decoder.decode(parse(buf), { stream: true }));
        if (!text) return;
        pending += text;
        if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
    });
    // Порт забрало другое подключение (окно консоли) или устройство его закрыло
    conn.on('close', () => stop('console connection closed (console window opened elsewhere?)'));
    conn.on('error', (err) => stop(`console error: ${err.message}`));

    captures.set(deviceId, { conn, socketId: socket.id, stop });
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
