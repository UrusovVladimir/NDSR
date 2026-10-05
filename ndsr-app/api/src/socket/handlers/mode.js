// socket/handlers/mode.js — режимы и MWS: device:changeMode, device:getCurrentMode,
// device:disconnectExtender, device:getModeInfo, device:getMwsConnection, device:mwsConnected.
import { on } from '../wrap.js';
import { getDeviceById, getParamRouter, getDevicePassword } from '../../devices.js';
import { isApSwitchOn } from '../../utils/deviceFlags.js';
import MWSConnectionManager from '../../actions/mwsConnectionManager.js';
import { changeWanType } from '../../actions/changeWanType.js';
import { connectToMws } from '../../actions/connectToMws.js';
import { makeAuthenticatedRequest } from '../../actions/athentication.js';
import {
  changeSystemMode,
  checkDeviceMode,
  disconnectAndChangeToRouter
} from '../../actions/changeModeType.js';
import { DisconnectManager } from '../../utils/disconnectManager.js';
import { currentModes } from '../../state/modes.js';
import { deviceBookings } from '../../state/bookings.js';
import { dailyPasswords } from '../../state/passwords.js';
import { deviceStatusCache } from '../../state/statusCache.js';
import {
  isAuthCoolingDown,
  setAuthCooldown,
  clearAuthCooldown,
  getPasswordCandidates,
  isAuthError,
  tryWithPasswords,
  resolveRouterPassword
} from '../../services/passwordService.js';
import {
  getDeviceUrl,
  getDeviceStatusWithMode,
  checkAndUpdateDeviceStatusImmediately,
  waitForOnline
} from '../../services/statusService.js';
import { sendMwsProgress, sendModeChangeProgress } from '../../services/progress.js';
import { requireLinkAccess } from '../../services/bookingService.js';
import { finishApDisconnect } from '../../services/linkService.js';

const universalPromptRegex = /.*/i;

