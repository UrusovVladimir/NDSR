import { getCronStatus, deviceBookings, currentWanTypes } from '../socketHandler.js';
import { Telnet } from "telnet-client";
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

export async function resetConfig(deviceId, maxRetries = 3) {
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
      port: process.env.JEROME_PORT,
      negotiationMandatory: false,
      timeout: 10000,
      sendTimeout: 5000,
      execTimeout: 10000,
    };

    try {
      console.log(`[RESET] Attempt ${attempt} for device: ${device.hwId}`);
      
      await connection.connect(params);
      await connection.send("\n", { ors: "\r\n" });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // ВКЛЮЧАЕМ порт (активируем reset) - ДЛИТЕЛЬНО
      console.log(`[RESET] Setting reset port ${device.resetPort} to 1`);
      let res = await connection.send(`$KE,WR,${device.resetPort},1`, { 
        ors: "\r\n",
        waitfor: /\$\w+,\w+,\d+,1/
      });
      console.log("[RESET] Result Down:", res);

      // Ждем 12 секунд для полного сброса устройства
      console.log("[RESET] Waiting 10 seconds for device reset...");
      await new Promise(resolve => setTimeout(resolve, 12000));

      // ВЫКЛЮЧАЕМ порт (завершаем reset)
      console.log(`[RESET] Setting reset port ${device.resetPort} to 0`);
      res = await connection.send(`$KE,WR,${device.resetPort},0`, { 
        ors: "\r\n",
        waitfor: /\$\w+,\w+,\d+,0/
      });
      console.log("[RESET] Result UP:", res);

      await connection.end();
      
      console.log(`[RESET] Successfully reset device: ${device.hwId}`);
      return;

    } catch (err) {
      console.error(`[RESET] Attempt ${attempt} failed for ${device.hwId}:`, err.message);
      
      try {
        await connection.end();
      } catch (e) {
        // Игнорируем ошибки закрытия соединения
      }

      if (attempt === maxRetries) {
        throw new Error(`Failed to reset device after ${maxRetries} attempts: ${err.message}`);
      }
      
      // Ждем перед повторной попыткой
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

// CRON на сброс всех устройств в 4:00
async function resetAllDevices() {
  if (!getCronStatus()) {
    console.log("Cron is disabled — skipping auto reset.");
    return;
  }

  console.log("Starting automatic device reset...");

  for (const device of devices) {
    if (isDeviceBookedNow(device.id)) {
      console.log(`Skipping ${device.hwId} — booked until ${new Date(deviceBookings.get(device.id).expiresAt * 1000)}`);
      continue;
    }

    try {
      await resetConfig(device.id);
      console.log(`Successfully reset device: ${device.hwId}`);
      
      // Задержка между устройствами
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
      console.log(`Skipping ${device.hwId} — booked until ${new Date(deviceBookings.get(device.id).expiresAt * 1000)}`);
      continue;
    }

    try {
      console.log("Resetting WAN type for device:", device.id);
      console.log("Current WAN type:", currentWanTypes[device.id] || "unknown");
      
      // Очищаем текущий WAN тип
      if (currentWanTypes[device.id]) {
        delete currentWanTypes[device.id];
        console.log(`Cleared WAN type for device ${device.hwId}`);
      }
      
      await changeWanType(device.id, "4094");
      
      // Задержка между устройствами
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