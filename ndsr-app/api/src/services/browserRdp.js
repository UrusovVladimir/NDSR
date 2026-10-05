// services/browserRdp.js — RDP к тестовым VM прямо в браузере (Guacamole).
//
// Браузер (guacamole-common-js) ↔ WebSocket guacamole-lite (GUAC_WS_PORT) ↔
// guacd (контейнер, GUACD_HOST:GUACD_PORT) ↔ RDP mgmt-IP VM:3389.
// Выключатель — GUACD_HOST: пусто → сервер не стартует, в UI кнопки нет,
// остаётся RDP-клиент (vm:getAccess).
//
// WebSocket — на отдельном порту, а не на HTTP-сервере socket.io: ws с
// опцией server отклоняет апгрейды на чужие пути и сломал бы socket.io.
// В проде nginx фронта проксирует /guacamole/ на этот порт.
//
// Токен (AES-256-CBC, ключ случайный на время жизни процесса) содержит
// параметры RDP с паролем Windows; живёт GUAC_TOKEN_TTL_MS и при открытии
// соединения повторно сверяется с vmAttachments — VM должна быть всё ещё
// подключена тем же пользователем.
import { createRequire } from 'module';
import { randomBytes } from 'crypto';
import { getVmById } from '../devices.js';
import { vmAttachments } from '../state/vmAttachments.js';

const require = createRequire(import.meta.url);
const GuacamoleLite = require('guacamole-lite');
const Crypt = require('guacamole-lite/lib/Crypt.js');

const CYPHER = 'AES-256-CBC';
const KEY = randomBytes(32);
const TOKEN_TTL_MS = Number(process.env.GUAC_TOKEN_TTL_MS) || 60 * 1000;

let server = null;

const isBrowserRdpEnabled = () => !!process.env.GUACD_HOST;

function startBrowserRdp() {
    if (!isBrowserRdpEnabled() || server) return;
    const wsPort = Number(process.env.GUAC_WS_PORT) || 3006;

    server = new GuacamoleLite(
        { port: wsPort },
        { host: process.env.GUACD_HOST, port: Number(process.env.GUACD_PORT) || 4822 },
        {
            crypt: { cypher: CYPHER, key: KEY },
            // Сессия рвётся, если браузер ничего не шлёт дольше этого. Фоновые
            // вкладки браузер притормаживает — 30 с выкидывало при переключении
            // вкладок; закрытие вкладки и так закрывает WebSocket сразу.
            maxInactivityTime: Number(process.env.GUAC_MAX_INACTIVITY_MS) || 10 * 60 * 1000,
            log: { level: 'ERRORS' }
        },
        {
            processConnectionSettings: (settings, callback) => {
                const { vmId, owner, expiresAt } = settings.ndsr || {};
                if (!vmId || !expiresAt || Date.now() > expiresAt) {
                    return callback(new Error('RDP token expired'));
                }
                const a = vmAttachments.get(String(vmId));
                if (!a || a.attachedBy !== owner) {
                    return callback(new Error('VM is no longer attached by this user'));
                }
                console.log(`🖥️ Browser RDP to VM ${vmId} by ${owner}`);
                callback(undefined, settings);
            }
        }
    );
    server.on('error', (err) => console.error(`❌ Browser RDP: ${err?.message || err}`));
    console.log(`🖥️ Browser RDP (guacamole-lite) on :${wsPort} → guacd ${process.env.GUACD_HOST}`);
}

// Токен для owner (уже проверен вызывающим как владелец VM)
function createRdpToken(vm, owner) {
    const crypt = new Crypt(CYPHER, KEY);
    return crypt.encrypt({
        ndsr: { vmId: String(vm.id), owner, expiresAt: Date.now() + TOKEN_TTL_MS },
        connection: {
            type: 'rdp',
            settings: {
                hostname: vm.mgmtIp,
                port: '3389',
                username: vm.rdpUser || '',
                password: vm.rdpPassword || '',
                security: 'any',
                'ignore-cert': true,
                'resize-method': 'display-update',
                'enable-wallpaper': false,
                'enable-font-smoothing': true,
                'disable-audio': true
            }
        }
    });
}

function getRdpTokenFor(socket, vmId) {
    if (!isBrowserRdpEnabled()) throw new Error('Browser RDP is disabled (GUACD_HOST is not set).');
    const vm = getVmById(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);
    const a = vmAttachments.get(String(vm.id));
    if (!a || a.attachedBy !== socket.clientIp) throw new Error('VM is not attached by you.');
    return { token: createRdpToken(vm, socket.clientIp), name: vm.name || String(vm.id) };
}

export { isBrowserRdpEnabled, startBrowserRdp, getRdpTokenFor };
