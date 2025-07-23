import { getCronStatus } from '../socketHandler.js';
import { Telnet } from "telnet-client";
import { getDeviceById, devices } from "../devices.js";
import cron from "node-cron";
import { deviceBookings } from '../socketHandler.js';
import { changeWanType } from './changeWanType.js';

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
  const wan = "Clear WAN typr"
  console.log("Starting automatic device reset...");

  for (const device of devices) {
    if (isDeviceBookedNow(device.id)) {
      console.log(`Skipping ${device.hwId} — booked until ${new Date(deviceBookings.get(device.id).expiresAt * 1000)}`);
      continue;
    }

    try {
      await resetConfig(device.id);
      await changeWanType(device.id,wan, universalPromptRegex)
      console.log(`Successfully reset device: ${device.hwId}`);
    } catch (err) {
      console.error(`Failed to reset device ${device?.hwId}:`, err.message || err);
    }
  }

  console.log("All devices processed for reset.");
}

// CRON запуск
cron.schedule("47 22 * * *", () => {
  console.log(`[${new Date().toLocaleString()}] Auto-reset triggered by cron`);
  resetAllDevices();
},
{timezone: "Europe/Moscow"
},
);
