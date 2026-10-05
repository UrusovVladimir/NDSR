// socket/handlers/passwords.js — пароль устройства:
// device:getPassword, device:setPassword, device:clearPassword.
//
// Все три события требуют активной брони владельцем (S2). Пароль брони
// при этом виден всем через device:bookingUpdated — это by design.
import { on } from '../wrap.js';
import { getDevicePassword, setDevicePassword } from '../../devices.js';
import { deviceBookings, saveBookings } from '../../state/bookings.js';
import { currentModes } from '../../state/modes.js';
import { emitBookingUpdate, requireBooking, requireNotRival, clearDevicePassword } from '../../services/bookingService.js';
import { emitPasswordUpdate } from '../../services/passwordService.js';

export function register(socket) {
  on(socket, 'device:getPassword', (deviceId, callback) => {
      try {
          requireBooking(socket, deviceId);
          requireNotRival(deviceId);
          const password = getDevicePassword(deviceId);
          callback({ success: true, password });
      }
      catch(error) {
          callback({ success: false, error: error.message })
      }
  });

  on(socket, 'device:setPassword', (data, callback)=>{
    try{
      const {deviceId, password} = data;

      if (!deviceId || typeof password !== 'string' || password.length < 4) {
          return callback({ success: false, error: 'deviceId and password (min 4 chars) required' });
      }

      // 🔒 S2: менять пароль может только владелец брони
      requireBooking(socket, deviceId);
      requireNotRival(deviceId);

      const result = setDevicePassword(deviceId, password);
      
      if (result?.success !== false) {
        const booking = deviceBookings.get(deviceId);
        if (booking) {
          booking.accessPassword = password;
          booking.passwordInvalidated = false;
          saveBookings();
          console.log(`🔑 Booking accessPassword synced for ${deviceId}`);
        }
        // Фронт обновляет device.devicePassword немедленно, без F5
        emitPasswordUpdate(deviceId, password);
        // 🔑 MWS-PW: пароль мастера сменился → эффективные пароли всех
        // подключённых к нему слейвов изменились. Брони слейвов перечитают
        // payload через buildBookingPayload при следующем emitBookingUpdate.
        for (const [extId, mi] of currentModes) {
          if (mi.mode === 'extender_connect' && mi.routerId === deviceId) {
            emitBookingUpdate(extId);
            console.log(`🔑 MWS-PW: extender ${extId} follows router ${deviceId} password change`);
          }
        }
      }
      
      callback(result); 
    }
    catch(error){
      callback({ success: false, error: error.message })
    }
  })

  on(socket, 'device:clearPassword', (deviceId, callback) => {
    try {
      requireBooking(socket, deviceId);
      requireNotRival(deviceId);
      clearDevicePassword(deviceId, 'manual');
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });
}
