// socket/handlers/consoleCapture.js — вывод консоли устройства в окно прогресса
// перезагрузки / сброса: device:consoleCapture:start, device:consoleCapture:stop.
// Только владелец брони (консоль, перезагрузка и сброс — его же права).
// Подробности и ограничения — services/consoleCapture.js.
import { on } from '../wrap.js';
import { getDeviceById } from '../../devices.js';
import { requireBooking, requireNotRival } from '../../services/bookingService.js';
import {
  startConsoleCapture,
  stopConsoleCapture,
  stopCapturesOfSocket
} from '../../services/consoleCapture.js';

export function register(socket) {
  on(socket, 'device:consoleCapture:start', (data, callback) => {
    try {
      const deviceId = String(data?.deviceId || '');
      requireBooking(socket, deviceId);
      requireNotRival(deviceId);
      const device = getDeviceById(deviceId);
      if (!device) throw new Error(`Device ${deviceId} not found`);
      startConsoleCapture(socket, device);
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  on(socket, 'device:consoleCapture:stop', (data, callback) => {
    stopConsoleCapture(String(data?.deviceId || ''), 'stopped', socket.id);
    callback?.({ success: true });
  });

  socket.on('disconnect', () => stopCapturesOfSocket(socket.id));
}
