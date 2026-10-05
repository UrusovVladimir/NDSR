// services/vmService.js — тестовые Windows VM, подключаемые в LAN устройства.
//
// Атач: VLAN LAN-адаптера VM входит в мост LAN устройства на docker-хосте
// (по vlanLocal устройства, utils/vmNetwork),
// на хосте открывается RDP только с IP владельца брони. Адрес VM от роутера
// показывается из его таблицы DHCP (services/vmIpLookup).
// VM живёт, пока жива бронь устройства: reconcile() отцепляет VM от
// освобождённых/истёкших/чужих броней и восстанавливает связки после
// перезагрузки docker-хоста. В Windows бэкенд не заходит: DHCP обновляет
// сторож внутри VM (Prepare-NdsrTestVm.ps1), адрес берётся из DHCP роутера.
import { vms, getVmById, getDeviceById } from '../devices.js';
import { vmAttachments } from '../state/vmAttachments.js';
import { deviceBookings } from '../state/bookings.js';
import { getIO } from '../state/io.js';
import { initializeDockerManager } from './docker.js';
import { requireBooking } from './bookingService.js';
import { getActiveLink } from './linkService.js';
import {
    bridgeExists,
    ensureLanBridge,
    cleanupLanBridge,
    isOwnLanBridge,
    getVlanMaster,
    attachVlanToBridge,
    detachVlan,
    setRdpAccess,
    removeRdpAccess,
    hasRdpAccess
} from '../utils/vmNetwork.js';
import { lookupVmIp } from './vmIpLookup.js';

// Адрес, который видит пользователь для RDP-клиента (docker-хост снаружи)
const rdpPublicHost = () => process.env.VM_RDP_PUBLIC_HOST || process.env.SSH_HOST || '';

// С какого адреса разрешён RDP: IP владельца брони. VM_RDP_SOURCE_OVERRIDE —
// только для разработки: dev-бэкенд видит браузер по локальной сети, а mstsc
// приходит на docker-хост с VPN-адреса — задайте этот VPN-адрес.
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const rdpSource = (clientIp) => process.env.VM_RDP_SOURCE_OVERRIDE || clientIp;
if (process.env.VM_RDP_SOURCE_OVERRIDE) {
    if (IPV4.test(process.env.VM_RDP_SOURCE_OVERRIDE)) {
        console.warn(`⚠️ VM_RDP_SOURCE_OVERRIDE=${process.env.VM_RDP_SOURCE_OVERRIDE}: RDP к VM открывается только с этого адреса (режим разработки)`);
    } else {
        console.error(`❌ VM_RDP_SOURCE_OVERRIDE=${process.env.VM_RDP_SOURCE_OVERRIDE} — не IPv4-адрес: подключение VM будет отклонено. Укажите свой VPN-IP или удалите переменную`);
    }
}

// Адрес, для которого откроется RDP, проверяется ДО изменений сети
function requireRdpSource(clientIp) {
    const source = rdpSource(clientIp);
    if (!IPV4.test(String(source))) {
        throw new Error(process.env.VM_RDP_SOURCE_OVERRIDE
            ? `VM_RDP_SOURCE_OVERRIDE "${source}" is not an IPv4 address — fix it in .env`
            : `Cannot open RDP for client address "${source}" (IPv4 expected)`);
    }
    return source;
}

// Операции над одной VM — строго по очереди (атач двух пользователей,
// атач во время reconcile и т.п.)
const vmLocks = new Map();
function withVmLock(vmId, fn) {
    const key = String(vmId);
    const prev = vmLocks.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    // Хвост очереди хранит только факт завершения: ошибку получает вызывающий
    // через next, а сам хвост не должен давать unhandled rejection
    const tail = next.catch(() => {}).finally(() => {
        if (vmLocks.get(key) === tail) vmLocks.delete(key);
    });
    vmLocks.set(key, tail);
    return next;
}

async function getSsh() {
    const dm = await initializeDockerManager();
    return dm.sshManager;
}

