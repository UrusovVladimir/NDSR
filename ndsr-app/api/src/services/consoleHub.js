// services/consoleHub.js — общее подключение к последовательной консоли устройства.
//
// Консоль — telnet <хост консоли>:<consolePort>; хост по consoleID берётся из
// CONSOLE_HOSTS (через запятую, порядок как у MOXA_IPS: consoleID 1 — первый).
// Порт консоли пускает ОДНОГО клиента: новое подключение выбивает предыдущее.
// Поэтому на устройство держим одно TCP-подключение и раздаём его всем
// подписчикам портала: окнам консоли (console.html) и захвату вывода при
// перезагрузке/сбросе (consoleCapture). Выбить его может только клиент не
// из портала (telnet напрямую, старый webtelnet).
//
// Подключение открывается первым подписчиком и закрывается с последним.
// Хвост вывода (HISTORY_BYTES) держим, чтобы новое окно консоли сразу
// показало последнее, что было на экране.
//
// Telnet: соглашаемся на ECHO/SGA/BINARY (как обычный telnet-клиент в
// символьном режиме), остальное отклоняем. Ввод: IAC удваивается, CR без
// BINARY шлётся как CR NUL (NVT).
import net from 'net';

const HISTORY_BYTES = 64 * 1024;

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const OPT_BINARY = 0, OPT_ECHO = 1, OPT_SGA = 3;
// Что принимаем от сервера (WILL → DO) и что готовы делать сами (DO → WILL)
const ACCEPT_REMOTE = new Set([OPT_BINARY, OPT_ECHO, OPT_SGA]);
const ACCEPT_LOCAL = new Set([OPT_BINARY, OPT_SGA]);

const sessions = new Map(); // deviceId -> session
let nextSubId = 1;

const consoleHosts = () => String(process.env.CONSOLE_HOSTS || '').split(',').map(s => s.trim());

export const isConsoleHubEnabled = () => consoleHosts().some(Boolean);

export function consoleTarget(device) {
    const host = consoleHosts()[Number(device?.consoleID) - 1];
    const port = Number(device?.consolePort);
    return host && Number.isInteger(port) && port > 0 ? { host, port } : null;
}

export function requireConsoleTarget(device) {
    const target = consoleTarget(device);
    if (!target) {
        throw new Error(isConsoleHubEnabled()
            ? `Console is not configured for ${device.hwId} (consoleID/consolePort)`
            : 'Console is not configured on this stand (CONSOLE_HOSTS)');
    }
    return target;
}

// Telnet-поток → данные; переговоры по ACCEPT_*, без повторных ответов
function makeTelnetParser(s) {
    let state = 'data';
    let cmd = 0;
    const reply = (verb, opt) => s.conn.write(Buffer.from([IAC, verb, opt]));
    const negotiate = (verb, opt) => {
        if (verb === WILL) {
            if (s.remote.has(opt)) return;
            if (ACCEPT_REMOTE.has(opt)) { s.remote.add(opt); reply(DO, opt); } else reply(DONT, opt);
        } else if (verb === WONT) {
            if (s.remote.delete(opt)) reply(DONT, opt);
        } else if (verb === DO) {
            if (s.local.has(opt)) return;
            if (ACCEPT_LOCAL.has(opt)) { s.local.add(opt); reply(WILL, opt); } else reply(WONT, opt);
        } else if (verb === DONT) {
            if (s.local.delete(opt)) reply(WONT, opt);
        }
    };
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
                negotiate(cmd, b);
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

const forEachSub = (s, fn) => {
    for (const sub of [...s.subs.values()]) {
        try { fn(sub); } catch (err) { console.error(`❌ Console ${s.hwId} subscriber: ${err.message}`); }
    }
};

function closeSession(s, note) {
    if (s.closed) return;
    s.closed = true;
    if (sessions.get(s.deviceId) === s) sessions.delete(s.deviceId);
    s.conn.destroy();
    const subs = [...s.subs.values()];
    s.subs.clear();
    for (const sub of subs) {
        try { sub.onEnd?.(note); } catch { /* подписчик уже ушёл */ }
    }
    console.log(`🖥️ Console ${s.hwId} closed: ${note}`);
}

function openSession(device, target) {
    const s = {
        deviceId: String(device.id),
        hwId: device.hwId,
        target,
        conn: net.connect(target.port, target.host),
        subs: new Map(),
        connected: false,
        closed: false,
        remote: new Set(),
        local: new Set(),
        history: [],
        historySize: 0
    };
    const parse = makeTelnetParser(s);

    s.conn.setNoDelay(true);
    s.conn.setKeepAlive(true, 30000);
    s.conn.on('connect', () => {
        s.connected = true;
        forEachSub(s, sub => sub.onNote?.(`connected to console ${target.host}:${target.port}`));
        console.log(`🖥️ Console ${s.hwId} → ${target.host}:${target.port}`);
    });
    s.conn.on('data', (buf) => {
        const data = parse(buf);
        if (!data.length) return;
        s.history.push(data);
        s.historySize += data.length;
        while (s.historySize > HISTORY_BYTES && s.history.length > 1) {
            s.historySize -= s.history.shift().length;
        }
        forEachSub(s, sub => sub.onData?.(data));
    });
    // Порт забрал клиент не из портала, или консоль-сервер закрыл соединение
    s.conn.on('close', () => closeSession(s, 'console connection closed (port taken by another client?)'));
    s.conn.on('error', (err) => closeSession(s, `console error: ${err.message}`));

    sessions.set(s.deviceId, s);
    return s;
}

// handlers: { onData(Buffer), onNote(text), onEnd(note) }; replay — сразу
// отдать хвост вывода. Возвращает функцию отписки (последний — закрывает порт).
export function subscribeConsole(device, handlers, { replay = false } = {}) {
    const target = requireConsoleTarget(device);
    const deviceId = String(device.id);
    let s = sessions.get(deviceId);
    if (s && (s.target.host !== target.host || s.target.port !== target.port)) {
        closeSession(s, 'console settings changed');
        s = null;
    }
    if (!s) s = openSession(device, target);

    const id = nextSubId++;
    s.subs.set(id, handlers);
    if (s.connected) handlers.onNote?.(`attached to console ${target.host}:${target.port}`);
    if (replay && s.historySize) handlers.onData?.(Buffer.concat(s.history));

    return (note = 'no subscribers left') => {
        if (!s.subs.delete(id)) return;
        if (s.subs.size === 0) closeSession(s, note);
    };
}

// Ввод с клавиатуры окна консоли (Buffer) → telnet
export function writeConsole(deviceId, data) {
    const s = sessions.get(String(deviceId));
    if (!s?.connected) return false;
    const binary = s.local.has(OPT_BINARY);
    const out = [];
    for (let i = 0; i < data.length; i++) {
        const b = data[i];
        if (b === IAC) out.push(IAC, IAC);
        else if (b === 13 && !binary && data[i + 1] !== 10) out.push(13, 0);
        else out.push(b);
    }
    s.conn.write(Buffer.from(out));
    return true;
}
