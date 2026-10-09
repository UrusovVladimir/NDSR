// socket/handlers/adminBulk.js — массовые операции администратора
// (ADMIN_IPS): admin:whoami, admin:bulkPower.
//
// admin:bulkPower { deviceIds, action } — action: status | on | off |
// reboot | reset. Брони НЕ проверяются (администратор управляет стендом
// целиком). Устройства обрабатываются по одному (PowerHub/Jerome — telnet),
// в фоне; ответ сразу { success, jobId, total }, ход — событиями только
// инициатору:
//   admin:bulkProgress { jobId, deviceId, state: running|done|error, message }
//   admin:bulkDone     { jobId, action, total, done, failed }
// Одновременно — одна операция. Сброс конкурентов запрещён (как и везде),
// питание/перезагрузка конкурентов — можно.
import { randomUUID } from 'crypto';
import { on } from '../wrap.js';
import { getDeviceById } from '../../devices.js';
import { devicePowerStatus } from '../../state/power.js';
import { isRival } from '../../utils/deviceFlags.js';
import { isAdmin, requireAdmin } from '../../services/adminService.js';
import { sendOperationProgress } from '../../services/progress.js';
import { factoryResetDevice } from '../../services/resetService.js';
import { checkAndUpdateDeviceStatusImmediately } from '../../services/statusService.js';
import { getPortPowerStatus } from '../../actions/getPortPowerStatus.js';
import { powerSetup } from '../../actions/powerOnOff.js';
import { rebootDevice } from '../../actions/rebootDevice.js';

const ACTIONS = ['status', 'on', 'off', 'reboot', 'reset'];
let runningJob = null; // { jobId, action, by }

// Актуальный статус питания — всем клиентам (как device:power)
async function refreshPowerStatus(io, deviceId) {
  const previous = devicePowerStatus.get(deviceId);
  const { power } = await getPortPowerStatus(deviceId);
  devicePowerStatus.set(deviceId, power);
  io.emit('device:powerStatus', {
    deviceId,
    status: power,
    timestamp: Date.now(),
    changed: previous !== power
  });
  return power;
}

async function runAction(io, deviceId, action) {
  const device = getDeviceById(deviceId);
  if (!device) throw new Error('Device not found');

  switch (action) {
    case 'status':
      return `power ${await refreshPowerStatus(io, deviceId)}`;

    case 'on':
    case 'off': {
      await powerSetup(deviceId, action);
      let power = action;
      try {
        power = await refreshPowerStatus(io, deviceId);
      } catch (err) {
        console.warn(`[ADMIN] ${deviceId}: power status after ${action} unknown: ${err.message}`);
      }
      setTimeout(() => checkAndUpdateDeviceStatusImmediately(io, deviceId), 5000);
      return `power ${power}`;
    }

    case 'reboot':
      sendOperationProgress(io, deviceId, 0, 'rebooting');
      try {
        await rebootDevice(deviceId);
      } finally {
        sendOperationProgress(io, deviceId, 100, 'rebooting');
      }
      return 'rebooted';

    case 'reset': {
      if (isRival(device)) throw new Error('Not available for rival devices.');
      sendOperationProgress(io, deviceId, 0, 'resetting');
      let result;
      try {
        result = await factoryResetDevice(io, deviceId);
      } finally {
        sendOperationProgress(io, deviceId, 100, 'resetting');
      }
      return result?.wanError ? `reset; WAN not turned off: ${result.wanError.message}` : 'reset';
    }

    default:
      throw new Error(`Unknown action ${action}`);
  }
}

export function register(socket, io) {
  on(socket, 'admin:whoami', (callback) => {
    callback({ success: true, isAdmin: isAdmin(socket.clientIp), ip: socket.clientIp });
  });

  on(socket, 'admin:bulkPower', (data, callback) => {
    try {
      requireAdmin(socket);
      const { action } = data || {};
      if (!ACTIONS.includes(action)) throw new Error(`Unknown action: ${action}`);
      const ids = [...new Set((data?.deviceIds || []).map(String))]
        .filter(id => getDeviceById(id));
      if (!ids.length) throw new Error('No devices selected');
      if (runningJob) {
        throw new Error(`Another bulk operation is running (${runningJob.action} by ${runningJob.by})`);
      }

      const jobId = randomUUID();
      runningJob = { jobId, action, by: socket.clientIp };
      console.log(`[ADMIN] ${socket.clientIp}: bulk ${action} for ${ids.length} devices: ${ids.join(', ')}`);
      callback({ success: true, jobId, total: ids.length });

      (async () => {
        let done = 0;
        const failed = [];
        for (const deviceId of ids) {
          socket.emit('admin:bulkProgress', { jobId, deviceId, state: 'running' });
          try {
            const message = await runAction(io, deviceId, action);
            done++;
            socket.emit('admin:bulkProgress', { jobId, deviceId, state: 'done', message });
          } catch (err) {
            failed.push(deviceId);
            console.error(`[ADMIN] bulk ${action} ${deviceId}: ${err.message}`);
            socket.emit('admin:bulkProgress', { jobId, deviceId, state: 'error', message: err.message });
          }
        }
        console.log(`[ADMIN] bulk ${action} finished: ${done} ok, ${failed.length} failed`);
        socket.emit('admin:bulkDone', { jobId, action, total: ids.length, done, failed });
      })().finally(() => {
        runningJob = null;
      });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });
}
