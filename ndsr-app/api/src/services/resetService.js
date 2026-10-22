// services/resetService.js — заводской сброс устройства: общий для
// device:resetConfig и ночного сброса (nightlyReset).
import { getDeviceById } from '../devices.js';
import { resetConfig } from '../actions/resetConfig.js';
import { applyWanChange } from './wanService.js';
import { currentModes } from '../state/modes.js';
import { clearDevicePassword } from './bookingService.js';
import { clearFirmwareCache } from './statusService.js';
import { getActiveLink, releaseLinkInfrastructure } from './linkService.js';
import { getMwsLink } from '../state/mwsLinks.js';
import { isRival } from '../utils/deviceFlags.js';

const WAN_OFF = '4094';

// WAN выключается на коммутаторе (оба порта у Dual WAN) — 4094 фронт
// показывает как «Not configured». Один из свичей недоступен — сохраняется
// фактическое состояние, а сбой уходит в wanError.
async function turnOffWan(io, deviceId) {
  const result = await applyWanChange(io, deviceId, WAN_OFF);
  if (result.status === 'partial') throw new Error(result.message);
}

// Порядок: MWS-связка → WAN → сброс → чистка состояния.
// Экстендер, подключённый к роутеру, сначала отвязывается: коммутатор
// и NAT возвращаются в исходное состояние; не вышло — сброс не начинается
// (иначе VLAN и пробросы остались бы висеть без записи в currentModes).
// Права на роутер проверяет вызывающий (requireLinkAccess / пропуск броней).
// Сбой выключения WAN сброс не отменяет — возвращается в wanError.
// revertRouterId — «Restore switch & reset»: роутер, к которому устройство
// подключали, указал пользователь (связка могла не записаться вовсе) — свич
// и NAT откатываются к нему, даже если портал о связке не знает.
async function factoryResetDevice(io, deviceId, { revertRouterId = null } = {}) {
  // Устройства конкурентов не сбрасываем никогда (ни вручную, ни ночью)
  if (isRival(getDeviceById(deviceId))) {
    throw new Error('Not available for rival devices.');
  }

  const known = getActiveLink(deviceId)?.routerId || getMwsLink(deviceId)?.routerId || null;
  if (revertRouterId && String(revertRouterId) !== String(known)) {
    console.log(`🔗 ${deviceId}: restoring switch and NAT for router ${revertRouterId} (chosen by user) before reset`);
    await releaseLinkInfrastructure(deviceId, String(revertRouterId));
  }

  // Связка из currentModes; нет — незавершённое подключение (mwsLinks есть,
  // а режим не записан: подключение упало после переключения свича)
  const pending = getActiveLink(deviceId) ? null : getMwsLink(deviceId);
  if (pending?.routerId) {
    console.log(`🔗 ${deviceId}: unfinished link to ${pending.routerId} — reverting switch and NAT before reset`);
    await releaseLinkInfrastructure(deviceId, pending.routerId);
  }

  const link = getActiveLink(deviceId);
  if (link) {
    console.log(`🔗 ${deviceId} is linked to router ${link.routerId} — reverting switch and NAT before reset`);
    await releaseLinkInfrastructure(deviceId, link.routerId);
    // Связки больше нет, даже если сброс ниже упадёт
    currentModes.delete(deviceId);
    io?.emit('device:mwsStatusUpdated', {
      deviceId,
      routerId: link.routerId,
      status: 'disconnected',
      timestamp: Date.now()
    });
  }

  let wanError = null;
  try {
    await turnOffWan(io, deviceId);
    console.log(`🔌 WAN turned off for ${deviceId} before reset`);
  } catch (err) {
    wanError = err;
    console.error(`❌ Failed to turn off WAN for ${deviceId}: ${err.message} — resetting anyway`);
  }

  await resetConfig(deviceId);

  // Пароль после заводского сброса неактуален — чистим из конфига
  clearDevicePassword(deviceId, 'factory reset');

  // Режим тоже откатывается к заводскому (router) — снимаем stale-состояние,
  // иначе портал будет считать устройство подключённым к роутеру-экстендеру
  currentModes.delete(deviceId);
  console.log(`🧹 currentModes cleared for ${deviceId} after factory reset`);

  // После сброса может откатиться и прошивка — кэш версии невалиден
  clearFirmwareCache(deviceId);

  return { wanError };
}

export { factoryResetDevice };
