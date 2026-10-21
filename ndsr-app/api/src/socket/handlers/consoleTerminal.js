// socket/handlers/consoleTerminal.js — окно консоли устройства в браузере
// (console.html, xterm.js) вместо контейнеров webtelnet:
// console:open { deviceId, replay? }, console:input, console:close.
// replay (по умолчанию да) — сразу прислать хвост вывода; окно при
// переподключении его не просит, чтобы не задвоить экран.
// Браузер → { deviceId, data } события console:data (Buffer), console:note,
// console:end. Только владелец брони; бронь перепроверяется на каждый ввод и
// раз в BOOKING_CHECK_MS — закончилась, окно отключается.
// Подключение к порту консоли общее (services/consoleHub.js).
import { on } from '../wrap.js';
import { getDeviceById } from '../../devices.js';
import { deviceBookings } from '../../state/bookings.js';
import { requireBooking, requireNotRival } from '../../services/bookingService.js';
import { getEffectiveDevicePassword } from '../../services/passwordService.js';
import { subscribeConsole, writeConsole, requireConsoleTarget } from '../../services/consoleHub.js';

const BOOKING_CHECK_MS = 15000;
const MAX_INPUT_BYTES = 64 * 1024;

export function register(socket) {
  const terminals = new Map(); // deviceId -> { unsubscribe, timer }

  const closeTerminal = (deviceId, note) => {
    const t = terminals.get(deviceId);
    if (!t) return;
    terminals.delete(deviceId);
    clearInterval(t.timer);
    t.unsubscribe();
    if (note) socket.emit('console:end', { deviceId, note });
  };

  on(socket, 'console:open', (data, callback) => {
    try {
      const deviceId = String(data?.deviceId || '');
      requireBooking(socket, deviceId);
      requireNotRival(deviceId);
      const device = getDeviceById(deviceId);
      if (!device) throw new Error(`Device ${deviceId} not found`);
      const target = requireConsoleTarget(device);

      closeTerminal(deviceId);
      const unsubscribe = subscribeConsole(device, {
        onData: (buf) => socket.emit('console:data', { deviceId, data: buf }),
        onNote: (note) => socket.emit('console:note', { deviceId, note }),
        onEnd: (note) => {
          const t = terminals.get(deviceId);
          if (t?.unsubscribe !== unsubscribe) return;
          terminals.delete(deviceId);
          clearInterval(t.timer);
          socket.emit('console:end', { deviceId, note });
        }
      }, { replay: data?.replay !== false });
      const timer = setInterval(() => {
        if (deviceBookings.get(deviceId)?.bookedBy !== socket.clientIp) {
          closeTerminal(deviceId, 'booking ended');
        }
      }, BOOKING_CHECK_MS);
      terminals.set(deviceId, { unsubscribe, timer });
      console.log(`🖥️ Console window ${device.hwId} → ${target.host}:${target.port} for ${socket.clientIp}`);

      // Пароль устройства — кнопка в окне вводит его при логине в консоли.
      // Пароли устройств видны всем пользователям портала by design.
      const booking = deviceBookings.get(deviceId);
      callback({
        success: true,
        deviceName: device.shortName ? `${device.hwId} · ${device.shortName}` : device.hwId,
        target: `${target.host}:${target.port}`,
        devicePassword: getEffectiveDevicePassword(deviceId) ||
          (booking && !booking.passwordInvalidated ? booking.accessPassword : null) || null
      });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  // { deviceId, data: string, binary? } — binary: строка байтов (xterm onBinary)
  on(socket, 'console:input', (data) => {
    const deviceId = String(data?.deviceId || '');
    if (!terminals.has(deviceId) || typeof data?.data !== 'string') return;
    try {
      requireBooking(socket, deviceId);
    } catch {
      return closeTerminal(deviceId, 'booking ended');
    }
    const buf = Buffer.from(data.data, data.binary ? 'latin1' : 'utf8');
    if (buf.length > MAX_INPUT_BYTES) return;
    writeConsole(deviceId, buf);
  }, { ack: false });

  on(socket, 'console:close', (data) => {
    closeTerminal(String(data?.deviceId || ''));
  }, { ack: false });

  socket.on('disconnect', () => {
    for (const deviceId of [...terminals.keys()]) closeTerminal(deviceId);
  });
}
