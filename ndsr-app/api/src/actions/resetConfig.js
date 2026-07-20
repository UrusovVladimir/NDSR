// actions/resetConfig.js
import net from 'net';
import { Telnet } from "telnet-client";
import { getCronStatus, deviceBookings, currentWanTypes } from '../socketHandler.js';
import { getDeviceById, devices } from "../devices.js";
import cron from "node-cron";
import { changeWanType } from './changeWanType.js';
import { getManagmentID } from "./getManagmentID.js";

function isDeviceBookedNow(deviceId) {
  if (!deviceBookings.has(deviceId)) return false;
  const booking = deviceBookings.get(deviceId);
  const now = Math.floor(Date.now() / 1000);
  return now < booking.expiresAt;
}

/**
 * Вспомогательная функция для отправки команды и ожидания ответа (новый метод)
 */
function sendCommandAndWait(host, port, command, expectedPattern, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let data = '';
    let resolved = false;
    let timeout = null;
    let promptDetected = false;

    timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.destroy();
        reject(new Error(`Timeout waiting for response to: ${command}`));
      }
    }, timeoutMs);

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        client.destroy();
        reject(err);
      }
    });

    client.connect(port, host, () => {
      console.log(`[RESET] Connected to ${host}:${port}`);
    });

    client.on('data', (chunk) => {
      const str = chunk.toString();
      data += str;
      
      if (str.includes('(config)>')) {
        console.log('[RESET] Prompt detected');
        promptDetected = true;
        
        if (!resolved && !command.includes('[sent]')) {
          console.log(`[RESET] Sending: ${command}`);
          client.write(`${command}\n`);
          command = command + ' [sent]';
        }
      }
      
      if (expectedPattern && str.match(expectedPattern)) {
        console.log(`[RESET] Expected response received: ${str.trim()}`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.destroy();
          resolve(str.trim());
        }
      }
      
      if (str.includes('Error') || str.includes('Invalid') || str.includes('failed')) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.destroy();
          reject(new Error(str.trim()));
        }
      }
    });

    client.on('close', () => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        if (promptDetected) {
          console.log('[RESET] Connection closed after prompt - assuming success');
          resolve('Command sent successfully');
        } else {
          reject(new Error('Connection closed without prompt'));
        }
      }
    });
  });
}

/**
 * Новый метод сброса через net библиотеку (порт 23)
 */
