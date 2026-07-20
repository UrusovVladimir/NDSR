// actions/rebootDevice.js
import net from 'net';
import { Telnet } from "telnet-client";
import { getDeviceById } from "../devices.js";
import { getManagmentID } from "./getManagmentID.js";

/**
 * Новый метод перезагрузки через net библиотеку
 */
async function newReboot(deviceId, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device || !device.rebootPort) {
    throw new Error('The device was not found or the parameters are incorrect');
  }

  const ips = process.env.JEROME_IPS;
  const jeromeHosts = getManagmentID(ips);
  const jeromeHost = jeromeHosts[device.jeromeID];
  const jeromePort = parseInt(process.env.JEROME_PORT) || 23;

  if (!jeromeHost) {
    throw new Error(`Jerome host not found for device ${device.hwId}`);
  }

  const portNum = device.rebootPort;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[NEW-REBOOT] Attempt ${attempt}/${maxRetries} for device: ${device.hwId}, port: ${portNum}`);

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
          console.log('[NEW-REBOOT] Connected to Keenetic');
          connected = true;
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              client.destroy();
              reject(new Error('Operation timeout'));
            }
          }, 15000);
        });

        client.on('data', (chunk) => {
          const str = chunk.toString();
          
          if (!commandSent) {
            if (str.includes('(config)>')) {
              console.log('[NEW-REBOOT] Prompt found! Starting reboot sequence...');
              commandSent = true;
              
              console.log(`[NEW-REBOOT] Turning OFF port ${portNum}`);
              client.write(`channel ${portNum} power off\n`);
              
              setTimeout(() => {
                console.log(`[NEW-REBOOT] Turning ON port ${portNum}`);
                client.write(`channel ${portNum} power on\n`);
                
                setTimeout(() => {
                  if (!resolved) {
                    console.log('[NEW-REBOOT] Reboot sequence completed');
                    resolved = true;
                    clearTimeout(timeout);
                    client.destroy();
                    resolve();
                  }
                }, 1000);
              }, 4000);
            }
          }
        });

        client.on('close', () => {
          console.log('[NEW-REBOOT] Connection closed');
          clearTimeout(timeout);
          if (!resolved && !connected) {
            resolved = true;
            reject(new Error('Connection closed before connecting'));
          }
        });
      });

      console.log(`[NEW-REBOOT] ✅ Successfully rebooted device: ${device.hwId}`);
      return { success: true, deviceId: device.hwId, method: 'new' };

    } catch (error) {
      console.error(`[NEW-REBOOT] ❌ Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(`Failed to reboot device after ${maxRetries} attempts: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/**
 * Старый метод перезагрузки через telnet-client (порт 2424)
 */
async function oldReboot(deviceId, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device || !device.rebootPort)
    throw new Error('The device was not found or the parameters are incorrect');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const connection = new Telnet();
    const iPs = process.env.JEROME_IPS;
    const JEROME_HOSTS = getManagmentID(iPs);
    const JEROME_HOST = JEROME_HOSTS[device.jeromeID];

    const params = {
      host: JEROME_HOST,
      port: 2424,
      negotiationMandatory: false,
      timeout: 1000,
      sendTimeout: 5000,
      execTimeout: 10000,
    };

    try {
      console.log(`[OLD-REBOOT] Attempt ${attempt} for device: ${device.hwId}`);
      
      await connection.connect(params);
      await connection.send("\n", { ors: "\r\n" });
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log(`[OLD-REBOOT] Setting reboot port ${device.rebootPort} to 0`);
      let res = await connection.send(`$KE,WR,${device.rebootPort},0`, { 
        ors: "\r\n",
        waitfor: /\$\w+,\w+,\d+,1/
      });
      console.log('[OLD-REBOOT] Result OFF:', res);

      console.log('[OLD-REBOOT] Waiting 4 seconds for reboot pulse...');
      await new Promise(resolve => setTimeout(resolve, 4000));

      console.log(`[OLD-REBOOT] Setting reboot port ${device.rebootPort} to 1`);
      res = await connection.send(`$KE,WR,${device.rebootPort},1`, { 
        ors: "\r\n",
        waitfor: /\$\w+,\w+,\d+,0/
      });
      console.log('[OLD-REBOOT] Result ON:', res);

      await connection.end();
      
      console.log(`[OLD-REBOOT] Successfully rebooted device: ${device.hwId}`);
      return { success: true, deviceId: device.hwId, method: 'old' };

    } catch (err) {
      console.error(`[OLD-REBOOT] Attempt ${attempt} failed for ${device.hwId}:`, err.message);
      
      try {
        await connection.end();
      } catch (e) {
      }

      if (attempt === maxRetries) {
        throw new Error(`Failed to reboot device after ${maxRetries} attempts: ${err.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/**
 * Универсальная функция перезагрузки
 * Выбирает метод на основе jeromeClass устройства
 */
export async function rebootDevice(deviceId, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device) {
    throw new Error(`Device ${deviceId} not found`);
  }

  const jeromeClass = device.jeromeClass || 'old';
  
  console.log(`🔄 Rebooting device ${deviceId} (${device.hwId}), class: ${jeromeClass}`);
  
  if (jeromeClass === 'new') {
    return await newReboot(deviceId, maxRetries);
  } else {
    return await oldReboot(deviceId, maxRetries);
  }
}