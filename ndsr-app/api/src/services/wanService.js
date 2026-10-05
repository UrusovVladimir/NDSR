// services/wanService.js — сборка текущих WAN-типов всех устройств.
// Источник — state/wan.js, fallback — device.currentWanType из devices.json
// (заодно прогревает state). Используется в sendInitData и device:getAllWanTypes.
import { devices } from '../devices.js';
import { currentWanTypes } from '../state/wan.js';

export function getWanTypesSnapshot() {
  const types = {};
  devices.forEach(device => {
    if (currentWanTypes[device.id]?.type) {
      types[device.id] = currentWanTypes[device.id].type;
    } else if (device.currentWanType) {
      types[device.id] = device.currentWanType;
      currentWanTypes[device.id] = {
        type: device.currentWanType,
        isDualWan: typeof device.currentWanType === 'object' &&
                   device.currentWanType.type === 'dual_wan'
      };
    }
  });
  return types;
}