// LAN устройства: явный мост (поле bridge в devices.json) или VLAN его LAN
// (vlanLocal — тот же, что PVID на LAN-порту коммутатора). Подключённый
// экстендер — в LAN своего роутера.
function resolveLanTarget(deviceId) {
    const link = getActiveLink(deviceId);
    const device = getDeviceById(link ? link.routerId : deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);
    if (device.bridge) return { bridge: String(device.bridge), lanVlan: null };
    const lanVlan = Number(device.vlanLocal);
    if (!Number.isInteger(lanVlan) || lanVlan < 1 || lanVlan > 4094) {
        throw new Error(device.vlanLocal === undefined || device.vlanLocal === ''
            ? `Device ${device.hwId || device.id}: vlanLocal is not set — set it (or "bridge") in devices.json`
            : `Device ${device.hwId || device.id}: vlanLocal ${device.vlanLocal} is not a valid VLAN (1–4094)`);
    }
    return { bridge: null, lanVlan };
}

async function ensureLanTarget(ssh, target) {
    if (target.lanVlan) return ensureLanBridge(ssh, target.lanVlan);
    if (!(await bridgeExists(ssh, target.bridge))) {
        throw new Error(`Bridge ${target.bridge} not found on docker host — check "bridge" in devices.json`);
    }
    return target.bridge;
}

// Свой мост ndsr-lan<vlan> убирается, когда им не пользуется ни одна VM
async function releaseBridgeIfUnused(ssh, bridge, exceptVmId) {
    if (!isOwnLanBridge(bridge)) return;
    const inUse = [...vmAttachments.entries()]
        .some(([id, a]) => id !== String(exceptVmId) && a.bridge === bridge);
    if (!inUse) await cleanupLanBridge(ssh, bridge);
}

function isBookedBy(deviceId, clientIp) {
    const booking = deviceBookings.get(String(deviceId));
    if (!booking) return false;
    return booking.bookedBy === clientIp && Math.floor(Date.now() / 1000) < booking.expiresAt;
}

// Без логинов и паролей — их получает только владелец (getVmAccess)
function buildVmListPayload() {
    return vms.map(vm => {
        const a = vmAttachments.get(String(vm.id));
        const device = a ? getDeviceById(a.deviceId) : null;
        return {
            id: String(vm.id),
            name: vm.name || String(vm.id),
            os: vm.os || '',
            attachment: a ? {
                deviceId: String(a.deviceId),
                deviceName: device?.shortName || device?.hwId || String(a.deviceId),
                attachedBy: a.attachedBy,
                attachedAt: a.attachedAt,
                ip: a.ip || null,
                ipReason: a.ipReason || null,
                ipPending: !!a.ipPending
            } : null
        };
    });
}

function emitVmList() {
    getIO()?.emit('vm:list', buildVmListPayload());
}

// Адрес LAN-адаптера VM — из таблицы DHCP роутера (vmIpLookup), фоном,
// результат приходит событием vm:list. После атача Windows получает адрес
// сама (сторож в VM замечает смену сети за ~30 с) — опрашиваем несколько раз.
// Идущие опросы — в памяти: ipPending в файле после рестарта ничего не значит.
const IP_POLL_ATTEMPTS = 9;
const IP_POLL_INTERVAL_MS = 10 * 1000;
const IP_RECHECK_MS = 60 * 1000;          // адреса нет — уточнять раз в минуту
const IP_REFRESH_MS = 5 * 60 * 1000;      // адрес есть — перепроверять реже
const FINAL_REASONS = new Set(['no-mac', 'rival', 'auth', 'cooldown']);
const ipJobs = new Set();

