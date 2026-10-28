// socket/handlers/lanWan.js — «LAN роутера как WAN» (services/lanWanService.js):
// lanWan:list, lanWan:plan, lanWan:apply, lanWan:dismantle. Изменения
// рассылаются всем событием lanWan:links. Только брони пользователя.
import { on } from '../wrap.js';
import { requireBooking } from '../../services/bookingService.js';
import {
  buildLanWanPayload,
  planLanWan,
  applyLanWan,
  dismantleChainOf
} from '../../services/lanWanService.js';

export function register(socket, io) {
  on(socket, 'lanWan:list', (callback) => {
    callback({ success: true, links: buildLanWanPayload() });
  });

  // { consumerId, upstreamId } → подсети, конфликт, предложение
  on(socket, 'lanWan:plan', async (data, callback) => {
    const plan = await planLanWan(socket.clientIp, String(data?.consumerId || ''), String(data?.upstreamId || ''));
    callback({ success: true, plan });
  });

  // { consumerId, upstreamId, lan: { mode: 'keep'|'auto'|'manual', ip? } }
  on(socket, 'lanWan:apply', async (data, callback) => {
    const result = await applyLanWan(io, socket.clientIp, String(data?.consumerId || ''),
      String(data?.upstreamId || ''), data?.lan || { mode: 'auto' });
    callback({ success: true, ...result });
  });

  // Разобрать всю схему, в которой участвует устройство
  on(socket, 'lanWan:dismantle', async (data, callback) => {
    const deviceId = String(data?.deviceId || '');
    requireBooking(socket, deviceId);
    const result = await dismantleChainOf(io, deviceId, { reason: 'manual' });
    callback({ success: result.ok, ...result, error: result.ok ? undefined : result.errors.join('; ') });
  });
}
