// actions/powerOnOff.js
import net from 'net';
import { Telnet } from "telnet-client";
import { getDeviceById } from "../devices.js";
import { getManagmentID } from "./getManagmentID.js";

/**
 * Новый метод управления питанием через net библиотеку
 */
async function newPowerControl(deviceId, action, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device || !device.rebootPort) {
    throw new Error('Device not found or reboot port not configured');
  }

  const validActions = ['on', 'off'];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
  }

  const ips = process.env.JEROME_IPS;
  const jeromeHosts = getManagmentID(ips);
  const jeromeHost = jeromeHosts[device.jeromeID];
  const jeromePort = parseInt(process.env.JEROME_PORT) || 23;

  if (!jeromeHost) {
    throw new Error(`Jerome host not found for device ${device.hwId}`);
  }

  const portNum = device.rebootPort;
  const powerCommand = action === 'on' ? 'power on' : 'power off';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[NEW-POWER] Attempt ${attempt}/${maxRetries} for device: ${device.hwId}, action: ${action}`);

    try {
      await new Promise((resolve, reject) => {
        const client = new net.Socket();
        let resolved = false;
        let connected = false;
        let commandSent = false;
        let timeout = null;

        timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            client.destroy();
            reject(new Error('Connection timeout'));
          }
        }, 5000);

        client.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            client.destroy();
            reject(err);
          }
        });

        client.connect(jeromePort, jeromeHost, () => {
          console.log('[NEW-POWER] Connected to Keenetic');
          connected = true;
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              client.destroy();
              reject(new Error('Operation timeout'));
            }
          }, 10000);
        });

        client.on('data', (chunk) => {
          const str = chunk.toString();
          
          if (!commandSent) {
            if (str.includes('(config)>')) {
              console.log('[NEW-POWER] Prompt found! Sending power command...');
              commandSent = true;
              
              console.log(`[NEW-POWER] Channel ${portNum} ${powerCommand}`);
              client.write(`channel ${portNum} ${powerCommand}\n`);
              
              setTimeout(() => {
                if (!resolved) {
                  console.log('[NEW-POWER] Command completed');
                  resolved = true;
                  clearTimeout(timeout);
                  client.destroy();
                  resolve();
                }
              }, 1000);
            }
          }
        });

        client.on('close', () => {
          console.log('[NEW-POWER] Connection closed');
          clearTimeout(timeout);
          if (!resolved && !connected) {
            resolved = true;
            reject(new Error('Connection closed before connecting'));
          }
        });
      });

      console.log(`[NEW-POWER] ✅ Power ${action} successful for device: ${device.hwId}`);
      return { success: true, action, deviceId: device.hwId, method: 'new' };

    } catch (error) {
      console.error(`[NEW-POWER] ❌ Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(`Failed to ${action} device after ${maxRetries} attempts: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/**
 * Старый метод управления питанием через telnet-client (порт 2424)
 */
async function oldPowerControl(deviceId, action, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device || !device.rebootPort) {
    throw new Error('Device not found or reboot port not configured');
  }

  const validActions = ['on', 'off'];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const connection = new Telnet();
    const iPs = process.env.JEROME_IPS;
    const JEROME_HOSTS = getManagmentID(iPs);
    const JEROME_HOST = JEROME_HOSTS[device.jeromeID];

    if (!JEROME_HOST) {
      throw new Error(`Jerome host not found for device ${device.hwId} (jeromeID: ${device.jeromeID})`);
    }

    const params = {
      host: JEROME_HOST,
      port: 2424,
      negotiationMandatory: false,
      timeout: 1000,
      sendTimeout: 5000,
      execTimeout: 10000,
    };

    try {
      console.log(`[OLD-POWER] Attempt ${attempt}/${maxRetries} for device: ${device.hwId}, action: ${action}`);
      
      await connection.connect(params);
      await connection.send("\n", { ors: "\r\n" });
      await new Promise(resolve => setTimeout(resolve, 1000));

      let command;
      switch (action) {
        case 'on':
          command = `$KE,WR,${device.rebootPort},1`;
          break;
        case 'off':
          command = `$KE,WR,${device.rebootPort},0`;
          break;
      }

      console.log(`[OLD-POWER] Sending command: ${command}`);
      
      const result = await connection.send(command, {
        ors: "\r\n",
        waitfor: /\$\w+,\w+,\d+,(1|0)/
      });
      
      console.log(`[OLD-POWER] Result:`, result);
      
      await connection.end();
      console.log(`[OLD-POWER] ✅ Power ${action} successful for device: ${device.hwId}`);
      
      return { success: true, action, deviceId: device.hwId, method: 'old' };

    } catch (err) {
      console.error(`[OLD-POWER] ❌ Attempt ${attempt} failed for ${device.hwId}:`, err.message);
      
      try {
        await connection.end();
      } catch (e) {
      }

      if (attempt === maxRetries) {
        throw new Error(`Failed to ${action} device after ${maxRetries} attempts: ${err.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/**
 * Универсальная функция управления питанием
 * Выбирает метод на основе jeromeClass устройства
 */
export async function powerSetup(deviceId, action) {
  const device = getDeviceById(deviceId);
  if (!device) {
    throw new Error(`Device ${deviceId} not found`);
  }

  const jeromeClass = device.jeromeClass || 'old';
  
  console.log(`🔌 Power control for device ${deviceId} (${device.hwId}), action: ${action}, class: ${jeromeClass}`);
  
  if (jeromeClass === 'new') {
    return await newPowerControl(deviceId, action);
  } else {
    return await oldPowerControl(deviceId, action);
  }
}