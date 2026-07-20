import net from 'net';
import { Telnet } from "telnet-client";
import { getDeviceById } from "../devices.js";
import { getManagmentID } from "./getManagmentID.js";

/**
 * Новый метод получения статуса питания через net библиотеку
 */
async function newGetPortPowerStatus(deviceId, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device || !device.rebootPort) {
    throw new Error('The device was not found or the parameters are incorrect');
  }

  const ips = process.env.JEROME_IPS;
  const jeromeHosts = getManagmentID(ips);
  const jeromeHost = jeromeHosts[device.jeromeID];
  const jeromePort = parseInt(process.env.JEROME_PORT) || 23;

  if (!jeromeHost) {
    throw new Error(`Jerome host not found for ID: ${device.jeromeID}`);
  }

  const portNum = device.rebootPort;
  const CONNECT_TIMEOUT = 5000;
  const OPERATION_TIMEOUT = 5000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[NEW-GET_POWER] Attempt ${attempt}/${maxRetries} for device: ${device.hwId}, port: ${portNum}, host: ${jeromeHost}:${jeromePort}`);

    try {
      const result = await new Promise((resolve, reject) => {
        const client = new net.Socket();
        let data = '';
        let resolved = false;
        let commandSent = false;
        let timeout = null;

        timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            client.destroy();
            reject(new Error(`Connection timeout (${CONNECT_TIMEOUT}ms) to ${jeromeHost}:${jeromePort}`));
          }
        }, CONNECT_TIMEOUT);

        client.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            client.destroy();
            reject(new Error(`Socket error: ${err.message}`));
          }
        });

        client.connect(jeromePort, jeromeHost, () => {
          console.log(`[NEW-GET_POWER] Connected to Keenetic at ${jeromeHost}:${jeromePort}`);
          
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              client.destroy();
              reject(new Error(`Operation timeout (${OPERATION_TIMEOUT}ms) - no response from Keenetic`));
            }
          }, OPERATION_TIMEOUT);
        });

        client.on('data', (chunk) => {
          const str = chunk.toString();
          
          if (!commandSent) {
            if (str.includes('(config)>')) {
              console.log('[NEW-GET_POWER] Prompt found! Sending command: show channels');
              commandSent = true;
              data = '';
              client.write('show channels\n');
            }
            return;
          }

          if (resolved) return;
          
          data += str;
          
          const regex = new RegExp(`name: ${portNum}[\\s\\S]*?power: (on|off)`, 'm');
          const match = data.match(regex);
          
          if (match) {
            console.log(`[NEW-GET_POWER] Found power status for port ${portNum}: ${match[1]}`);
            resolved = true;
            clearTimeout(timeout);
            client.destroy();
            resolve({ 
              port: portNum, 
              power: match[1],
              deviceId: device.hwId,
              jeromeHost: jeromeHost,
              method: 'new'
            });
          }
        });

        client.on('close', () => {
          console.log('[NEW-GET_POWER] Connection closed');
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            reject(new Error('Connection closed unexpectedly'));
          }
        });
      });

      console.log('[NEW-GET_POWER] Result:', result);
      return result;

    } catch (error) {
      console.error(`[NEW-GET_POWER] Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(`Failed after ${maxRetries} attempts for device ${device.hwId}: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Старый метод получения статуса питания через telnet-client
 */
async function oldGetPortPowerStatus(deviceId, maxRetries = 3) {
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
      console.log(`[OLD-GET_POWER] Attempt ${attempt}/${maxRetries} for device: ${device.hwId}, port: ${device.rebootPort}, host: ${JEROME_HOST}:2424`);
      
      await connection.connect(params);
      await connection.send("\n", { ors: "\r\n" });
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log(`[OLD-GET_POWER] Getting status for port ${device.rebootPort}`);
      const res = await connection.send(`$KE,RID,${device.rebootPort}`, { 
        ors: "\r\n",
        waitfor: /#RID,\d+,\d+/
      });
      
      console.log('[OLD-GET_POWER] Result:', res);

      await connection.end();
      
      const match = res.match(/#RID,(\d+),(\d+)/);
      if (match) {
        const status = match[2] === '1' ? 'on' : 'off';
        console.log(`[OLD-GET_POWER] Port ${device.rebootPort} status: ${status}`);
        return { 
          port: device.rebootPort, 
          power: status,
          deviceId: device.hwId,
          method: 'old'
        };
      }
      
      throw new Error('Invalid response format');

    } catch (err) {
      console.error(`[OLD-GET_POWER] Attempt ${attempt} failed for ${device.hwId}:`, err.message);
      
      try {
        await connection.end();
      } catch (e) {
      }

      if (attempt === maxRetries) {
        throw new Error(`Failed to get power status after ${maxRetries} attempts: ${err.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/**
 * Универсальная функция получения статуса питания
 * Выбирает метод на основе jeromeClass устройства
 */
export async function getPortPowerStatus(deviceId, maxRetries = 3) {
  const device = getDeviceById(deviceId);
  if (!device) {
    throw new Error(`Device ${deviceId} not found`);
  }

  const jeromeClass = device.jeromeClass || 'old';
  
  console.log(`🔍 Getting power status for device ${deviceId} (${device.hwId}), class: ${jeromeClass}`);
  
  if (jeromeClass === 'new') {
    return await newGetPortPowerStatus(deviceId, maxRetries);
  } else {
    return await oldGetPortPowerStatus(deviceId, maxRetries);
  }
}