export function register(socket, io) {
  on(socket, 'device:getMwsConnection', (deviceId, callback) => {
    try {
      console.log('🔗 Requested MWS connection for device:', deviceId);
      
      const modeInfo = currentModes.get(deviceId);
      
      if (modeInfo && modeInfo.mode === 'extender_connect' && modeInfo.routerId) {
        const router = getDeviceById(modeInfo.routerId);
        const connection = {
          routerId: modeInfo.routerId,
          routerName: router ? `${router.hwId} ${router.shortName}` : `Router ${modeInfo.routerId}`,
          status: 'connected',
          connectedSince: modeInfo.timestamp || Date.now(),
          signalStrength: 85
        };
        
        console.log('🔗 Found MWS connection:', connection);
        callback({ 
          success: true, 
          connection: connection 
        });
      } else {
        console.log('🔗 No MWS connection found for device:', deviceId);
        callback({ 
          success: true, 
          connection: null 
        });
      }
    } catch (error) {
      console.error('❌ Error getting MWS connection:', error);
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });

  on(socket, 'device:mwsConnected', async (data, callback) => {
  let deviceId; // ✅ Объявляем переменную ДО try
  
  try {
    deviceId = data.deviceId; // ✅ Присваиваем значение
    const { routerId, action, routerPassword } = data;
    
    console.log('🔗 MWS Connection request received:', { 
        deviceId, 
        routerId, 
        action,
        manualRouterPassword: !!routerPassword
    });
    
    if (!deviceId || !routerId) {
        const errorMsg = 'Missing required parameters: deviceId or routerId';
        console.error('❌', errorMsg);
        callback({ status: 'error', error: errorMsg });
        return;
    }
    
    const device = getDeviceById(deviceId);
    const router = getParamRouter(routerId);
    
    if (!device) {
        const errorMsg = `Device with ID ${deviceId} not found`;
        console.error('❌', errorMsg);
        callback({ status: 'error', error: errorMsg });
        return;
    }
    
    if (!router) {
        const errorMsg = `Router with ID ${routerId} not found`;
        console.error('❌', errorMsg);
        callback({ status: 'error', error: errorMsg });
        return;
    }

    // 🔒 S7: экстендер и роутер — в брони пользователя (см. requireLinkAccess)
    try {
        requireLinkAccess(socket, deviceId, routerId, { disconnect: action === 'disconnect' });
    } catch (err) {
        console.warn(`🔒 MWS ${action} denied for ${deviceId} -> ${routerId}: ${err.message}`);
        return callback({ status: 'error', error: err.message });
    }
    
    console.log('✅ Found devices:', {
        device: device.hwId,
        router: router.hwId,
        deviceType: device.type,
        hwType: device.hwType,
        action: action
    });
    
    // 🔑 MWS: пароль роутера — ручной или с самого роутера, проверен на нём.
    // disconnect пароль роутера не использует (снятие VLAN и пробросов).
    let finalRouterPassword = null;
    if (action !== 'disconnect') {
        try {
            finalRouterPassword = await resolveRouterPassword(routerId, socket.clientIp, routerPassword || null);
        } catch (err) {
            console.warn(`🔑 MWS ${action} aborted for ${deviceId} -> ${routerId}: ${err.message}`);
            return callback({ status: 'error', error: err.message });
        }
    }
    
    // ✅ ПОЛУЧАЕМ ПАРОЛЬ УСТРОЙСТВА — конфиг приоритетнее брони
    // (бронь могла пережить смену пароля; конфиг всегда актуален)
    const devicePassword = getDevicePassword(deviceId)
        || deviceBookings.get(deviceId)?.accessPassword
        || dailyPasswords.today.value;
    
    // ✅ ПОДГОТАВЛИВАЕМ ДАННЫЕ ДЛЯ connectToMws
    const mwsData = {
        deviceId,
        routerId, 
        action,
        routerPassword: finalRouterPassword
    };
    
    // 🔒 S5: пароль не должен попадать в логи в открытом виде
    console.log('🔧 Calling connectToMws with data:', {
        ...mwsData,
        routerPassword: mwsData.routerPassword ? '***' : undefined
    });
    
    // ✅ НАЧАЛО ОПЕРАЦИИ
    sendMwsProgress(io, deviceId, 10, 'initializing');
    
    // ✅ ВЫЗЫВАЕМ connectToMws ДЛЯ НАСТРОЙКИ СВИТЧА
    sendMwsProgress(io, deviceId, 20, 'switch_config');
    await connectToMws(mwsData, universalPromptRegex);
    console.log('✅ connectToMws completed successfully');
    sendMwsProgress(io, deviceId, 40, 'switch_config');
      if (action === 'connect') {
        currentModes.set(deviceId, {
          mode: 'extender_connect',
          routerId: routerId,
          timestamp: Date.now()
        });
        
        console.log(`🔧 Режим устройства ${deviceId} обновлен: extender_connect к роутеру ${routerId}`);
        
        io.emit('device:modeUpdated', {
          deviceId: deviceId,
          mode: 'extender_connect',
          routerId: routerId,
          timestamp: Date.now(),
          source: 'mws_connect'
        });
        
        // ✅ НЕМЕДЛЕННАЯ ПРОВЕРКА СТАТУСА
        setTimeout(() => {
          checkAndUpdateDeviceStatusImmediately(io, deviceId);
        }, 2000);
      }
      
      // ✅ ДАЛЕЕ ВЫПОЛНЯЕМ ДОПОЛНИТЕЛЬНЫЕ ОПЕРАЦИИ
      // Коммутатор к этому моменту уже перенастроен, поэтому ошибка пробросов
      // не откатывает режим, но и не глотается: ack уходит с ошибкой.
      // disconnect продолжает ребут и смену режима — линк снят физически,
      // запись в mwsLinks остаётся, повторный disconnect дочистит правила.
      let portForwardError = null;
      try {
        if (action === 'disconnect') {
          ({ portForwardError } = await finishApDisconnect(deviceId, routerId,
            (progress, step) => sendMwsProgress(io, deviceId, progress, step)));
          
        } else {
          // ✅ ПОДКЛЮЧЕНИЕ - НАСТРАИВАЕМ ПРОБРОСЫ
          console.log(`🔧 Setting up port forwarding for device ${deviceId} -> router ${routerId}`);
          sendMwsProgress(io, deviceId, 50, 'port_forwarding');
          
          if (isApSwitchOn(device)) {
            console.log(`🔧 AP device detected - специальная настройка...`);
            sendMwsProgress(io, deviceId, 60, 'ap_config');
            
            await MWSConnectionManager.setupMWSConnection(
                deviceId, 
                routerId, 
                devicePassword,
                finalRouterPassword
            );
            sendMwsProgress(io, deviceId, 80, 'port_forwarding');
          }
          else {
            await MWSConnectionManager.setupMWSConnection(
                deviceId, 
                routerId, 
                devicePassword,
                finalRouterPassword
            );
            sendMwsProgress(io, deviceId, 80, 'port_forwarding');
          }
          
        console.log(`🔗 Successfully connected device ${deviceId} to router ${routerId}`);
        }
      } catch (error) {
          portForwardError = error;
          console.error('❌ Port forwarding operations error:', error);
      }
      
      // ✅ ФИНАЛЬНЫЙ ПРОГРЕСС
      if (portForwardError) {
          sendMwsProgress(io, deviceId, 0, 'error');
      } else {
          sendMwsProgress(io, deviceId, 95, 'verification');
          sendMwsProgress(io, deviceId, 100, 'completed');
      }
      
      // ✅ ОТПРАВЛЯЕМ ОБНОВЛЕНИЯ КЛИЕНТУ
      try {
          const updatedDevice = getDeviceById(deviceId);
          if (updatedDevice) {
              const immediateStatus = await getDeviceStatusWithMode(deviceId);
              console.log(`📊 Device status after MWS ${action}: ${immediateStatus}`);
              
              io.emit('device:status', {
                  deviceId: deviceId,
                  status: immediateStatus
              });
          }
      } catch (statusError) {
          console.log(`⚠️ Quick status check failed: ${statusError.message}`);
      }
      
      // ✅ УВЕДОМЛЯЕМ ОБ ИЗМЕНЕНИИ MWS СТАТУСА
      io.emit('device:mwsStatusUpdated', {
          deviceId: deviceId,
          routerId: routerId,
          status: action === 'disconnect' ? 'disconnected' : 'connected',
          timestamp: Date.now()
      });
      
      // ✅ ОТПРАВЛЯЕМ ОБНОВЛЕНИЕ РЕЖИМА
      io.emit('device:modeUpdated', {
          deviceId: deviceId,
          mode: action === 'disconnect' 
              ? (isApSwitchOn(device) ? 'extender' : 'router')
              : 'extender_connect',
          routerId: action === 'disconnect' ? null : routerId,
          timestamp: Date.now(),
          source: `mws_${action}`
      });

      if (portForwardError) {
          const error = action === 'disconnect'
              ? `Switch disconnected, but port forwarding cleanup failed: ${portForwardError.message} — retry disconnect to clean up`
              : `Switch connected, but port forwarding setup failed: ${portForwardError.message} — device is not reachable via portal, retry connect`;
          return callback({ status: 'error', error, action, deviceId, routerId });
      }

      // Фронт (DeviceDataTable handleMwsOperation) ждёт ack status:'ok' —
      // без него успешная операция уходила в reject по таймауту
      callback({ status: 'ok', action, deviceId, routerId });

    } catch (error) {
         console.error('❌ MWS connection error:', error);
        // ✅ Теперь deviceId доступен здесь!
        if (deviceId) {
         sendMwsProgress(io, deviceId, 0, 'error');
        } else {
         console.error('❌ deviceId is undefined in catch block');
        }
    
         callback({ status: 'error', error: error.message });
        }
  }, { errorShape: 'status' });


  on(socket, 'device:changeMode', async (data, callback) => {
    console.log("СТАТУС ИЗМЕНЕНИЯ WAN ИНТЕРФЕЙСА", data.action)
    let deviceId;
    

    try {
      const { deviceId: id, mode, routerId, password, routerPassword, action } = data;
      deviceId = id;
      
      console.log(`🔄 Processing mode change: ${mode} for device ${deviceId}, action: ${action}`);

      // 🔒 S7: смена режима — только владелец брони; для extender_connect/
      // extender_disconnect ещё и роутер (см. requireLinkAccess)
      try {
        const linked = mode === 'extender_connect' || mode === 'extender_disconnect';
        requireLinkAccess(socket, deviceId, linked ? routerId : null, {
          disconnect: mode === 'extender_disconnect'
        });
      } catch (err) {
        console.warn(`🔒 Mode change denied for ${deviceId}: ${err.message}`);
        return callback({ success: false, error: err.message });
      }
      
      // 🛡 Guard: аппаратный AP-переключатель — софт-смена режима невозможна
      // (прошивка отдаёт 404 на /rci/system/mode, проверено на KN-4310).
      // Сценарии для таких устройств идут через другие операции (MWS-подключение и т.п.)
      const guardDevice = getDeviceById(deviceId);
      if (guardDevice && isApSwitchOn(guardDevice)) {
        console.warn(`🛡 Mode change blocked for ${deviceId}: hardware switch controls mode`);
        callback({
          success: false,
          error: 'Mode is controlled by hardware switch — software mode change is not possible'
        });
        return;
      }
      
      // 🛡 B18: cooldown после полного провала авторизации — не долбим устройство,
      // иначе анти-брутфорс Keenetic временно блокирует IP сервера
      if (isAuthCoolingDown(deviceId)) {
        const msg = 'Authentication cooldown — try again in a minute';
        console.warn(`🔑 Auth cooldown for ${deviceId}`);
        callback({ success: false, error: msg });
        io.emit('device:modeChangeResult', {
          deviceId,
          success: false,
          error: msg,
          timestamp: Date.now()
        });
        return;
      }
      
      // 🔑 Подбор рабочего пароля ДО операции и ДО любых изменений на устройстве.
      // Фронт обычно шлёт daily, устройство может иметь индивидуальный пароль.
      // Проверяем РЕАЛЬНО через защищённый эндпоинт (makeAuthenticatedRequest):
      // при 401 идёт полный auth-флоу — фейковый ALREADY_AUTHENTICATED здесь
      // невозможен, в отличие от keeneticAuth. Сессия кэшируется —
      // changeSystemMode её переиспользует.
      let workingPassword = password;
      let authConfirmed = false;
      let probeNetworkError = null;
      
      {
        const explicit = password ? { [deviceId]: password } : {};
        const candidates = getPasswordCandidates(deviceId, socket.clientIp, explicit);
        const authUrl = getDeviceUrl(deviceId, 'auth');
        
        try {
          const probe = await tryWithPasswords(candidates, async (candidate) => {
            await makeAuthenticatedRequest(
              authUrl, 'admin', candidate, '/rci/show/system/mode', 'GET'
            );
            return true;
          });
          if (probe.result) {
            workingPassword = probe.password;
            authConfirmed = true;
            clearAuthCooldown(deviceId);
            console.log(`🔑 Working password for ${deviceId} (source: ${probe.source})`);
          }
        } catch (e) {
          // не-auth ошибка (сеть/таймаут) прерывает перебор
          probeNetworkError = e;
          console.warn(`⚠️ Auth probe error (not auth): ${e.message}`);
        }
      }
      
      // 🔑 Устройство недоступно — пароли не проверены, cooldown не ставим
      // (он для отказов авторизации, а не для сети)
      if (probeNetworkError) {
        const msg = `Device is unreachable — mode change aborted before any changes: ${probeNetworkError.message}`;
        console.error(`🔑 ${msg} (${deviceId})`);
        callback({ success: false, error: msg });
        io.emit('device:modeChangeResult', {
          deviceId,
          success: false,
          error: msg,
          timestamp: Date.now()
        });
        return;
      }
      
      // 🔑 Без подтверждённой авторизации НЕ ТРОГАЕМ устройство.
      // Раньше wan_off успевал отработать, а смена режима падала по auth —
      // устройство оставалось в router-режиме без аплинка
      if (!authConfirmed) {
        setAuthCooldown(deviceId);
        const msg = `Authentication failed for all password candidates — mode change aborted before any changes`;
        console.error(`🔑 ${msg} (${deviceId})`);
        callback({ success: false, error: 'Authentication failed — check device password' });
        io.emit('device:modeChangeResult', {
          deviceId,
          success: false,
          error: msg,
          timestamp: Date.now()
        });
        return;
      }

      // 🔑 MWS: пароль роутера — ручной или с самого роутера, проверен на нём
      // до любых изменений. Отключению он не нужен (fullDisconnect работает
      // с паролем экстендера).
      let finalRouterPassword = null;
      if (mode === 'extender_connect') {
        try {
          finalRouterPassword = await resolveRouterPassword(routerId, socket.clientIp, routerPassword || null);
        } catch (err) {
          console.warn(`🔑 Mode change aborted for ${deviceId}: ${err.message}`);
          callback({ success: false, error: err.message });
          io.emit('device:modeChangeResult', {
            deviceId,
            success: false,
            error: err.message,
            timestamp: Date.now()
          });
          return;
        }
      }

      callback({ success: true, message: 'Operation started', async: true });
      
      // 🔧 B9: optimistic-мутация currentModes ДО операции удалена.
      // Провал операции (MWS/сеть/ребут) оставлял currentModes в состоянии,
      // которого у устройства нет, а новые клиенты (sendInitData →
      // syncMwsStatusesToClient) видели «connected» для несостоявшегося
      // подключения. Единственная мутация — после успеха (ниже).
      deviceStatusCache.delete(deviceId);
      
      sendModeChangeProgress(io, deviceId, 10, 'initializing');
      
      let result;
      const device = getDeviceById(deviceId);
      
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }
      
      sendModeChangeProgress(io, deviceId, 30, 'applying_config');
      
      let targetUrl = device.checkDeviceMode || device.checkUrl || device.URL;
      
      if (action === 'wan_off') {
        console.log(`🔧 Выключаем WAN интерфейс для устройства ${deviceId}`);
        sendModeChangeProgress(io, deviceId, 35, 'wan_off');
        
        try {
          // ✅ Вызываем changeWanType для выключения WAN
          await changeWanType(deviceId, null, universalPromptRegex);
          console.log(`✅ WAN интерфейс выключен для ${deviceId}`);
        } catch (wanError) {
          console.warn(`⚠️ Ошибка при выключении WAN: ${wanError.message}`);
        }
      }
      
      // ✅ ВЫПОЛНЯЕМ СМЕНУ РЕЖИМА
      switch (mode) {
        case 'router':
          result = await changeSystemMode(deviceId, null, 'router', workingPassword, null, io, 'direct', targetUrl);
          break;
        case 'extender':
          result = await changeSystemMode(deviceId, null, 'extender', workingPassword, null, io, 'direct', targetUrl);
          break;
        case 'extender_connect':
          result = await changeSystemMode(deviceId, routerId, 'extender', workingPassword, finalRouterPassword, io, 'direct', targetUrl);
          break;
        case 'extender_disconnect':
          result = await disconnectAndChangeToRouter(deviceId, routerId, workingPassword, null, io, 'router', targetUrl);
          break;
        default:
          throw new Error(`Unknown mode: ${mode}`);
      }
      
      if (result.success) {
        // 🔧 W1+W3: changeSystemMode УЖЕ дождалась загрузки и сама отправила
        // прогресс (60 rebooting → 80 waiting_online → 95 finalizing).
        // Здесь только короткая верификация и финальный 100%.
        // НЕ эмитим 60/80 повторно — иначе модалка откатится с Finalizing назад!
                // ОБНОВЛЯЕМ РЕЖИМ
        let finalMode = mode;
        let finalRouterId = null;
        
          if (mode === 'extender_disconnect') {
          finalMode = isApSwitchOn(device) ? 'extender' : 'router';
        } else if (mode === 'extender_connect') {
          finalMode = 'extender_connect';
          finalRouterId = routerId;
        } else {
          finalMode = mode;
        }
        
        currentModes.set(deviceId, {
          mode: finalMode,
          routerId: finalRouterId,
          timestamp: Date.now()
        });
        
        console.log(`💾 Final mode saved for device ${deviceId}:`, { mode: finalMode, routerId: finalRouterId });

        // 🔧 W1: пауза МЕЖДУ проверками, а не перед первой; каждый ответ
        // шлём в таблицу/модалку — раньше inline-fetch молчал
        const deviceOnline = await waitForOnline(deviceId, {
            attempts: 10,
            intervalMs: 3000,
            onStatus: (status) => io.emit('device:status', { deviceId, status })
        });

        if (deviceOnline) {
            console.log(`✅ Device ${deviceId} is back online!`);
            sendModeChangeProgress(io, deviceId, 95, 'finalizing');
            
            // Небольшая пауза на полную загрузку API после первого 200
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            sendModeChangeProgress(io, deviceId, 100, 'completed');
        } else {
            console.warn(`⚠️ Device ${deviceId} did not come back online within timeout`);
            sendModeChangeProgress(io, deviceId, 100, 'completed_with_warning');
        }
        
        
        io.emit('device:modeUpdated', {
          deviceId,
          mode: finalMode,
          routerId: finalRouterId,
          action: action, // Передаем action в ответе
          success: true,
          message: result.message,
          source: 'mode_change'
        });
        
        if (mode === 'extender_connect') {
          io.emit('device:mwsStatusUpdated', {
            deviceId: deviceId,
            routerId: routerId,
            status: 'connected',
            timestamp: Date.now()
          });
        } else if (mode === 'extender_disconnect') {
          io.emit('device:mwsStatusUpdated', {
            deviceId: deviceId,
            routerId: routerId,
            status: 'disconnected', 
            timestamp: Date.now()
          });
        }
        
        // 🎯 B3: финальный результат операции — событием, у обеих веток
        io.emit('device:modeChangeResult', {
          deviceId,
          success: true,
          mode: finalMode,
          routerId: finalRouterId,
          action: action,
          message: result.message,
          warning: result.warning,
          timestamp: Date.now()
        });
        
      } else {
        sendModeChangeProgress(io, deviceId, 0, 'error');
        
        io.emit('device:modeChangeResult', {
          deviceId,
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      console.error('❌ Error in device:changeMode:', error);
      
      if (deviceId) {
        sendModeChangeProgress(io, deviceId, 0, 'error');
        
        // 🎯 B3: итог только событием (ack уже использован в начале)
        io.emit('device:modeChangeResult', {
          deviceId,
          success: false,
          error: error.message,
          timestamp: Date.now()
        });
      }
    }
    });

    on(socket, 'device:getCurrentMode', async (data, callback) => {
    try {
        const { deviceId, login, password } = data;
        
        if (!deviceId) {
            return callback({ 
                success: false, 
                error: 'Device ID is required' 
            });
        }

        const device = getDeviceById(deviceId);
        if (!device) {
            return callback({ 
                success: false, 
                error: `Device ${deviceId} not found` 
            });
        }

        if (!device.URL) {
            return callback({ 
                success: false, 
                error: 'Device URL is not configured' 
            });
        }

        // 🔑 Явный пароль от клиента + цепочка сохранённых кандидатов
        const checkUrl = getDeviceUrl(deviceId, 'auth');
        const explicit = password ? { [deviceId]: password } : {};
        const candidates = getPasswordCandidates(deviceId, socket.clientIp, explicit);

        if (candidates.length === 0) {
            return callback({ 
                success: false, 
                error: 'No password available' 
            });
        }

        // checkDeviceMode возвращает success:false вместо throw —
        // auth-отказ превращаем в throw (следующий кандидат), прочие
        // неуспехи возвращаем как результат и отдаём сразу
        const { result: modeResult, lastError } = await tryWithPasswords(candidates, async (candidate) => {
            const res = await checkDeviceMode(checkUrl, login || 'admin', candidate);
            if (!res.success && isAuthError({ message: res.message })) {
                throw new Error(res.message || 'authentication failed');
            }
            return res;
        });

        if (modeResult?.success) {
            callback({ 
                success: true, 
                mode: modeResult.mode,
                hasMwsConnections: modeResult.hasMwsConnections || false
            });
        } else {
            callback({ 
                success: false, 
                error: lastError?.message || modeResult?.message || 'Failed to detect mode' 
            });
        }

    } catch (error) {
        callback({ 
            success: false, 
            error: error.message 
        });
    }
  });

  // TODO B1 (этап 2): fetch с опцией timeout: 8000 ниже — опция не работает
  on(socket, 'device:disconnectExtender', async (data, callback) => {
    try {
      const { deviceId, routerId, password } = data;
  
      console.log(`🔧 Прямое отключение экстендера ${deviceId} от роутера ${routerId}`);

      // 🔒 S7: экстендер — своя бронь, роутер — не в чужой брони
      requireLinkAccess(socket, deviceId, routerId, { disconnect: true });
      
      // ✅ ОЧИЩАЕМ КЭШ СТАТУСА
      deviceStatusCache.delete(deviceId);
      console.log(`🧹 Очищен кэш статуса для устройства ${deviceId} при отключении экстендера`);
  
      const device = getDeviceById(deviceId);
      const router = getParamRouter(routerId);
      
      if (!device || !router) {
        throw new Error(`Устройство ${deviceId} или роутер ${routerId} не найдены`);
      }
      
      // ✅ ДЛЯ ОТКЛЮЧЕНИЯ ВСЕГДА ИСПОЛЬЗУЕМ URL ЧЕРЕЗ РОУТЕР
      const routerIp = router.ip.split('/')[0];
      const disconnectUrl = `http://${routerIp}:${deviceId}`;
      console.log(`🔧 Для отключения экстендера используем URL через роутер: ${disconnectUrl}`);
      
      // Режим не трогаем до успеха fullDisconnect: раньше он удалялся здесь,
      // и при провале устройство оставалось без режима, хотя линк был жив.
      // ✅ ПЕРЕДАЕМ ПРАВИЛЬНЫЙ URL В DisconnectManager
      await DisconnectManager.fullDisconnect(deviceId, routerId, password, disconnectUrl);
  
      // ✅ ОБНОВЛЯЕМ РЕЖИМ НА router
      const newMode = isApSwitchOn(device) ? 'extender' : 'router';
      
      currentModes.set(deviceId, {
        mode: newMode,
        routerId: null,
        timestamp: Date.now()
      });
  
      // ✅ НЕМЕДЛЕННО ПРОВЕРЯЕМ СТАТУС (через прямой URL, так как теперь устройство в router)
      setTimeout(async () => {
        try {
          const directUrl = device.checkDeviceMode || device.checkUrl || device.URL;
          console.log(`🔍 Проверка статуса после отключения через прямой URL: ${directUrl}`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          
          try {
            const response = await fetch(directUrl, {
              method: 'HEAD',
              signal: controller.signal,
              timeout: 8000
            });
            
            clearTimeout(timeoutId);
            const status = response.status;
            console.log(`📊 Статус устройства ${deviceId} после отключения: ${status}`);
            
            io.emit('device:status', {
              deviceId: deviceId,
              status: status
            });
          } catch (fetchError) {
            clearTimeout(timeoutId);
            console.log(`⚠️ Не удалось проверить статус после отключения:`, fetchError.message);
          }
        } catch (statusError) {
          console.log(`⚠️ Ошибка при проверке статуса:`, statusError.message);
        }
      }, 10000); // Ждем 10 секунд после отключения
  
      // ✅ ОТПРАВЛЯЕМ ОБНОВЛЕНИЕ КЛИЕНТУ
      io.emit('device:modeUpdated', {
        deviceId: deviceId,
        mode: newMode,
        routerId: null,
        timestamp: Date.now()
      });
  
      callback({ 
        success: true, 
        message: `Extender ${deviceId} полностью отключен от роутера ${routerId}` 
      });
  
    } catch (error) {
      console.error('❌ Ошибка при отключении экстендера:', error);
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });

  on(socket, 'device:getModeInfo', (deviceId, callback) => {
    const modeInfo = currentModes.get(deviceId);
    callback({
        success: true,
        modeInfo: modeInfo || null
    });
  });
}
