// socket/handlers/vm.js — тестовые VM: vm:list, vm:attach, vm:detach, vm:getAccess,
// vm:renewIp, vm:getRdpToken (RDP в браузере).
// Изменения рассылаются всем событием vm:list (services/vmService).
import { on } from '../wrap.js';
import {
  buildVmListPayload,
  attachVm,
  detachVm,
  getVmAccess,
  refreshGuestIp
} from '../../services/vmService.js';
import { getVmById } from '../../devices.js';
import { isBrowserRdpEnabled, getRdpTokenFor } from '../../services/browserRdp.js';
import { vmAttachments } from '../../state/vmAttachments.js';

export function register(socket) {
  on(socket, 'vm:list', (callback) => {
    callback({ success: true, vms: buildVmListPayload() });
  });

  // { vmId, deviceId } — устройство в своей брони; VM свободна или уже своя
  on(socket, 'vm:attach', async (data, callback) => {
    const { vmId, deviceId } = data || {};
    const result = await attachVm(socket, vmId, deviceId);
    callback({ success: true, ...result });
  });

  on(socket, 'vm:detach', async (data, callback) => {
    const { vmId } = data || {};
    await detachVm(vmId, { socket, reason: 'manual' });
    callback({ success: true });
  });

  // Адрес/порт RDP на docker-хосте и учётка Windows — только владельцу
  on(socket, 'vm:getAccess', (data, callback) => {
    const { vmId } = data || {};
    callback({ success: true, access: { ...getVmAccess(socket, vmId), browserRdp: isBrowserRdpEnabled() } });
  });

  // Короткоживущий токен для RDP в браузере (services/browserRdp)
  on(socket, 'vm:getRdpToken', (data, callback) => {
    const { vmId } = data || {};
    callback({ success: true, ...getRdpTokenFor(socket, vmId) });
  });

  // Повторить DHCP внутри Windows (например, после сброса роутера)
  on(socket, 'vm:renewIp', (data, callback) => {
    const { vmId } = data || {};
    const vm = getVmById(vmId);
    const a = vmAttachments.get(String(vmId));
    if (!vm || !a || a.attachedBy !== socket.clientIp) {
      return callback({ success: false, error: 'VM is not attached by you.' });
    }
    refreshGuestIp(vm);
    callback({ success: true });
  });
}
