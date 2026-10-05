// services/linkService.js — отключение экстендера от роутера без сокета.
// Общий код device:mwsConnected (disconnect) и ночного сброса (nightlyReset).
import { getDeviceById } from '../devices.js';
import { isApSwitchOn } from '../utils/deviceFlags.js';
import MWSConnectionManager from '../actions/mwsConnectionManager.js';
import { connectToMws } from '../actions/connectToMws.js';
import { makeAuthenticatedRequest } from '../actions/athentication.js';
import { disconnectAndChangeToRouter } from '../actions/changeModeType.js';
import { DisconnectManager } from '../utils/disconnectManager.js';
import { currentModes } from '../state/modes.js';
import { getPasswordCandidates, tryWithPasswords } from './passwordService.js';
import { getDeviceUrl, waitForOnline } from './statusService.js';

const universalPromptRegex = /.*/i;

// Аппаратный AP-переключатель после ребута вернёт устройство в extender
function modeAfterDisconnect(device) {
  return isApSwitchOn(device) ? 'extender' : 'router';
}

// AP-устройство, коммутатор уже переключён (connectToMws disconnect):
// снимаем пробросы, ребутим, ставим режим. Ошибка пробросов не прерывает —
// линк снят физически, запись в mwsLinks остаётся, повторный disconnect
// дочистит правила. Возвращает { portForwardError, mode }.
async function finishApDisconnect(deviceId, routerId, progress = () => {}) {
  const device = getDeviceById(deviceId);
  let portForwardError = null;

  console.log(`🔧 Removing port forwarding for device ${deviceId}`);
  progress(50, 'port_forwarding');
  try {
    await MWSConnectionManager.removeMWSConnection(deviceId, routerId);
  } catch (removeError) {
    portForwardError = removeError;
    console.error('❌ Port forwarding removal error:', removeError);
  }
  progress(70, 'port_forwarding');

  // Ребут (power-cycle) уже сделал connectToMws при disconnect — здесь только
  // ждём загрузки. Раньше тут был второй rebootDevice({...device}) с объектом
  // вместо id: он всегда падал в catch и ничего не делал.
  progress(75, 'device_reboot');
  console.log(`⏳ Waiting for device ${deviceId} to come back after reboot...`);
  const deviceOnline = await waitForOnline(deviceId, {
    attempts: 12,
    intervalMs: 5000,
    delayFirst: true
  });
  if (deviceOnline) {
    console.log(`✅ Device ${deviceId} is back online after reboot`);
  } else {
    console.warn(`⚠️ Device ${deviceId} did not come back online within timeout`);
  }
  progress(90, 'device_reboot');

  const mode = modeAfterDisconnect(device);
  currentModes.set(deviceId, { mode, routerId: null, timestamp: Date.now() });

  console.log(`🔗 Successfully disconnected device ${deviceId} from router`);
  return { portForwardError, mode };
}

// Активная MWS-связка экстендера ({ routerId }) или null
function getActiveLink(extenderId) {
  const info = currentModes.get(extenderId);
  return info?.mode === 'extender_connect' && info.routerId ? { routerId: info.routerId } : null;
}

// Откат того, что создаёт подключение, без участия самого экстендера:
// коммутатор (PVID порта → vlanLocal экстендера, порт forbidden во VLAN
// роутера) и DNAT на хосте и в контейнере роутера (+ запись mwsLinks).
// Режим устройства не трогает — годится, когда следом идёт сброс.
async function releaseLinkInfrastructure(deviceId, routerId) {
  await DisconnectManager.reconfigureSwitchWithLocalVlan(deviceId, routerId);
  await DisconnectManager.removeIptablesRulesOnly(deviceId, routerId);
}

// Фоновое отключение (без пользователя): AP — как device:mwsConnected
// disconnect, остальные — как device:changeMode extender_disconnect.
// Снимается всё, что создаёт подключение: VLAN на коммутаторе (PVID порта
// экстендера → его vlanLocal, порт forbidden во VLAN роутера), DNAT на хосте
// и в контейнере роутера, запись mwsLinks, extender_connect в currentModes.
// resetFollows: следом идёт сброс конфигурации — тогда при сбое шага на
// экстендере всё равно откатываем коммутатор и NAT (режим вернёт сброс).
// Бросает ошибку, если коммутатор или NAT не откатаны.
async function disconnectExtenderInBackground(io, deviceId, routerId, { resetFollows = false } = {}) {
  const device = getDeviceById(deviceId);
  if (!device) throw new Error(`Device ${deviceId} not found`);

  let mode;
  if (isApSwitchOn(device)) {
    // disconnect пароль роутера не использует (снятие VLAN и пробросов)
    await connectToMws({ deviceId, routerId, action: 'disconnect', routerPassword: null }, universalPromptRegex);
    const result = await finishApDisconnect(deviceId, routerId);
    mode = result.mode;
    // Коммутатор уже переключён — повторяем снятие DNAT другим путём
    // (removePortForwarding); не вышло — ошибка, запись mwsLinks остаётся
    if (result.portForwardError) {
      console.warn(`⚠️ ${deviceId}: port forwarding cleanup failed (${result.portForwardError.message}) — retrying`);
      await DisconnectManager.removeIptablesRulesOnly(deviceId, routerId);
    }
  } else {
    // Шаг на самом экстендере (смена режима) может не пройти: устройство
    // недоступно, пароль не подошёл, или fullDisconnect оборвался таймаутом
    // ДО свитча и NAT (тогда disconnectAndChangeToRouter отдаёт success
    // с warning). Свитч и NAT всё равно откатываем — режим вернёт сброс.
    let deviceStepError = null;
    try {
      // Пароль подбираем фоново (конфиг → daily), проверяем до изменений
      const candidates = getPasswordCandidates(deviceId, null, {}, 'background');
      const authUrl = getDeviceUrl(deviceId, 'auth');
      const probe = await tryWithPasswords(candidates, async (candidate) => {
        await makeAuthenticatedRequest(authUrl, 'admin', candidate, '/rci/show/system/mode', 'GET');
        return true;
      });
      if (!probe.result) {
        throw new Error('Authentication failed for all password candidates');
      }

      const targetUrl = device.checkDeviceMode || device.checkUrl || device.URL;
      const result = await disconnectAndChangeToRouter(deviceId, routerId, probe.password, null, io, 'router', targetUrl);
      if (!result.success) throw new Error(result.message);
      if (result.warning) throw new Error(result.warning);
    } catch (err) {
      deviceStepError = err;
    }

    if (deviceStepError) {
      if (!resetFollows) throw deviceStepError;
      console.warn(`⚠️ ${deviceId}: device-side disconnect failed (${deviceStepError.message}) — reverting switch and NAT anyway`);
      await releaseLinkInfrastructure(deviceId, routerId);
    }

    mode = modeAfterDisconnect(device);
    currentModes.set(deviceId, { mode, routerId: null, timestamp: Date.now() });
  }

  io?.emit('device:modeUpdated', {
    deviceId,
    mode,
    routerId: null,
    timestamp: Date.now(),
    source: 'nightly_reset'
  });
  io?.emit('device:mwsStatusUpdated', {
    deviceId,
    routerId,
    status: 'disconnected',
    timestamp: Date.now()
  });
  return mode;
}

export { getActiveLink, releaseLinkInfrastructure, finishApDisconnect, disconnectExtenderInBackground };
