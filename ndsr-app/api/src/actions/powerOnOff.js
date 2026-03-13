import { Telnet } from "telnet-client";
import { getDeviceById } from "../devices.js";
import { getManagmentID } from "./getManagmentID.js";

export async function powerSetup(deviceId, action = null, maxRetries = 3) {
    console.log("Переда id устройства",deviceId)
  const device = getDeviceById(deviceId);
  if (!device || !device.rebootPort) {
    throw new Error('Device not found or reboot port not configured');
  }

  // Валидация параметра action
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
      port: process.env.JEROME_PORT || 23,
      negotiationMandatory: false,
      timeout: 3000,
      sendTimeout: 5000,
      execTimeout: 10000,
      shellPrompt: '',
      echoLines: 0
    };

    try {
      console.log(`[POWER] Attempt ${attempt}/${maxRetries} for device: ${device.hwId}, action: ${action}`);
      
      await connection.connect(params);
      await connection.send("\r\n", { timeout: 2000 });
      await new Promise(resolve => setTimeout(resolve, 1000));

      let command, commandDesc;

      switch (action) {
        case 'on':
          command = `$KE,WR,${device.rebootPort},1`;
          commandDesc = 'Power ON';
          break;
          
        case 'off':
          command = `$KE,WR,${device.rebootPort},0`;
          commandDesc = 'Power OFF';
          break;
      }

      console.log(`[POWER] Sending command: ${command}`);
      
      const result = await connection.send(command, {
        ors: "\r\n",
        waitfor: /\r?\n/,
        timeout: 5000
      });
      
      console.log(`[POWER] ${commandDesc} result:`, result);
      
      await connection.end();
      console.log(`[POWER] ✅ ${commandDesc} successful for device: ${device.hwId}`);
      
      return { success: true, action, deviceId: device.hwId, response: result };

    } catch (err) {
      console.error(`[POWER] ❌ Attempt ${attempt} failed for ${device.hwId}:`, err.message);
      
      try {
        await connection.end();
      } catch (e) {
      }

      if (attempt === maxRetries) {
        throw new Error(`Failed to ${action} device after ${maxRetries} attempts: ${err.message}`);
      }
      
      // Экспоненциальная задержка между попытками
      const delay = 1000 * Math.pow(2, attempt);
      console.log(`[POWER] Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}