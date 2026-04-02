// actions/getPortPowerStatus.js
import { Telnet } from "telnet-client";
import { getDeviceById } from "../devices.js";
import { getManagmentID } from "./getManagmentID.js";

export async function getPortPowerStatus(deviceId, maxRetries = 3) {
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
      port: process.env.JEROME_PORT,
      negotiationMandatory: false,
      timeout: 1000,
      sendTimeout: 5000,
      execTimeout: 10000,
    };

    try {
      console.log(`[GET_POWER_STATUS] Attempt ${attempt} for device: ${device.hwId}, port: ${device.rebootPort}`);
      
      await connection.connect(params);
      await connection.send("\n", { ors: "\r\n" });
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log(`[GET_POWER_STATUS] Getting status for port ${device.rebootPort}`);
      const res = await connection.send(`$KE,RID,${device.rebootPort}`, { 
        ors: "\r\n",
        waitfor: /#RID,\d+,\d+/
      });
      
      console.log('[GET_POWER_STATUS] Result:', res);

      await connection.end();
      
      const match = res.match(/#RID,(\d+),(\d+)/);
      if (match) {
        const status = match[2] === '1' ? 'on' : 'off';
        console.log(`[GET_POWER_STATUS] Port ${device.rebootPort} status: ${status}`);
        return status;
      }
      
      throw new Error('Invalid response format');

    } catch (err) {
      console.error(`[GET_POWER_STATUS] Attempt ${attempt} failed for ${device.hwId}:`, err.message);
      
      try {
        await connection.end();
      } catch (e) {
        // Игнорируем ошибки закрытия соединения
      }

      if (attempt === maxRetries) {
        throw new Error(`Failed to get power status after ${maxRetries} attempts: ${err.message}`);
      }
      
      // Ждем перед повторной попыткой
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}