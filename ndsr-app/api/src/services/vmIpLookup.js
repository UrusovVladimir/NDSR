// services/vmIpLookup.js — адрес тестовой VM в LAN устройства, без захода в
// Windows: по MAC LAN-адаптера VM (lanMac в vms.json) в таблице DHCP того
// Keenetic, который раздаёт адреса в этом LAN (RCI /show/ip/dhcp/bindings).
// Подключённый экстендер — LAN его роутера. У конкурентов RCI нет — адрес
// неизвестен (смотреть ipconfig в Windows).
//
// Результат: { ip, reason } — reason, если ip нет: 'no-mac' | 'rival' |
// 'not-found' | 'auth' | 'cooldown' | 'unreachable'.
import { getDeviceById } from '../devices.js';
import { makeAuthenticatedRequest } from '../actions/athentication.js';
import { isRival } from '../utils/deviceFlags.js';
import { getActiveLink } from './linkService.js';
import { getDeviceUrl } from './statusService.js';
import {
    getPasswordCandidates,
    tryWithPasswords,
    isAuthCoolingDown,
    setAuthCooldown,
    clearAuthCooldown
} from './passwordService.js';

const normMac = (mac) => String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');

// Устройство, которое раздаёт DHCP в LAN, куда подключена VM
function dhcpServerFor(deviceId) {
    const link = getActiveLink(deviceId);
    return getDeviceById(link ? link.routerId : deviceId);
}

async function lookupVmIp(vm, deviceId) {
    const mac = normMac(vm.lanMac);
    if (mac.length !== 12) return { ip: null, reason: 'no-mac' };

    const device = dhcpServerFor(deviceId);
    if (!device) return { ip: null, reason: 'unreachable' };
    if (isRival(device)) return { ip: null, reason: 'rival' };
    // Не долбим устройство после провала авторизации (антиперебор Keenetic)
    if (isAuthCoolingDown(device.id)) return { ip: null, reason: 'cooldown' };

    const url = getDeviceUrl(device.id, 'auth');
    const candidates = getPasswordCandidates(device.id, null, {}, 'background');
    let probe;
    try {
        probe = await tryWithPasswords(candidates, (password) =>
            makeAuthenticatedRequest(url, 'admin', password, '/rci/show/ip/dhcp/bindings', 'GET'));
    } catch (err) {
        // не-auth ошибка (сеть/таймаут) — cooldown не ставим
        console.warn(`⚠️ VM ${vm.id}: DHCP bindings of ${device.hwId || device.id} unavailable: ${err.message}`);
        return { ip: null, reason: 'unreachable' };
    }
    if (!probe.result) {
        setAuthCooldown(device.id);
        return { ip: null, reason: 'auth' };
    }
    clearAuthCooldown(device.id);

    const leases = Array.isArray(probe.result.lease) ? probe.result.lease : [];
    const lease = leases.find(l => normMac(l.mac) === mac && l.ip);
    return lease ? { ip: String(lease.ip), reason: null } : { ip: null, reason: 'not-found' };
}

export { lookupVmIp, normMac };
