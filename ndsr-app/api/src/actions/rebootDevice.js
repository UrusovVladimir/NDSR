import { Telnet } from "telnet-client";
import { getDeviceById } from "../devices.js";
import { getManagmentID } from "./getManagmentID.js";

export async function rebootDevice(deviceId, maxRetries = 3) {
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
      timeout: 10000, // Увеличили таймаут
      sendTimeout: 5000,
      execTimeout: 10000,
    };

    try {
      console.log(`[REBOOT] Attempt ${attempt} for device: ${device.hwId}`);
      
      await connection.connect(params);
      await connection.send("\n", { ors: "\r\n" });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // ИСПРАВЛЕНО: Правильная последовательность для ребута - ВКЛЮЧАЕМ порт
      console.log(`[REBOOT] Setting reboot port ${device.rebootPort} to 1`);
      let res = await connection.send(`$KE,WR,${device.rebootPort},1`, { 
        ors: "\r\n",
        waitfor: /\$\w+,\w+,\d+,1/
      });
      console.log('[REBOOT] Result ON:', res);

      // Увеличиваем задержку для ребута (5 секунд вместо 1)
      console.log('[REBOOT] Waiting 5 seconds for reboot pulse...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // ВЫКЛЮЧАЕМ порт (завершаем импульс)
      console.log(`[REBOOT] Setting reboot port ${device.rebootPort} to 0`);
      res = await connection.send(`$KE,WR,${device.rebootPort},0`, { 
        ors: "\r\n",
        waitfor: /\$\w+,\w+,\d+,0/
      });
      console.log('[REBOOT] Result OFF:', res);

      await connection.end();
      
      console.log(`[REBOOT] Successfully rebooted device: ${device.hwId}`);
      return;

    } catch (err) {
      console.error(`[REBOOT] Attempt ${attempt} failed for ${device.hwId}:`, err.message);
      
      try {
        await connection.end();
      } catch (e) {
        // Игнорируем ошибки закрытия соединения
      }

      if (attempt === maxRetries) {
        throw new Error(`Failed to reboot device after ${maxRetries} attempts: ${err.message}`);
      }
      
      // Ждем перед повторной попыткой
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}