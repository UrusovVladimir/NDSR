import { getCronStatus } from '../socketHandler.js';
import { Telnet } from "telnet-client";
import { getDeviceById, devices } from "../devices.js";
import cron from "node-cron";
import { deviceBookings } from '../socketHandler.js';
import { changeWanType } from './changeWanType.js';
import { currentWanTypes } from '../socketHandler.js';

function isDeviceBookedNow(deviceId) {
  if (!deviceBookings.has(deviceId)) return false;
  const booking = deviceBookings.get(deviceId);
  const now = Math.floor(Date.now() / 1000);
  return now < booking.expiresAt;
}

export async function resetConfig(deviceId) {
  const device = getDeviceById(deviceId);
  if (!device || !device.resetPort)
    throw new Error("The device was not found or the parameters are incorrect");

  const connection = new Telnet();
  const JEROME_HOST =
    device.jeromeID == 1 ? process.env.JEROME_1_IP : process.env.JEROME_2_IP;

  const params = {
    host: JEROME_HOST,
    port: process.env.JEROME_PORT,
    negotiationMandatory: false,
    timeout: 3500,
    sendTimeout: 2500,
  };

  await connection.connect(params);
  await connection.send("\n", { ors: "\r\n" });

  console.log("Reset:", device.hwId);

  let res = await connection.send(`$KE,WR,${device.resetPort},1`, { ors: "\r\n" });
  console.log("ResultDown:", res);

  await new Promise((resolve) => setTimeout(resolve, 10000));

  res = await connection.send(`$KE,WR,${device.resetPort},0`, { ors: "\r\n" });
  console.log("ResultUP:", res);

  await connection.end();
}

// ----------------------------------
// CRON на сброс всех устройств в 3:00
// ----------------------------------

async function resetAllDevices() {
  if (!getCronStatus()) {
    console.log("Cron is disabled — skipping auto reset.");
    return;
  }
  const universalPromptRegex = /MGS3520.*[# ]/i;
  const wan = "Clear WAN type";
  console.log("Starting automatic device reset...");

  for (const device of devices) {
    if (isDeviceBookedNow(device.id)) {
      console.log(`Skipping ${device.hwId} — booked until ${new Date(deviceBookings.get(device.id).expiresAt * 1000)}`);
      continue;
    }

    try {
      await resetConfig(device.id);
      
      console.log(`Successfully reset device: ${device.hwId}`);
    } catch (err) {
      console.error(`Failed to reset device ${device?.hwId}:`, err.message || err);
    }
  }

  console.log("All devices processed for reset.");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resetAllWanDevice() {
  if (!getCronStatus()) {
    console.log("Cron is disabled — skipping WAN type reset.");
    return;
  }
  console.log("Starting automatic WAN type reset...");
  const universalPromptRegex = /MGS3520.*[# ]/i;
  
  for (const device of devices) {
    if (isDeviceBookedNow(device.id)) {
      console.log(`Skipping ${device.hwId} — booked until ${new Date(deviceBookings.get(device.id).expiresAt * 1000)}`);
      continue;
    }

    try {
      console.log("Сейчас выполняется сброс WAN типа устройства:", device.id);
      console.log("Текущий WAN тип:", currentWanTypes[device.id] || "неизвестно");
      
      // Очищаем текущий WAN тип перед изменением
      if (currentWanTypes[device.id]) {
        delete currentWanTypes[device.id];
        console.log(`Очищен WAN тип для устройства ${device.hwId}`);
      }
      
      await changeWanType(device.id, "4094", universalPromptRegex);
      await sleep(1000); // Задержка для предотвращения перегрузки устройства
      console.log(`Successfully reset WAN type for device: ${device.hwId}`);
    } catch (err) {
      console.error(`Failed to reset WAN type for device ${device?.hwId}:`, err.message || err);
    }
  }

  console.log("All devices processed for WAN type reset.");
}

// CRON запуск
cron.schedule("0 3 * * *", () => {
  console.log(`[${new Date().toLocaleString()}] Auto-reset triggered by cron`);
  resetAllDevices();
}, { timezone: "Europe/Moscow" });

cron.schedule("50 2 * * *", () => {
  console.log(`[${new Date().toLocaleString()}] Auto-WAN type reset triggered by cron`);
  resetAllWanDevice();
},
{timezone: "Europe/Moscow"});
