// socket/handlers/access.js — доступ к устройству: device:getConsoleUrl,
// tftp:getInterfaceIp, device:init, device:forceStatusCheck.
import { on } from '../wrap.js';
import { devices, getDeviceById } from '../../devices.js';
import { getManagmentID } from '../../actions/getManagmentID.js';
import { consoleUrlCache } from '../../state/consoleUrlCache.js';
import { requireBooking, requireNotRival } from '../../services/bookingService.js';
import { isRival } from '../../utils/deviceFlags.js';
import { getDeviceStatusWithMode } from '../../services/statusService.js';
import { sendOperationProgress } from '../../services/progress.js';
import { initializeDockerManager } from '../../services/docker.js';

export function register(socket, io) {
  on(socket, 'tftp:getInterfaceIp', async (data, callback) => {
      try {
          const { tftpInterfaceName, deviceId } = data;
          
          console.log(`📡 Запрос IP интерфейса TFTP для устройства ${deviceId}, интерфейс: ${tftpInterfaceName}`);
          
          // Получаем устройство
          const device = getDeviceById(deviceId);
          if (!device) {
              throw new Error(`Device ${deviceId} not found`);
          }
          if (isRival(device)) {
              throw new Error('Not available for rival devices.');
          }
          
          // Имя контейнера - это hwId устройства (например, "KN-2710")
          const containerName = device.hwId;
          
          console.log(`🔧 Container name: ${containerName}, Interface: ${tftpInterfaceName}`);
          
          // Инициализируем DockerManager
          const manager = await initializeDockerManager();
          
          // Получаем IP интерфейса
          const interfaceIp = await manager.getInterfaceIp(containerName, tftpInterfaceName);
          
          callback({
              success: true,
              interfaceIp: interfaceIp,
              interfaceName: tftpInterfaceName,
              containerName: containerName,
              deviceId: deviceId
          });
          
      } catch (error) {
          console.error(`❌ Ошибка получения IP интерфейса:`, error);
          callback({
              success: false,
              error: error.message,
              deviceId: data?.deviceId
          });
      }
  });
  
  on(socket, 'device:forceStatusCheck', (deviceId, callback) => {
    console.log(`🔍 Force status check requested for ${deviceId}`);
    
    try {
      const device = getDeviceById(deviceId);
      if (!device) {
        return callback({ success: false, error: 'Device not found' });
      }

      const checkStatusWithRetry = async (maxAttempts = 4, delay = 5000) => {
        let lastStatus = null;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            console.log(`🔍 Status check attempt ${attempt}/${maxAttempts} for ${deviceId}`);
            
            const status = await getDeviceStatusWithMode(device.id);
            console.log(`📊 Status check result for ${deviceId}: ${status} (attempt ${attempt})`);
            
            io.emit('device:status', {
              deviceId: deviceId,
              status: status
            });
            
            if (status === 200) {
              console.log(`✅ Device ${deviceId} is online after ${attempt} attempt(s)`);
              return { success: true, status: status, attempts: attempt };
            }
            
            lastStatus = status;
            
            if (attempt < maxAttempts && status === 500) {
              console.log(`⏳ Device ${deviceId} returned 500, waiting ${delay/1000}s before retry...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            
            return { 
              success: status !== 500, 
              status: status, 
              attempts: attempt,
              warning: status === 500 ? 'Device returned 500 after all attempts' : null
            };
            
          } catch (error) {
            console.error(`❌ Status check attempt ${attempt} failed for ${deviceId}:`, error.message);
            lastStatus = 0;
            
            io.emit('device:status', {
              deviceId: deviceId,
              status: 0
            });
            
            if (attempt < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        return { 
          success: false, 
          status: lastStatus || 0, 
          attempts: maxAttempts,
          error: 'All status check attempts failed'
        };
      };

      checkStatusWithRetry()
        .then(result => {
          console.log(`📋 Final status check result for ${deviceId}:`, result);
          
          callback(result);
        })
        .catch(error => {
          console.error(`❌ Force status check failed for ${deviceId}:`, error);
          
          io.emit('device:status', {
            deviceId: deviceId,
            status: 0
          });
          
          callback({ 
            success: false, 
            status: 0, 
            error: error.message 
          });
        });
        
    } catch (error) {
      console.error('❌ Force status check error:', error);
      
      io.emit('device:status', {
        deviceId: deviceId,
        status: 0
      });
      
      callback({ 
        success: false, 
        status: 0,
        error: error.message 
      });
    }
  });

  // 🔒 S3 + S5 + S7: переписан целиком.
  // S7 — инициализация требует брони владельцем.
  // S3 — SSRF-защита: URL от клиента разрешён, но только на хосты известных
  //      устройств и роутеров (жёстко брать device.URL нельзя — ломает
  //      forwarding-URL через роутеры).
  // S5 — тело запроса и ответ больше не логируются целиком (могут содержать пароли).
  // Заодно заменён неработающий паттерн AbortController на AbortSignal.timeout.
  on(socket, 'device:init', async (data, callback) => {
    const { url, body, deviceId } = data;
    console.log('🔧 device:init request:', { deviceId });

    if (!deviceId) {
      callback({ success: false, error: 'Device ID is required' });
      return;
    }

    // 🔒 S7
    try {
      requireBooking(socket, deviceId);
      requireNotRival(deviceId);
    } catch (err) {
      callback({ success: false, error: err.message });
      return;
    }

    // 🔒 S3: SSRF-защита
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch {
      callback({ success: false, error: 'Invalid URL' });
      return;
    }

    const allowedHosts = new Set();
    for (const d of devices) {
      if (d.ip) allowedHosts.add(String(d.ip).split('/')[0]);
      for (const u of [d.checkUrl, d.URL]) {
        if (u) { try { allowedHosts.add(new URL(u).hostname); } catch {} }
      }
    }

    if (!/^https?:$/.test(urlObj.protocol) || !allowedHosts.has(urlObj.hostname)) {
      callback({ success: false, error: `Host ${urlObj.hostname} is not in the allowed list` });
      return;
    }

    let progress = 0;
    sendOperationProgress(io, deviceId, 0, 'initializing');

    const progressInterval = setInterval(() => {
      progress = Math.min(progress + 15, 90);
      sendOperationProgress(io, deviceId, progress, 'initializing');
    }, 1500);

    try {
      console.log('🌐 Making POST request to:', urlObj.origin + urlObj.pathname);
      // 🔒 S5: тело не логируем целиком — может содержать пароли
      console.log('📦 Request body:', Array.isArray(body)
        ? `${body.length} RCI commands`
        : Object.keys(body || {}));

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000)
      });

      console.log('📡 Response status:', response.status, response.statusText);

      let responseData = null;
      let responseText = '';

      try {
        responseText = await response.text();
        console.log('📡 Raw response (truncated):', responseText.slice(0, 300));
        if (responseText) {
          responseData = JSON.parse(responseText);
        }
      } catch (e) {
        console.log('⚠️ Response is not JSON:', e.message);
        responseData = { rawText: responseText };
      }

      if (!response.ok) {
        clearInterval(progressInterval);
        sendOperationProgress(io, deviceId, 0, 'initializing');

        console.error('❌ HTTP Error:', { status: response.status, statusText: response.statusText });

        callback({
          success: false,
          error: `HTTP ${response.status}: ${responseData?.message || response.statusText || 'No details'}`,
          status: response.status
        });
        return;
      }

      clearInterval(progressInterval);
      sendOperationProgress(io, deviceId, 100, 'initializing');
      console.log('✅ Initialization successful!');

      setTimeout(() => {
        callback({ success: true, data: responseData || {} });
      }, 500);

    } catch (err) {
      clearInterval(progressInterval);
      sendOperationProgress(io, deviceId, 0, 'initializing');

      console.error('❌ Initialization error:', { name: err.name, message: err.message, code: err.code });

      let errorMessage = err.message;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        errorMessage = 'Request timeout - device is not responding';
      } else if (err.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused - device may be offline';
      } else if (err.code === 'ENOTFOUND') {
        errorMessage = 'Device host not found';
      }
      callback({ success: false, error: errorMessage, code: err.code });
    }
  });

  const iPs = process.env.MOXA_IPS
  const consoleIPs = getManagmentID(iPs)

  on(socket, 'device:getConsoleUrl', (deviceId, callback) => {
    if (isRival(getDeviceById(deviceId))) {
      return callback({ success: false, error: 'Not available for rival devices.' });
    }
    const cached = consoleUrlCache.get(deviceId);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return callback(cached.data);
    }
    
    try {
      const device = getDeviceById(deviceId);
      if (!device) {
        return callback({ success: false, error: 'Device not found' });
      }
      
      const consoleBaseUrl = consoleIPs[device.consoleID];
      if (!consoleBaseUrl) {
        return callback({ success: false, error: 'Console IP not configured for this device' });
      }

      const consoleUrl = `http://${consoleBaseUrl}/remote/telnet/telnet/${device.consolePort}`;
      
      const result = { 
        success: true, 
        url: consoleUrl,
        deviceName: device.hwId
      };

      consoleUrlCache.set(deviceId, {
        timestamp: Date.now(),
        data: result
      });

      callback(result);

    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });
}
