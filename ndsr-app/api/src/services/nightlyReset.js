// services/nightlyReset.js — ночной сброс устройств (4:00, cron включается
// в state/runtime). WAN выключается в самом сбросе (resetService) — отдельной
// задачи 2:50 больше нет: она рвала MWS-связки до их отключения.
import cron from 'node-cron';
import { devices } from '../devices.js';
import { deviceBookings } from '../state/bookings.js';
import { currentModes } from '../state/modes.js';
import { getCronStatus } from '../state/runtime.js';
import { getIO } from '../state/io.js';
import { factoryResetDevice } from './resetService.js';
import { disconnectExtenderInBackground } from './linkService.js';
import { isRival } from '../utils/deviceFlags.js';

let scheduled = false;

// Ключи броней — строки; routerId в currentModes мог прийти числом с фронта
function isDeviceBookedNow(deviceId) {
  const booking = deviceBookings.get(String(deviceId));
  if (!booking) return false;
  const now = Math.floor(Date.now() / 1000);
  return now < booking.expiresAt;
}

// Перед сбросом подключённые экстендеры отключаются от роутера и уходят
// в router (AP-переключатель — в extender). Сброс экстендера, висящего на
// роутере, оставил бы VLAN на коммутаторе, пробросы и extender_connect
// в currentModes. Возвращает id, которые сбрасывать нельзя:
// - роутер в брони — его связку не трогаем, экстендер тоже не сбрасываем;
// - отключение не удалось — не сбрасываем ни экстендер, ни роутер, чтобы
//   связку можно было разобрать вручную.
async function disconnectLinkedExtenders() {
  const skip = new Set();
  const links = [...currentModes.entries()]
    .filter(([, info]) => info?.mode === 'extender_connect' && info.routerId);

  for (const [extenderId, { routerId }] of links) {
    if (isDeviceBookedNow(extenderId)) continue; // сброс его всё равно пропустит

    if (isDeviceBookedNow(routerId)) {
      console.log(`Skipping extender ${extenderId} — its router ${routerId} is booked`);
      skip.add(String(extenderId));
      continue;
    }

    try {
      console.log(`Disconnecting extender ${extenderId} from router ${routerId} before reset...`);
      const mode = await disconnectExtenderInBackground(getIO(), extenderId, routerId, { resetFollows: true });
      console.log(`Extender ${extenderId} disconnected, mode: ${mode}`);
    } catch (err) {
      console.error(`Failed to disconnect extender ${extenderId} from router ${routerId}: ${err.message} — skipping reset of both`);
      skip.add(String(extenderId));
      skip.add(String(routerId));
    }
  }

  return skip;
}

// CRON на сброс всех устройств в 4:00
async function resetAllDevices() {
  if (!getCronStatus()) {
    console.log("Cron is disabled — skipping auto reset.");
    return;
  }

  console.log("Starting automatic device reset...");

  const skip = await disconnectLinkedExtenders();

  for (const device of devices) {
    if (isRival(device)) {
      console.log(`Skipping ${device.hwId} — rival device`);
      continue;
    }
    if (isDeviceBookedNow(device.id)) {
      console.log(`Skipping ${device.hwId} — booked`);
      continue;
    }
    if (skip.has(String(device.id))) {
      console.log(`Skipping ${device.hwId} — MWS link not disconnected`);
      continue;
    }

    try {
      const { wanError } = await factoryResetDevice(getIO(), device.id);
      console.log(`Successfully reset device: ${device.hwId}${wanError ? ' (WAN NOT turned off, see above)' : ''}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`Failed to reset device ${device?.hwId}:`, err.message);
    }
  }

  console.log("All devices processed for reset.");
}

// Повторный вызов — no-op (иначе задачи задвоятся)
function scheduleNightlyReset() {
  if (scheduled) return;
  scheduled = true;

  cron.schedule("0 4 * * *", () => {
    const timestamp = new Date().toLocaleString();
    console.log(`[${timestamp}] Auto-reset triggered by cron`);
    resetAllDevices().catch(err => {
      console.error(`[${timestamp}] Auto-reset failed:`, err);
    });
  }, { timezone: "Europe/Moscow" });
}

export { scheduleNightlyReset, resetAllDevices, disconnectLinkedExtenders };