async function newReset(deviceId, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device || !device.resetPort) {
    throw new Error("The device was not found or the parameters are incorrect");
  }

  const ips = process.env.JEROME_IPS;
  const jeromeHosts = getManagmentID(ips);
  const jeromeHost = jeromeHosts[device.jeromeID];
  const jeromePort = parseInt(process.env.JEROME_PORT) || 23;

  if (!jeromeHost) {
    throw new Error(`Jerome host not found for device ${device.hwId} (jeromeID: ${device.jeromeID})`);
  }

  const portNum = device.resetPort;
  const RESET_HOLD_TIME = 10000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[NEW-RESET] Attempt ${attempt}/${maxRetries} for device: ${device.hwId}, port: ${portNum}`);

    try {
      console.log(`[NEW-RESET] 🔴 Activating reset on port ${portNum}`);
      await sendCommandAndWait(
        jeromeHost,
        jeromePort,
        `channel ${portNum} reset on`,
        /PowerHub::Controller: Set channel \d+ reset on\./,
        10000
      );
      console.log(`[NEW-RESET] ✅ Reset activated on port ${portNum}`);

      console.log(`[NEW-RESET] ⏳ Waiting ${RESET_HOLD_TIME/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RESET_HOLD_TIME));

      console.log(`[NEW-RESET] 🔵 Deactivating reset on port ${portNum}`);
      await sendCommandAndWait(
        jeromeHost,
        jeromePort,
        `channel ${portNum} reset off`,
        /PowerHub::Controller: Set channel \d+ reset off\./,
        10000
      );
      console.log(`[NEW-RESET] ✅ Reset deactivated on port ${portNum}`);

      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log(`[NEW-RESET] ✅ Successfully reset device: ${device.hwId}`);
      return { 
        success: true, 
        deviceId: device.hwId,
        port: portNum,
        action: 'reset',
        method: 'new',
        message: `Device ${device.hwId} reset successfully`
      };

    } catch (error) {
      console.error(`[NEW-RESET] ❌ Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(`Failed to reset device after ${maxRetries} attempts: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/**
 * Старый метод сброса через telnet-client (порт 2424)
 */
async function oldReset(deviceId, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device || !device.resetPort)
    throw new Error("The device was not found or the parameters are incorrect");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const connection = new Telnet();
    const iPs = process.env.JEROME_IPS;
    const JEROME_HOSTS = getManagmentID(iPs);
    const JEROME_HOST = JEROME_HOSTS[device.jeromeID];

    const params = {
      host: JEROME_HOST,
      port: 2424,
      negotiationMandatory: false,
      timeout: 10000,
      sendTimeout: 5000,
      execTimeout: 10000,
    };

    try {
      console.log(`[OLD-RESET] Attempt ${attempt} for device: ${device.hwId}`);
      
      await connection.connect(params);
      await connection.send("\n", { ors: "\r\n" });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Активируем reset
      console.log(`[OLD-RESET] Setting reset port ${device.resetPort} to 1`);
      let res = await connection.send(`$KE,WR,${device.resetPort},1`, { 
        ors: "\r\n",
        waitfor: /\$\w+,\w+,\d+,1/
      });
      console.log("[OLD-RESET] Result ON:", res);

      // Ждем 10 секунд
      console.log("[OLD-RESET] Waiting 10 seconds for device reset...");
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Деактивируем reset
      console.log(`[OLD-RESET] Setting reset port ${device.resetPort} to 0`);
      res = await connection.send(`$KE,WR,${device.resetPort},0`, { 
        ors: "\r\n",
        waitfor: /\$\w+,\w+,\d+,0/
      });
      console.log("[OLD-RESET] Result OFF:", res);

      await connection.end();
      
      console.log(`[OLD-RESET] Successfully reset device: ${device.hwId}`);
      return { 
        success: true, 
        deviceId: device.hwId, 
        method: 'old',
        message: `Device ${device.hwId} reset successfully`
      };

    } catch (err) {
      console.error(`[OLD-RESET] Attempt ${attempt} failed for ${device.hwId}:`, err.message);
      
      try {
        await connection.end();
      } catch (e) {
      }

      if (attempt === maxRetries) {
        throw new Error(`Failed to reset device after ${maxRetries} attempts: ${err.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/**
 * Универсальная функция сброса конфигурации
 * Выбирает метод на основе jeromeClass устройства
 */
export async function resetConfig(deviceId, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device) {
    throw new Error(`Device ${deviceId} not found`);
  }

  const jeromeClass = device.jeromeClass || 'old';
  
  console.log(`🔄 Resetting device ${deviceId} (${device.hwId})`);
  console.log(`   Method: ${jeromeClass === 'new' ? 'NEW (net, port 23)' : 'OLD (telnet-client, port 2424)'}`);
  console.log(`   Jerome ID: ${device.jeromeID}, Reset Port: ${device.resetPort}`);
  
  if (jeromeClass === 'new') {
    return await newReset(deviceId, maxRetries);
  } else {
    return await oldReset(deviceId, maxRetries);
  }
}

// ==================== CRON ЗАДАЧИ ====================

// CRON на сброс всех устройств в 4:00
async function resetAllDevices() {
  if (!getCronStatus()) {
    console.log("Cron is disabled — skipping auto reset.");
    return;
  }

  console.log("Starting automatic device reset...");

  for (const device of devices) {
    if (isDeviceBookedNow(device.id)) {
      console.log(`Skipping ${device.hwId} — booked`);
      continue;
    }

    try {
      await resetConfig(device.id);
      console.log(`Successfully reset device: ${device.hwId}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`Failed to reset device ${device?.hwId}:`, err.message);
    }
  }

  console.log("All devices processed for reset.");
}

// CRON на сброс WAN типа в 2:50
async function resetAllWanDevice() {
  if (!getCronStatus()) {
    console.log("Cron is disabled — skipping WAN type reset.");
    return;
  }

  console.log("Starting automatic WAN type reset...");
  
  for (const device of devices) {
    if (isDeviceBookedNow(device.id)) {
      console.log(`Skipping ${device.hwId} — booked`);
      continue;
    }

    try {
      console.log("Resetting WAN type for device:", device.id);
      
      if (currentWanTypes[device.id]) {
        delete currentWanTypes[device.id];
        console.log(`Cleared WAN type for device ${device.hwId}`);
      }
      
      await changeWanType(device.id, "4094");
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`Successfully reset WAN type for device: ${device.hwId}`);
    } catch (err) {
      console.error(`Failed to reset WAN type for device ${device?.hwId}:`, err.message);
    }
  }

  console.log("All devices processed for WAN type reset.");
}

// CRON задачи
cron.schedule("0 4 * * *", () => {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] Auto-reset triggered by cron`);
  resetAllDevices().catch(err => {
    console.error(`[${timestamp}] Auto-reset failed:`, err);
  });
}, { timezone: "Europe/Moscow" });

cron.schedule("50 2 * * *", () => {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] Auto-WAN type reset triggered by cron`);
  resetAllWanDevice().catch(err => {
    console.error(`[${timestamp}] Auto-WAN reset failed:`, err);
  });
}, { timezone: "Europe/Moscow" });