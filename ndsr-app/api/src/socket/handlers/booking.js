// socket/handlers/booking.js — бронирование устройств:
// device:book, device:extend, device:get-booking-status,
// device:release, device:releaseMultiple.
//
// Владелец брони — IP клиента (socket.clientIp). Пароль брони намеренно
// виден всем пользователям портала: следующий взявший устройство должен
// зайти на него без factory reset.
import { on } from '../wrap.js';
import { detachVmsForDevice } from '../../services/vmService.js';
import { getDeviceById, getDevicePassword } from '../../devices.js';
import { deviceBookings, saveBookings } from '../../state/bookings.js';
import { devicePowerStatus } from '../../state/power.js';
import { buildBookingPayload, emitBookingUpdate } from '../../services/bookingService.js';
import { getPortPowerStatus } from '../../actions/getPortPowerStatus.js';

const nowSec = () => Math.floor(Date.now() / 1000);

// Длительность приходит в секундах; без проверки отрицательное или
// строковое значение давало истёкшую бронь или конкатенацию строк
function isValidDuration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function emitPowerStatus(io, deviceId, status, changed) {
  io.emit('device:powerStatus', {
    deviceId,
    status,
    timestamp: Date.now(),
    changed
  });
}

export function register(socket, io) {
  on(socket, 'device:book', (data, callback) => {
    const { deviceId, duration } = data || {};
    const bookedBy = socket.clientIp;

    if (!deviceId || !isValidDuration(duration)) {
      return callback({ success: false, message: 'Device ID and positive duration (seconds) are required', error: 'Device ID and positive duration (seconds) are required' });
    }

    const existingBooking = deviceBookings.get(deviceId);
    if (existingBooking && existingBooking.bookedBy !== bookedBy) {
      return callback({ success: false, message: 'Device is already booked by another user' });
    }

    const expiresAt = nowSec() + duration;

    // 🔑 Пароль брони: из конфига, если известен. После reset пароля нет —
    // бронь создаётся БЕЗ пароля (passwordInvalidated), вместо лжи про daily
    const knownPassword = getDevicePassword(deviceId);

    deviceBookings.set(deviceId, {
      bookedBy,
      expiresAt,
      accessPassword: knownPassword || null,
      passwordInvalidated: !knownPassword
    });
    saveBookings();

    const cachedPowerStatus = devicePowerStatus.get(deviceId);
    const powerStatus = cachedPowerStatus && cachedPowerStatus !== 'unknown'
      ? cachedPowerStatus
      : 'unknown';

    // Ответ бронирующему — согласован с broadcast через хелпер
    const payload = buildBookingPayload(deviceId);

    callback({
      success: true,
      expiresAt,
      accessPassword: payload.accessPassword,
      passwordInvalidated: payload.passwordInvalidated,
      powerStatus
    });

    emitBookingUpdate(deviceId);
    emitPowerStatus(io, deviceId, powerStatus, false);

    // Если статуса нет — получаем в фоне
    if (powerStatus === 'unknown') {
      getPortPowerStatus(deviceId)
        .then(result => {
          const status = result.power || result;
          devicePowerStatus.set(deviceId, status);
          emitPowerStatus(io, deviceId, status, true);
        })
        .catch(error => {
          console.error(`[BOOK] Background power status failed:`, error.message);
        });
    }
  });

  on(socket, 'device:extend', (data, callback) => {
    const { deviceId, additionalDuration } = data || {};

    if (!deviceId || !isValidDuration(additionalDuration)) {
      return callback({ success: false, message: 'Device ID and positive additional duration (seconds) are required', error: 'Device ID and positive additional duration (seconds) are required' });
    }

    const currentBooking = deviceBookings.get(deviceId);
    if (!currentBooking) {
      return callback({ success: false, message: 'No active booking found' });
    }
    if (currentBooking.bookedBy !== socket.clientIp) {
      return callback({ success: false, message: 'Not your booking' });
    }

    const expiresAt = currentBooking.expiresAt + additionalDuration;
    deviceBookings.set(deviceId, { ...currentBooking, expiresAt });
    saveBookings();

    callback({
      success: true,
      expiresAt,
      accessPassword: currentBooking.accessPassword
    });

    emitBookingUpdate(deviceId);
  });

  on(socket, 'device:get-booking-status', (deviceId, callback) => {
    callback(buildBookingPayload(deviceId));
  });

  // Принимает и deviceId, и { deviceId } — фронт шлёт оба варианта
  on(socket, 'device:release', (data, callback) => {
    const deviceId = data && typeof data === 'object' ? data.deviceId : data;
    const currentBooking = deviceBookings.get(deviceId);

    if (!currentBooking) {
      return callback({ success: false, message: 'No active booking found for this device' });
    }
    if (currentBooking.bookedBy !== socket.clientIp) {
      return callback({ success: false, message: 'Not your booking' });
    }

    deviceBookings.delete(deviceId);
    saveBookings();
    // Тестовые VM живут, пока жива бронь устройства
    detachVmsForDevice(deviceId, 'released');

    callback({ success: true });

    emitBookingUpdate(deviceId);
    socket.emit('device:released', { deviceId });
  });

  on(socket, 'device:releaseMultiple', (data, callback) => {
    const deviceIds = data?.deviceIds;
    if (!Array.isArray(deviceIds)) {
      return callback({ success: false, message: 'Batch release operation failed', error: 'deviceIds array is required' });
    }

    const userId = socket.clientIp;
    console.log(`🔄 Batch release requested by user ${userId} for ${deviceIds.length} devices`);

    const successful = [];
    const failed = [];

    for (const deviceId of deviceIds) {
      if (!getDeviceById(deviceId)) {
        failed.push({ deviceId, error: 'Device not found' });
        continue;
      }
      const booking = deviceBookings.get(deviceId);
      if (!booking || booking.bookedBy !== userId) {
        failed.push({ deviceId, error: 'Not authorized or device not booked by user' });
        continue;
      }
      deviceBookings.delete(deviceId);
      detachVmsForDevice(deviceId, 'released');
      successful.push(deviceId);
    }

    console.log(`✅ Batch release completed: ${successful.length} successful, ${failed.length} failed`);

    if (successful.length > 0) {
      saveBookings();

      // Раньше слался только batch-event: клиенты, которые слушают лишь
      // device:bookingUpdated, видели устройство занятым до F5
      for (const deviceId of successful) emitBookingUpdate(deviceId);

      io.emit('device:batchBookingUpdated', {
        action: 'release',
        userId,
        successful,
        failed,
        timestamp: new Date().toISOString()
      });
    }

    callback({
      success: true,
      released: successful.length,
      failed: failed.length,
      details: { successful, failed }
    });
  });
}
