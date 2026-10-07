// socket/handlers/wan.js — тип WAN: device:getAllWanTypes, device:wanTypes:save.
import { on } from '../wrap.js';
import { getDeviceById, wanTypes } from '../../devices.js';
import { getWanTypesSnapshot, applyWanChange } from '../../services/wanService.js';
import { requireBooking, requireNotRival } from '../../services/bookingService.js';

export function register(socket, io) {
  on(socket, 'device:getAllWanTypes', (callback) => {
    try {
      console.log('📡 Запрос всех WAN типов');
      
      const types = getWanTypesSnapshot();
      
      console.log(`✅ Отправлено ${Object.keys(types).length} WAN типов`);
      
      callback({ success: true, types });
    } catch (error) {
      console.error('❌ Error getting all WAN types:', error);
      callback({ success: false, error: error.message });
    }
  });

  on(socket, 'device:wanTypes:save', async (deviceId, wanData, callback) => {
      try {
          console.log(`📡 Получен запрос на настройку WAN для устройства ${deviceId}:`, wanData);

          // 🔒 S7: смена WAN перенастраивает свитч — только владелец брони
          requireBooking(socket, deviceId);
          requireNotRival(deviceId);
          
          // Проверяем, является ли это Dual WAN
          const isDualWan = wanData && typeof wanData === 'object' && wanData.type === 'dual_wan'
          
          if (isDualWan) {
              // Проверяем наличие switchPortWanSecondary
              const device = getDeviceById(deviceId);
              if (!device.switchPortWanSecondary) {
                  return callback({ 
                      status: 'error', 
                      message: 'Device does not support Dual WAN (no secondary WAN port)' 
                  });
              }
              
              // Проверяем, что WAN1 и WAN2 разные
              if (wanData.wan1 === wanData.wan2) {
                  return callback({ 
                      status: 'error', 
                      message: 'WAN 1 and WAN 2 must be different' 
                  });
              }
              
              // Проверяем, что оба VLAN существуют
              const wanTypesList = wanTypes;
              const wan1Exists = wanTypesList.some(w => String(w.vlanId) === String(wanData.wan1));
              const wan2Exists = wanTypesList.some(w => String(w.vlanId) === String(wanData.wan2));
              
              if (!wan1Exists || !wan2Exists) {
                  return callback({ 
                      status: 'error', 
                      message: 'One or both WAN types are invalid' 
                  });
              }
          }
          
          // Настройка на коммутаторах + сохранение фактического состояния
          // (при недоступном втором свиче — status 'partial' и что применилось)
          const result = await applyWanChange(io, deviceId, wanData);

          if (result.status === 'partial') {
              return callback({ status: 'partial', type: result.type, results: result.results, message: result.message });
          }
          console.log(`✅ WAN тип сохранен для устройства ${deviceId}:`, wanData);

          callback({ 
              status: 'ok', 
              type: result.type,
              message: isDualWan ? 'Dual WAN configured successfully' : 'WAN type updated successfully' 
          });
          
      } catch (error) {
          console.error('❌ Ошибка настройки WAN:', error);
          callback({ 
              status: 'error', 
              message: error.message || 'Failed to configure WAN' 
          });
      }
  }, { errorShape: 'status' });
}
