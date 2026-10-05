// services/bookingService.js — payload/эмит броней, проверка владельца,
// авто-освобождение и инвалидация пароля устройства (трогает бронь).
import { devices, getDeviceById, saveConfig } from '../devices.js';
import { isRival } from '../utils/deviceFlags.js';
import { deviceBookings, saveBookings } from '../state/bookings.js';
import { getIO } from '../state/io.js';
import { getEffectiveDevicePassword, emitPasswordUpdate } from './passwordService.js';

// 🔑 Единая сборка booking-payload для фронта. Раньше payload собирался
// в 8+ местах вручную — и расползался (live-emit с daily против честной
// брони в Map). Теперь один источник правды.
function buildBookingPayload(deviceId) {
  const booking = deviceBookings.get(deviceId);
  if (!booking) {
    return {
      isBooked: false,
      bookedBy: null,
      accessPassword: null,
      passwordInvalidated: false,
      expiresAt: null,
      remainingTime: 0
    };
  }
  return {
    isBooked: true,
    bookedBy: booking.bookedBy,
    // При invalidated пароль НЕ отдаём — UI показывает честное «Unknown»
        // 🔑 MWS-PW: подключённый экстендер отдаёт эффективный (роутерский) пароль.
    // passwordInvalidated по-прежнему -> null (контракт 8). Вычисление в момент
    // чтения — никакого stale-состояния в брони.
    accessPassword: booking.passwordInvalidated
      ? null
      : (getEffectiveDevicePassword(deviceId) ?? booking.accessPassword),
    passwordInvalidated: !!booking.passwordInvalidated,
    expiresAt: booking.expiresAt,
    remainingTime: Math.max(0, booking.expiresAt - Math.floor(Date.now() / 1000))
  };
}

function emitBookingUpdate(deviceId) {
  getIO()?.emit('device:bookingUpdated', {
  deviceId,
  booking: buildBookingPayload(deviceId)
 });
}

// 🔒 S7: единая проверка «устройство забронировано именно этим пользователем»
function requireBooking(socket, deviceId) {
    const booking = deviceBookings.get(deviceId);
    if (!booking) {
        throw new Error('Device is not booked. Book it before performing this operation.');
    }
    if (booking.bookedBy !== socket.clientIp) {
        throw new Error('Device is booked by another user.');
    }
    return booking;
}

// Устройство конкурента: операции запрещены (см. utils/deviceFlags.isRival)
function requireNotRival(deviceId) {
    if (isRival(getDeviceById(deviceId))) {
        throw new Error('Not available for rival devices.');
    }
}

// 🔒 S7: связка экстендер ↔ роутер (MWS). Экстендер — всегда бронь владельцем.
// connect: роутер тоже в своей брони. disconnect: роутер может быть уже
// свободен (бронь истекла — иначе экстендер не отключить), но не в чужой
// брони — отключение снимает пробросы на роутере.
function requireLinkAccess(socket, extenderId, routerId, { disconnect = false } = {}) {
    requireBooking(socket, extenderId);
    requireNotRival(extenderId);
    if (!routerId) return;
    requireNotRival(routerId);
    if (!disconnect) {
        requireBooking(socket, routerId);
        return;
    }
    const routerBooking = deviceBookings.get(routerId);
    if (routerBooking && routerBooking.bookedBy !== socket.clientIp) {
        throw new Error('Router is booked by another user.');
    }
}

function clearDevicePassword(deviceId, reason = '') {
  const device = getDeviceById(deviceId);
  if (!device) return;

  // 1️⃣ Чистим конфиг, ЕСЛИ пароль там есть (мог быть удалён ранее)
  if ('devicePassword' in device) {
    delete device.devicePassword;
    saveConfig(process.env.DEVICES_CONFIG_PATH, devices);
    console.log(`🧹 devicePassword cleared for device ${deviceId}${reason ? ` (${reason})` : ''}`);
  }

      // 2️⃣ Бронь СОХРАНЯЕМ, пароль в ней инвалидируем (хелпер шлёт
    // согласованный payload + событие обновления пароля фронтенду)
    if (deviceBookings.has(deviceId)) {
      const booking = deviceBookings.get(deviceId);
      booking.accessPassword = null;
      booking.passwordInvalidated = true;
      saveBookings();
      console.log(`🔑 Booking password invalidated for ${deviceId} (kept booking)`);
      emitBookingUpdate(deviceId);
    }

    // 3️⃣ Фронт обязан узнать, что devicePassword больше нет — без F5
    emitPasswordUpdate(deviceId, null);
}

function autoReleaseOldBookings(io) {
  if (!io) return;

  const now = Math.floor(Date.now() / 1000);
  let released = 0;

  for (const [deviceId, booking] of deviceBookings.entries()) {
    if (booking.expiresAt <= now) {
      deviceBookings.delete(deviceId);
      released++;
      
      emitBookingUpdate(deviceId);
    }
  }

  // файл пишем один раз за проход, только если что-то изменилось
  if (released > 0) {
    saveBookings();
  }
}

export {
  buildBookingPayload,
  emitBookingUpdate,
  requireBooking,
  requireLinkAccess,
  requireNotRival,
  clearDevicePassword,
  autoReleaseOldBookings
};