function withTimeout(promise, ms, what) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timeout`)), ms); })
    ]).finally(() => clearTimeout(timer));
}

function refreshGuestIp(vm, { attempts = IP_POLL_ATTEMPTS } = {}) {
    const key = String(vm.id);
    const a = vmAttachments.get(key);
    if (!a || ipJobs.has(key)) return;
    ipJobs.add(key);
    vmAttachments.set(key, { ...a, ipPending: true });
    emitVmList();

    let res = { ip: null, reason: 'not-found' };
    (async () => {
        for (let i = 0; i < attempts; i++) {
            const cur = vmAttachments.get(key);
            if (!cur || cur.attachedAt !== a.attachedAt) return;
            try {
                res = await withTimeout(lookupVmIp(vm, cur.deviceId), 30 * 1000, 'DHCP lookup');
            } catch (err) {
                res = { ip: null, reason: 'unreachable' };
                console.warn(`⚠️ VM ${vm.id}: ${err.message}`);
            }
            if (res.ip || FINAL_REASONS.has(res.reason)) break;
            if (i < attempts - 1) await new Promise(r => setTimeout(r, IP_POLL_INTERVAL_MS));
        }
        console.log(`🖥️ VM ${vm.id}: LAN address ${res.ip || `unknown (${res.reason})`}`);
    })().finally(() => {
        ipJobs.delete(key);
        const current = vmAttachments.get(key);
        // за это время VM могли отцепить или перецепить
        if (!current || current.attachedAt !== a.attachedAt) return;
        vmAttachments.set(key, {
            ...current,
            ip: res.ip,
            ipReason: res.ip ? null : res.reason,
            ipPending: false,
            ipCheckedAt: Date.now()
        });
        emitVmList();
    });
}

async function attachVm(socket, vmId, deviceId) {
    const vm = getVmById(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);
    if (!getDeviceById(deviceId)) throw new Error(`Device ${deviceId} not found`);
    // Конкурентам VM разрешены (Windows-клиент за чужим роутером — для сравнения)
    requireBooking(socket, deviceId);

    return withVmLock(vm.id, async () => {
        const key = String(vm.id);
        const current = vmAttachments.get(key);
        if (current && current.attachedBy !== socket.clientIp && isBookedBy(current.deviceId, current.attachedBy)) {
            throw new Error('VM is used by another user.');
        }
        if (current && String(current.deviceId) === String(deviceId) && current.attachedBy === socket.clientIp) {
            return { alreadyAttached: true };
        }

        const source = requireRdpSource(socket.clientIp);
        const target = resolveLanTarget(deviceId);
        if (target.lanVlan === Number(vm.vlan)) {
            throw new Error(`VM ${vm.id} VLAN ${vm.vlan} equals device LAN VLAN — fix vlan in vms.json`);
        }
        const ssh = await getSsh();
        const bridge = await ensureLanTarget(ssh, target);

        console.log(`🖥️ VM ${vm.id} → device ${deviceId} (bridge ${bridge}${target.lanVlan ? `, LAN VLAN ${target.lanVlan}` : ''}) by ${socket.clientIp}`);
        await attachVlanToBridge(ssh, vm.vlan, bridge);
        await setRdpAccess(ssh, vm, source);

        vmAttachments.set(key, {
            deviceId: String(deviceId),
            bridge,
            lanVlan: target.lanVlan,
            attachedBy: socket.clientIp,
            attachedAt: Date.now(),
            ip: null,
            ipPending: true
        });
        // Перенос с другого устройства — прежний свой мост мог опустеть
        if (current && current.bridge !== bridge) await releaseBridgeIfUnused(ssh, current.bridge, null);
        emitVmList();
        refreshGuestIp(vm);
        return { alreadyAttached: false, bridge };
    });
}

// socket — проверка владельца (ручной детач); без него — системный (reconcile)
async function detachVm(vmId, { socket = null, reason = 'manual' } = {}) {
    const key = String(vmId);
    return withVmLock(key, async () => {
        const a = vmAttachments.get(key);
        if (!a) return { wasAttached: false };
        if (socket && a.attachedBy !== socket.clientIp) {
            throw new Error('VM is attached by another user.');
        }
        const vm = getVmById(key);
        console.log(`🖥️ VM ${key} detached from device ${a.deviceId} (${reason})`);
        if (vm) {
            const ssh = await getSsh();
            await detachVlan(ssh, vm.vlan);
            await removeRdpAccess(ssh, vm);
            await releaseBridgeIfUnused(ssh, a.bridge, key);
        }
        vmAttachments.delete(key);
        emitVmList();
        // Windows отпустит адрес сама: сторож в VM увидит, что шлюз пропал
        return { wasAttached: true };
    });
}

async function detachVmsForDevice(deviceId, reason) {
    const ids = [...vmAttachments.entries()]
        .filter(([, a]) => String(a.deviceId) === String(deviceId))
        .map(([id]) => id);
    for (const id of ids) {
        try {
            await detachVm(id, { reason });
        } catch (err) {
            console.error(`❌ VM ${id}: auto-detach failed (${reason}): ${err.message}`);
        }
    }
}

// RDP-клиент: адрес и учётка — только тому, кто подключил VM
function getVmAccess(socket, vmId) {
    const vm = getVmById(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);
    const a = vmAttachments.get(String(vm.id));
    if (!a || a.attachedBy !== socket.clientIp) {
        throw new Error('VM is not attached by you.');
    }
    return {
        host: rdpPublicHost(),
        port: Number(vm.rdpPort),
        username: vm.rdpUser || '',
        password: vm.rdpPassword || '',
        ip: a.ip || null
    };
}

// Сверка с реальностью: истёкшие/освобождённые/чужие брони → детач;
// сабинтерфейс не в своём мосту или нет RDP-правила (перезагрузка
// docker-хоста) → восстановить; VLAN неподключённой VM в мосту → убрать.
let reconcileRunning = false;
async function reconcileVms() {
    if (reconcileRunning || vms.length === 0 && vmAttachments.size === 0) return;
    reconcileRunning = true;
    try {
        for (const [id, a] of [...vmAttachments.entries()]) {
            const vm = getVmById(id);
            if (!vm) {
                console.warn(`⚠️ VM ${id} is no longer in vms.json — dropping attachment`);
                vmAttachments.delete(id);
                continue;
            }
            if (!isBookedBy(a.deviceId, a.attachedBy)) {
                await detachVm(id, { reason: 'booking ended' });
                continue;
            }
            // Адрес из DHCP роутера: нет — уточнять раз в минуту, есть — раз в 5 минут.
            // «no-mac»/«rival» не меняются сами — не опрашиваем зря
            const since = Date.now() - (a.ipCheckedAt || 0);
            const due = a.ip ? since > IP_REFRESH_MS : since > IP_RECHECK_MS;
            const pointless = a.ipReason === 'rival' || (a.ipReason === 'no-mac' && !vm.lanMac);
            if (!ipJobs.has(id) && due && !pointless) {
                refreshGuestIp(vm, { attempts: 1 });
            }
        }

        const ssh = await getSsh();
        for (const vm of vms) {
            await withVmLock(vm.id, async () => {
                const a = vmAttachments.get(String(vm.id));
                const master = await getVlanMaster(ssh, vm.vlan);
                if (a) {
                    if (master !== a.bridge) {
                        // Свой мост после перезагрузки хоста создаётся заново
                        const bridge = a.lanVlan
                            ? await ensureLanBridge(ssh, a.lanVlan)
                            : a.bridge;
                        console.warn(`🔧 VM ${vm.id}: restoring bridge ${bridge} (was ${master || 'none'})`);
                        await attachVlanToBridge(ssh, vm.vlan, bridge);
                        if (bridge !== a.bridge) vmAttachments.set(String(vm.id), { ...a, bridge });
                    }
                    const source = rdpSource(a.attachedBy);
                    if (!(await hasRdpAccess(ssh, vm, source))) {
                        console.warn(`🔧 VM ${vm.id}: restoring RDP access for ${source}`);
                        await setRdpAccess(ssh, vm, source);
                    }
                } else {
                    if (master) {
                        console.warn(`🔧 VM ${vm.id}: not attached but in bridge ${master} — parking`);
                        await detachVlan(ssh, vm.vlan);
                    }
                    // RDP-правило неподключённой VM — всегда снимаем: netfilter-persistent
                    // мог сохранить его и вернуть после перезагрузки хоста
                    await removeRdpAccess(ssh, vm);
                }
            });
        }

        // Свои мосты, которыми не пользуется ни одна VM (остались после сбоя)
        const bridges = await ssh.executeCommand('ip -o link show type bridge');
        const own = (bridges.stdout || '').split('\n')
            .map(line => line.match(/^\d+:\s+([^@:\s]+)/)?.[1])
            .filter(isOwnLanBridge);
        for (const bridge of own) await releaseBridgeIfUnused(ssh, bridge, null);
    } catch (err) {
        console.error(`❌ VM reconcile failed: ${err.message}`);
    } finally {
        reconcileRunning = false;
    }
}

export {
    buildVmListPayload,
    emitVmList,
    attachVm,
    detachVm,
    detachVmsForDevice,
    getVmAccess,
    reconcileVms,
    refreshGuestIp
};
