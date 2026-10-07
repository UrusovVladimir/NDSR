// services/wanService.js — WAN устройств.
//   getWanTypesSnapshot — текущие WAN-типы всех устройств. Источник —
//     state/wan.js, fallback — device.currentWanType из devices.json (заодно
//     прогревает state). Используется в sendInitData и device:getAllWanTypes.
//   applyWanChange — смена WAN на коммутаторах + сохранение и рассылка
//     фактического состояния (в т.ч. когда один из двух свичей недоступен).
import { devices, getDeviceById, saveConfig } from '../devices.js';
import { currentWanTypes } from '../state/wan.js';
import { changeWanType } from '../actions/changeWanType.js';

const WAN_OFF = '4094';
const universalPromptRegex = /.*/i;

const isDual = (wan) => !!(wan && typeof wan === 'object' && wan.type === 'dual_wan');

// WAN-состояние → [VLAN основного порта, VLAN второго порта]
function splitWan(wan) {
    if (isDual(wan)) return [String(wan.wan1 ?? WAN_OFF), String(wan.wan2 ?? WAN_OFF)];
    return [wan == null || wan === '' ? WAN_OFF : String(wan), WAN_OFF];
}

// Обратно: второй порт выключен (или его нет) — обычный WAN строкой
function joinWan(primary, secondary, hasSecondary) {
    if (!hasSecondary || secondary === WAN_OFF) return primary;
    return { type: 'dual_wan', wan1: primary, wan2: secondary };
}

function saveWanState(io, deviceId, type) {
    const device = getDeviceById(deviceId);
    if (device) {
        device.currentWanType = type;
        saveConfig(process.env.DEVICES_CONFIG_PATH, devices);
    }
    currentWanTypes[deviceId] = { type, isDualWan: isDual(type), updatedAt: Date.now() };
    io?.emit('device:wanTypeUpdated', { deviceId, type });
}

// Меняет WAN и сохраняет то, что реально стоит на портах.
//   { status: 'ok', type, results } — всё применено;
//   { status: 'partial', type, results, message } — часть портов применена,
//     сохранено фактическое состояние (неприменённый порт — прежнее значение);
//   throw — ничего не применено (состояние не меняется) или ошибка конфигурации.
// wanData: VLAN строкой, '4094'/null — выключить, { type: 'dual_wan', wan1, wan2 }.
export async function applyWanChange(io, deviceId, wanData) {
    const device = getDeviceById(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);
    const target = wanData == null || wanData === '' ? WAN_OFF : wanData;
    const previous = currentWanTypes[deviceId]?.type ?? device.currentWanType ?? WAN_OFF;

    let results;
    try {
        results = await changeWanType(deviceId, target, universalPromptRegex);
    } catch (error) {
        const applied = error.results?.filter(r => r.ok) || [];
        if (!applied.length) throw error;

        const okRole = (role) => error.results.some(r => r.role === role && r.ok);
        const [targetPrimary, targetSecondary] = splitWan(target);
        const [prevPrimary, prevSecondary] = splitWan(previous);
        const type = joinWan(
            okRole('wan1') ? targetPrimary : prevPrimary,
            okRole('wan2') ? targetSecondary : prevSecondary,
            !!device.switchPortWanSecondary
        );
        saveWanState(io, deviceId, type);
        console.warn(`⚠️ WAN ${deviceId} applied partially, saved state:`, type);
        return { status: 'partial', type, results: error.results, message: `Partially applied: ${error.message}` };
    }

    saveWanState(io, deviceId, target);
    return { status: 'ok', type: target, results };
}

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
