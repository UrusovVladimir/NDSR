import { getCronStatus } from '../socketHandler.js';
import { Telnet } from "telnet-client";
import { getDeviceById, devices } from "../devices.js";
import cron from "node-cron";

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

  console.log("Starting automatic device reset...");

  for (const device of devices) {
    try {
      await resetConfig(device.id);
      console.log(`Successfully reset device: ${device.hwId}`);
    } catch (err) {
      console.error(`Failed to reset device ${device?.hwId}:`, err.message || err);
    }
  }

  console.log("All devices processed for reset.");
}

// CRON запуск
cron.schedule("00 3 * * *", () => {
  console.log(`[${new Date().toLocaleString()}] Auto-reset triggered by cron`);
  resetAllDevices();
},
{timezone: "Europe/Moscow"
},
);
