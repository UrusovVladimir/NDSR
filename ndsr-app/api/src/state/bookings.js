// state/bookings.js — брони устройств. Map (не PersistentMap): загрузка
// фильтрует протухшие брони и брони несуществующих устройств, а сохранение
// явное (saveBookings) — поведение идентично прежнему socketHandler.js.
// Путь резолвится от process.cwd(), как и раньше.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getDeviceById } from '../devices.js';

const BOOKINGS_PATH = process.env.BOOKINGS_PATH || './bookings.json';

export const deviceBookings = new Map();

export function loadBookings() {
  try {
    if (!existsSync(BOOKINGS_PATH)) {
      console.log('📂 bookings.json не найден — стартуем без броней');
      return;
    }
    const raw = JSON.parse(readFileSync(BOOKINGS_PATH, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    let restored = 0, skipped = 0;

    for (const [deviceId, booking] of Object.entries(raw)) {
      // Восстанавливаем только живые брони для существующих устройств
      if (booking?.bookedBy && booking?.expiresAt > now && getDeviceById(deviceId)) {
        deviceBookings.set(deviceId, booking);
        restored++;
      } else {
        skipped++;
      }
    }
    console.log(`📂 Bookings restored: ${restored} active, ${skipped} skipped (expired/unknown device)`);
  } catch (error) {
    console.error('❌ Failed to load bookings:', error.message);
  }
}

export function saveBookings() {
  try {
    writeFileSync(BOOKINGS_PATH, JSON.stringify(Object.fromEntries(deviceBookings), null, 2));
  } catch (error) {
    console.error('❌ Failed to save bookings:', error.message);
  }
}
