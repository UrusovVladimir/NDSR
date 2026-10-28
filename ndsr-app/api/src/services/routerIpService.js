// services/routerIpService.js — адрес роутера в его LAN, заданный порталом.
//
// По умолчанию CFK-контейнер находит роутер сам: шлюз из DHCP LAN роутера
// (changeContainersIp.sh), без DHCP — зашитые 192.168.1.1 / .3 (AP). Если
// адрес роутера знает портал (его поменял «LAN как WAN» или пользователь
// вписал его вручную — у роутера может быть выключен DHCP), портал пишет его
// в контейнер: /etc/ndsr/router-ip («192.168.2.1/24»). Пока файл есть, скрипт
// контейнера берёт адрес из него (образ ndsr-deploy/device-image; старые
// образы файл не читают). Нет файла — прежнее автоопределение.
//
// Хранится в devices.json (device.routerLanIp, null — авто): файл живёт в
// слое контейнера и пропадает при пересоздании — reconcileRouterIps
// возвращает его (при старте бэкенда и раз в 5 минут).
import { getDeviceById, devices, saveConfig } from '../devices.js';
import { getIO } from '../state/io.js';
import { initializeDockerManager } from './docker.js';
import { containerNameOf } from '../utils/deviceFlags.js';

const FILE = '/etc/ndsr/router-ip';
const isIpv4 = (ip) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(String(ip)) && String(ip).split('.').every(o => Number(o) <= 255);

export const getRouterLanIp = (deviceId) => getDeviceById(deviceId)?.routerLanIp || null;

async function writeContainerFile(device, ip) {
  const name = containerNameOf(device);
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`bad container name ${name}`);
  const cmd = ip
    ? `mkdir -p /etc/ndsr && echo ${ip}/24 > ${FILE}`
    : `rm -f ${FILE}`;
  const dm = await initializeDockerManager();
  const res = await dm.sshManager.executeCommand(`docker exec ${name} sh -c '${cmd}'`);
  if (res.code !== 0) throw new Error(`container ${name}: ${res.stderr || `exit ${res.code}`}`);
}

// ip — IPv4 (подсеть /24) или null — снова автоопределение.
// Сохраняет в devices.json, пишет в контейнер, рассылает device:routerLanIp.
export async function setRouterLanIp(deviceId, ip, { reason = 'manual' } = {}) {
  const device = getDeviceById(deviceId);
  if (!device) throw new Error(`Device ${deviceId} not found`);
  const value = ip ? String(ip).trim() : null;
  if (value && !isIpv4(value)) throw new Error('Router LAN IP must be an IPv4 address, e.g. 192.168.5.1');

  await writeContainerFile(device, value);
  if ((device.routerLanIp || null) !== value) {
    if (value) device.routerLanIp = value;
    else delete device.routerLanIp;
    saveConfig(process.env.DEVICES_CONFIG_PATH, devices);
  }
  console.log(`🏠 ${device.hwId}: router LAN IP ${value || 'auto (DHCP)'} (${reason})`);
  getIO()?.emit('device:routerLanIp', { deviceId: String(device.id), ip: value });
  return value;
}

// Файл в контейнере совпадает с devices.json (контейнер пересоздавали)
let reconciling = false;
export async function reconcileRouterIps() {
  if (reconciling) return;
  reconciling = true;
  try {
    const list = devices.filter(d => d.routerLanIp);
    if (!list.length) return;
    const dm = await initializeDockerManager();
    for (const device of list) {
      const name = containerNameOf(device);
      try {
        const res = await dm.sshManager.executeCommand(`docker exec ${name} cat ${FILE} 2>/dev/null`);
        if (res.stdout.trim() !== `${device.routerLanIp}/24`) {
          await writeContainerFile(device, device.routerLanIp);
          console.log(`🏠 ${device.hwId}: router LAN IP ${device.routerLanIp} restored in container`);
        }
      } catch (err) {
        console.warn(`⚠️ ${device.hwId}: router LAN IP reconcile: ${err.message}`);
      }
    }
  } finally {
    reconciling = false;
  }
}
