// services/switchPosition.js — положение аппаратного переключателя режима
// (устройства с hwType, utils/deviceFlags.isApSwitchOn).
//
// hwType значит только «есть переключатель». Положение: A — Router,
// B — Access point (extender). В A устройство работает роутером, к роутеру
// по MWS его не подключить — сначала переключатель в B (устройство
// перезагрузится extender'ом). Программно положение не меняется.
//
// Узнаём его у самого устройства: /rci/show/system/mode → active
// ('router' → A, иначе B). Запрос с авторизацией, поэтому постоянно не
// опрашиваем (лок после неверных паролей): положение запоминается при каждом
// определении режима (device:getCurrentMode, проверка перед MWS Connect,
// успешный MWS Connect) и рассылается всем событием device:switchPosition
// { deviceId, position, at }; в device:list — поле switchPosition.
import { getDeviceById } from '../devices.js';
import { isApSwitchOn } from '../utils/deviceFlags.js';
import { switchPositions } from '../state/switchPositions.js';
import { checkDeviceMode } from '../actions/changeModeType.js';
import { getPasswordCandidates, tryWithPasswords, isAuthError, isAuthCoolingDown } from './passwordService.js';
import { getDeviceUrl } from './statusService.js';

export const SWITCH_A_MESSAGE =
  'The hardware mode switch is in position A (Router) — the device works as a router and cannot be ' +
  'connected to another router. Move the switch to position B (Access point), wait until the device ' +
  'reboots, then use MWS Connect.';

export const getSwitchPosition = (deviceId) => switchPositions.get(String(deviceId))?.position || null;

// activeMode — active из /rci/show/system/mode (или mode из checkDeviceMode)
export function recordSwitchPosition(io, deviceId, activeMode) {
  const device = getDeviceById(deviceId);
  if (!device || !isApSwitchOn(device) || !activeMode) return null;
  const position = activeMode === 'router' ? 'router' : 'ap';
  const id = String(deviceId);
  if (switchPositions.get(id)?.position !== position) {
    const entry = { position, at: Date.now() };
    switchPositions.set(id, entry);
    console.log(`🔀 ${device.hwId}: hardware switch in position ${position === 'router' ? 'A (Router)' : 'B (AP)'}`);
    io?.emit('device:switchPosition', { deviceId: id, ...entry });
  }
  return position;
}

// Спросить устройство. null — не удалось (недоступно, пароль, cooldown).
// clientIp / explicitPassword — как у device:getCurrentMode (цепочка паролей).
export async function detectSwitchPosition(io, deviceId, { clientIp = null, explicitPassword = null } = {}) {
  const device = getDeviceById(deviceId);
  if (!device || !isApSwitchOn(device) || isAuthCoolingDown(deviceId)) return null;
  const explicit = explicitPassword ? { [deviceId]: explicitPassword } : {};
  const candidates = getPasswordCandidates(deviceId, clientIp, explicit);
  if (!candidates.length) return null;
  try {
    const url = getDeviceUrl(deviceId, 'auth');
    const { result } = await tryWithPasswords(candidates, async (candidate) => {
      const res = await checkDeviceMode(url, 'admin', candidate);
      if (!res.success && isAuthError(res)) throw new Error(res.message || 'authentication failed');
      return res;
    });
    if (!result?.success) return null;
    return recordSwitchPosition(io, deviceId, result.baseMode || result.mode);
  } catch (err) {
    console.warn(`🔀 ${device.hwId}: cannot detect switch position: ${err.message}`);
    return null;
  }
}
