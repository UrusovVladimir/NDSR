// services/lanWanService.js — «LAN роутера как WAN»: WAN роутера-потребителя
// (consumer) — LAN другого роутера (upstream). Состояние — state/lanWanLinks.js.
//
// Подключение (applyLanWan):
//   1. оба роутера — брони пользователя, режим router, не конкуренты; без
//      колец (вверх от upstream не должен встретиться consumer);
//   2. подсети LAN сверяются (RCI Bridge0 + пул DHCP); совпадают — у
//      потребителя ставится другая (+1 или вручную), пул DHCP сдвигается.
//      Ответ RCI на смену адреса обычно не доходит (портал ходит к роутеру по
//      старому адресу через CFK-контейнер) — проброс в контейнере
//      переписывается на новый адрес, DHCP контейнера обновляется, результат
//      проверяется уже по новому адресу;
//   3. основной WAN-порт потребителя на WAN-свиче — без тега в vlanLocal
//      вышестоящего, второй WAN-порт — выключен (тип WAN router_lan).
// Цепочки (A ← B ← C) разрешены. Разборка — всей связной схемы, от нижних
// звеньев к верхним (dismantleChainOf): WAN потребителя → 4094, подсеть и пул
// возвращаются (если роутер не сбрасывают), проброс контейнера — тоже.
// Вызывается до снятия брони (вручную, массово, по истечении), до заводского
// сброса, при смене WAN потребителя; reconcile — страховка (бронь пропала).
import { getDeviceById } from '../devices.js';
import { lanWanLinks } from '../state/lanWanLinks.js';
import { currentModes } from '../state/modes.js';
import { deviceBookings } from '../state/bookings.js';
import { getIO } from '../state/io.js';
import { makeAuthenticatedRequest } from '../actions/athentication.js';
import { sessionManager } from '../actions/sessionManager.js';
import { assertRciOk } from '../actions/mwsRci.js';
import { getPasswordCandidates, tryWithPasswords } from './passwordService.js';
import { applyWanChange } from './wanService.js';
import { initializeDockerManager } from './docker.js';
import { containerNameOf, isRival } from '../utils/deviceFlags.js';
import { getRouterLanIp, setRouterLanIp } from './routerIpService.js';

const WAN_OFF = '4094';
const MASK_24 = '255.255.255.0';

// ---------- IPv4 ----------
const ipToInt = (ip) => String(ip).split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const intToIp = (n) => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');
const maskToPrefix = (mask) => ipToInt(mask).toString(2).replace(/0+$/, '').length;
const isIpv4 = (ip) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(String(ip)) && String(ip).split('.').every(o => Number(o) <= 255);
const subnetOf = (ip, mask) => `${intToIp(ipToInt(ip) & ipToInt(mask))}/${maskToPrefix(mask)}`;
const sameSubnet = (a, b) => {
  // Пересечение сетей: сравниваем по более короткой маске
  const prefix = Math.min(maskToPrefix(a.mask), maskToPrefix(b.mask));
  const m = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return ((ipToInt(a.ip) & m) >>> 0) === ((ipToInt(b.ip) & m) >>> 0);
};

// Тот же адрес/пул в другой /24: меняется третий октет, хосты те же
function shiftLan(lan, thirdOctet) {
  const re = (ip) => ip.split('.').map((o, i) => (i === 2 ? String(thirdOctet) : o)).join('.');
  return {
    ip: re(lan.ip),
    mask: MASK_24,
    pool: lan.pool ? { name: lan.pool.name, begin: re(lan.pool.begin), end: re(lan.pool.end) } : null
  };
}

// ---------- граф схемы ----------
export const getLanWanLink = (id) => lanWanLinks.get(String(id)) || null;
const consumersOf = (id) => [...lanWanLinks.entries()]
  .filter(([, l]) => String(l.upstreamId) === String(id)).map(([c]) => c);

// Вверх по цепочке: [id, upstream(id), ...] (с защитой от кольца)
function upstreamChain(id) {
  const chain = [String(id)];
  let cur = getLanWanLink(id);
  while (cur && !chain.includes(String(cur.upstreamId))) {
    chain.push(String(cur.upstreamId));
    cur = getLanWanLink(cur.upstreamId);
  }
  return chain;
}

export const isInLanWanChain = (id) => !!getLanWanLink(id) || consumersOf(id).length > 0;

// Все роутеры связной схемы (вверх и вниз)
function componentOf(id) {
  const seen = new Set();
  const queue = [String(id)];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const link = getLanWanLink(cur);
    if (link) queue.push(String(link.upstreamId));
    queue.push(...consumersOf(cur));
  }
  return [...seen];
}

export function buildLanWanPayload() {
  return [...lanWanLinks.entries()].map(([consumerId, l]) => ({
    consumerId,
    upstreamId: String(l.upstreamId),
    vlan: l.vlan,
    owner: l.owner,
    lanSubnet: l.lan?.applied ? subnetOf(l.lan.applied.ip, l.lan.applied.mask) : (l.lanSubnet || null),
    lanChanged: !!l.lan,
    createdAt: l.createdAt
  }));
}

const broadcast = (io = getIO()) => io?.emit('lanWan:links', buildLanWanPayload());

// ---------- доступ к роутеру ----------
async function devicePassword(deviceId, owner) {
  const device = getDeviceById(deviceId);
  const candidates = getPasswordCandidates(deviceId, owner, {}, 'background');
  if (!candidates.length) throw new Error(`${device?.hwId || deviceId}: password is unknown`);
  const { result, password } = await tryWithPasswords(candidates, async (pw) => {
    await makeAuthenticatedRequest(device.checkUrl, 'admin', pw, '/rci/show/version', 'GET');
    return true;
  });
  if (!result) throw new Error(`${device.hwId}: login failed with all known passwords`);
  return password;
}

const rci = (device, password, endpoint, method = 'GET', body = null) =>
  makeAuthenticatedRequest(device.checkUrl, 'admin', password, endpoint, method, body);

// LAN роутера (Home, Bridge0) и пул DHCP на нём
async function readLan(deviceId, owner) {
  const device = getDeviceById(deviceId);
  const password = await devicePassword(deviceId, owner);
  const addr = await rci(device, password, '/rci/interface/Bridge0/ip/address');
  if (!isIpv4(addr?.address) || !isIpv4(addr?.mask)) {
    throw new Error(`${device.hwId}: cannot read LAN address (Bridge0)`);
  }
  let pool = null;
  try {
    const pools = await rci(device, password, '/rci/ip/dhcp/pool');
    const entry = Object.entries(pools || {}).find(([, p]) => p?.bind?.interface === 'Bridge0' && p?.range)
      || Object.entries(pools || {}).find(([name, p]) => name === '_WEBADMIN' && p?.range);
    if (entry) pool = { name: entry[0], begin: entry[1].range.begin, end: entry[1].range.end };
  } catch (err) {
    console.warn(`⚠️ ${device.hwId}: cannot read DHCP pool: ${err.message}`);
  }
  return { ip: addr.address, mask: addr.mask, subnet: subnetOf(addr.address, addr.mask), pool, password };
}

const publicLan = (lan) => lan && { ip: lan.ip, mask: lan.mask, subnet: lan.subnet || subnetOf(lan.ip, lan.mask), pool: lan.pool };

// ---------- CFK-контейнер роутера ----------
// Веб роутера пробрасывается контейнером на зашитый адрес LAN (192.168.1.1:80),
// адрес контейнера — по DHCP. Подсеть роутера сменилась — проброс на новый
// адрес и новый DHCP-адрес контейнера.
async function retargetContainer(device, fromIp, toIp) {
  const name = containerNameOf(device);
  const port = new URL(device.checkUrl).port;
  if (!/^\d+$/.test(port) || !isIpv4(fromIp) || !isIpv4(toIp)) throw new Error('retargetContainer: bad arguments');
  const script = [
    `LANIF=$(ip -4 route show default | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }')`,
    `[ -n "$LANIF" ] || LANIF=$(ip -o link | awk -F': ' '$2 !~ /^(lo|eth0)/ { sub(/@.*/, "", $2); print $2; exit }')`,
    `iptables -t nat -S PREROUTING | grep -e "--dport ${port} " | grep -e "--to-destination ${fromIp}:80" | sed 's/^-A /-D /' | while read -r rule; do iptables -t nat $rule; done`,
    `iptables -t nat -C PREROUTING -i eth0 -p tcp --dport ${port} -j DNAT --to-destination ${toIp}:80 2>/dev/null || iptables -t nat -I PREROUTING 1 -i eth0 -p tcp --dport ${port} -j DNAT --to-destination ${toIp}:80`,
    `[ -n "$LANIF" ] && { dhclient -r "$LANIF" 2>/dev/null; dhclient -nw "$LANIF" 2>/dev/null; }`,
    `echo "LANIF=$LANIF"`
  ].join('\n');
  const b64 = Buffer.from(script).toString('base64');
  const dm = await initializeDockerManager();
  const res = await dm.ssh.executeCommand(`docker exec ${name} sh -c "$(echo ${b64} | base64 -d)"`);
  if (res.code !== 0) throw new Error(`container ${name}: ${res.stderr || `exit ${res.code}`}`);
  console.log(`🔀 ${name}: web ${port} → ${toIp}:80 (was ${fromIp}), ${res.stdout}`);
}

const isNetworkError = (err) => /timeout|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|socket hang up|network|aborted|ETIMEDOUT/i.test(String(err?.message || err));

// Подсеть и пул LAN роутера: from → to. Ответ на смену адреса не ждём
// (соединение к старому адресу рвётся), проверяем по новому.
async function changeLan(device, password, from, to) {
  const body = [{ parse: `interface Bridge0 ip address ${to.ip} ${to.mask}` }];
  if (to.pool) body.push({ parse: `ip dhcp pool ${to.pool.name} range ${to.pool.begin} ${to.pool.end}` });
  body.push({ parse: 'system configuration save' });
  console.log(`🔀 ${device.hwId}: LAN ${subnetOf(from.ip, from.mask)} → ${subnetOf(to.ip, to.mask)}`);
  try {
    const res = await rci(device, password, '/rci/', 'POST', body);
    assertRciOk(res, `${device.hwId}: LAN change`);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    console.log(`🔀 ${device.hwId}: no RCI answer after the address change (expected): ${err.message}`);
  }
  sessionManager.clearSession(device.checkUrl, 'admin');
  await retargetContainer(device, from.ip, to.ip);
  for (let attempt = 1; attempt <= 12; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const addr = await rci(device, password, '/rci/interface/Bridge0/ip/address');
      if (addr?.address === to.ip) {
        console.log(`✅ ${device.hwId}: LAN is ${to.ip} (attempt ${attempt})`);
        return;
      }
    } catch (err) {
      console.log(`⏳ ${device.hwId}: waiting for LAN ${to.ip} (${attempt}/12): ${err.message}`);
    }
  }
  throw new Error(`${device.hwId}: LAN change to ${to.ip} not confirmed`);
}

// ---------- проверки ----------
function validate(owner, consumerId, upstreamId) {
  const consumer = getDeviceById(consumerId);
  const upstream = getDeviceById(upstreamId);
  if (!consumer || !upstream) throw new Error('Device not found');
  if (String(consumerId) === String(upstreamId)) throw new Error('A router cannot be its own WAN');
  for (const d of [consumer, upstream]) {
    if (d.type !== 'router') throw new Error(`${d.hwId}: only routers can be linked`);
    if (isRival(d)) throw new Error(`${d.hwId}: not available for rival devices`);
    if (deviceBookings.get(String(d.id))?.bookedBy !== owner) throw new Error(`${d.hwId}: book it first`);
    const mode = currentModes.get(String(d.id))?.mode;
    if (mode === 'extender' || mode === 'extender_connect') throw new Error(`${d.hwId} is in extender mode`);
  }
  if (!upstream.vlanLocal) throw new Error(`${upstream.hwId}: vlanLocal (LAN VLAN) is not set in devices.json`);
  if (!consumer.switchPortWan) throw new Error(`${consumer.hwId}: no WAN port (switchPortWan) in devices.json`);
  if (upstreamChain(upstreamId).includes(String(consumerId))) {
    throw new Error(`${consumer.hwId} is upstream of ${upstream.hwId} — that would make a loop`);
  }
  return { consumer, upstream };
}

// Свободный третий октет /24, начиная со следующего после занятых
function suggestLan(consumerLan, upstreamLan) {
  const used = new Set([Number(upstreamLan.ip.split('.')[2])]);
  let octet = Number(consumerLan.ip.split('.')[2]) + 1;
  while (used.has(octet) || octet > 254) octet = octet > 254 ? 1 : octet + 1;
  return shiftLan(consumerLan, octet);
}

// Предпросмотр для окна: подсети и предложение
export async function planLanWan(owner, consumerId, upstreamId) {
  const { consumer, upstream } = validate(owner, consumerId, upstreamId);
  const [lanC, lanU] = await Promise.all([readLan(consumer.id, owner), readLan(upstream.id, owner)]);
  const conflict = sameSubnet(lanC, lanU);
  const extenders = [...currentModes.entries()]
    .filter(([, m]) => m.mode === 'extender_connect' && String(m.routerId) === String(consumer.id)).map(([id]) => id);
  return {
    consumer: { id: String(consumer.id), hwId: consumer.hwId, lan: publicLan(lanC) },
    upstream: { id: String(upstream.id), hwId: upstream.hwId, lan: publicLan(lanU), vlan: String(upstream.vlanLocal) },
    conflict,
    suggestion: conflict ? publicLan({ ...suggestLan(lanC, lanU) }) : null,
    extenders,
    existingUpstreamId: getLanWanLink(consumer.id)?.upstreamId || null
  };
}

// lan: { mode: 'keep' | 'auto' | 'manual', ip? } (manual — /24, хосты пула те же)
export async function applyLanWan(io, owner, consumerId, upstreamId, lan = { mode: 'auto' }) {
  const { consumer, upstream } = validate(owner, consumerId, upstreamId);
  const id = String(consumer.id);

  // Перепривязка к другому роутеру — сначала снять прежнюю связь
  if (getLanWanLink(id)) await teardownLink(io, id, { reason: 'relinked' });

  const [lanC, lanU] = await Promise.all([readLan(id, owner), readLan(upstream.id, owner)]);
  let target = null;
  if (lan.mode === 'manual') {
    if (!isIpv4(lan.ip)) throw new Error('Enter a valid IPv4 address for the router LAN');
    target = shiftLan(lanC, Number(String(lan.ip).split('.')[2]));
    target.ip = lan.ip;
    if (target.pool) {
      const net = (ip) => ip.split('.').slice(0, 3).join('.');
      const host = (ip) => ip.split('.')[3];
      target.pool = { ...target.pool, begin: `${net(lan.ip)}.${host(lanC.pool.begin)}`, end: `${net(lan.ip)}.${host(lanC.pool.end)}` };
    }
    if (sameSubnet(target, lanU)) throw new Error(`${lan.ip}/24 overlaps ${upstream.hwId} LAN ${lanU.subnet}`);
  } else if (sameSubnet(lanC, lanU)) {
    if (lan.mode === 'keep') throw new Error(`${consumer.hwId} and ${upstream.hwId} LANs overlap (${lanC.subnet}) — change the subnet`);
    target = suggestLan(lanC, lanU);
  }
  if (target && target.ip === lanC.ip) target = null;

  if (target) {
    const extenders = [...currentModes.values()].filter(m => m.mode === 'extender_connect' && String(m.routerId) === id);
    if (extenders.length) throw new Error(`${consumer.hwId} has connected extenders — disconnect them before changing its LAN`);
  }

  let lanState = null;
  if (target) {
    const original = { ip: lanC.ip, mask: lanC.mask, pool: lanC.pool };
    // Адрес роутера, который портал держал до смены (null — автоопределение)
    const prevRouterLanIp = getRouterLanIp(id);
    await changeLan(consumer, lanC.password, original, target);
    lanState = { original, applied: target, prevRouterLanIp };
    // Контейнер (образ device-image) берёт адрес роутера из /etc/ndsr/router-ip —
    // и при выключенном у роутера DHCP
    try {
      await setRouterLanIp(id, target.ip, { reason: 'LAN as WAN' });
    } catch (err) {
      console.warn(`⚠️ ${consumer.hwId}: router LAN IP not written to container: ${err.message}`);
    }
  }

  const vlan = String(upstream.vlanLocal);
  try {
    const res = await applyWanChange(io, id, vlan, { stateType: { type: 'router_lan', upstreamId: String(upstream.id), vlan } });
    if (res.status !== 'ok') throw new Error(res.message || 'WAN switch partially configured');
  } catch (err) {
    console.error(`❌ LAN→WAN ${consumer.hwId} ← ${upstream.hwId}: switch failed: ${err.message} — rolling back`);
    try { await applyWanChange(io, id, WAN_OFF); } catch (e) { console.error(`❌ WAN off failed: ${e.message}`); }
    if (lanState) {
      try { await changeLan(consumer, lanC.password, lanState.applied, lanState.original); } catch (e) { console.error(`❌ LAN restore failed: ${e.message}`); }
    }
    throw new Error(`WAN switch configuration failed: ${err.message}`);
  }

  lanWanLinks.set(id, {
    upstreamId: String(upstream.id),
    vlan,
    owner,
    lan: lanState,
    lanSubnet: lanState ? null : lanC.subnet,
    createdAt: Date.now()
  });
  console.log(`🔗 LAN→WAN: ${consumer.hwId} WAN = ${upstream.hwId} LAN (VLAN ${vlan})${lanState ? `, LAN ${subnetOf(lanState.applied.ip, lanState.applied.mask)}` : ''}`);
  broadcast(io);
  return { link: buildLanWanPayload().find(l => l.consumerId === id) };
}

// Одна связь: WAN потребителя выкл., подсеть назад (если роутер не сбрасывают)
export async function teardownLink(io, consumerId, { reason = 'manual', restoreLan = true } = {}) {
  const id = String(consumerId);
  const link = getLanWanLink(id);
  if (!link) return { ok: true };
  const device = getDeviceById(id);
  const errors = [];
  console.log(`🔗 LAN→WAN teardown ${device?.hwId || id} ← ${link.upstreamId} (${reason})`);

  try {
    await applyWanChange(io, id, WAN_OFF);
  } catch (err) {
    errors.push(`WAN off: ${err.message}`);
  }

  if (link.lan && device) {
    const { original, applied } = link.lan;
    try {
      if (restoreLan) {
        const password = await devicePassword(id, link.owner);
        await changeLan(device, password, applied, original);
        await setRouterLanIp(id, link.lan.prevRouterLanIp || null, { reason: 'LAN as WAN dismantled' });
      } else {
        // Роутер сбрасывают — вернётся к заводскому адресу сам; контейнер — назад
        await retargetContainer(device, applied.ip, original.ip);
        await setRouterLanIp(id, null, { reason: 'LAN as WAN dismantled (factory reset)' });
      }
    } catch (err) {
      errors.push(`LAN restore: ${err.message}`);
    }
  }

  lanWanLinks.delete(id);
  broadcast(io);
  if (errors.length) console.error(`❌ LAN→WAN teardown ${id}: ${errors.join('; ')}`);
  return { ok: errors.length === 0, errors };
}

// Вся схема, в которой участвует роутер: нижние звенья первыми.
// resetIds — роутеры, которые сейчас сбросят (их подсеть не возвращаем).
const dismantling = new Map(); // id компонента → promise
export async function dismantleChainOf(io, deviceId, { reason = 'manual', resetIds = [] } = {}) {
  if (!isInLanWanChain(deviceId)) return { ok: true, links: 0 };
  const component = componentOf(deviceId);
  const key = component.slice().sort().join(',');
  if (dismantling.has(key)) return dismantling.get(key);

  const job = (async () => {
    const consumers = component.filter(id => getLanWanLink(id))
      .sort((a, b) => upstreamChain(b).length - upstreamChain(a).length);
    const errors = [];
    for (const id of consumers) {
      const res = await teardownLink(io, id, { reason, restoreLan: !resetIds.map(String).includes(id) });
      if (!res.ok) errors.push(...res.errors.map(e => `${getDeviceById(id)?.hwId || id}: ${e}`));
    }
    console.log(`🔗 LAN→WAN chain of ${deviceId} dismantled (${consumers.length} links, ${reason})`);
    return { ok: errors.length === 0, links: consumers.length, errors };
  })();
  dismantling.set(key, job);
  try { return await job; } finally { dismantling.delete(key); }
}

// Страховка: бронь звена пропала/чужая (не через release/expiry) — разобрать
export async function reconcileLanWan(io) {
  for (const [id, link] of [...lanWanLinks.entries()]) {
    if (!getLanWanLink(id)) continue;
    const ok = [id, link.upstreamId].every(d => deviceBookings.get(String(d))?.bookedBy === link.owner);
    if (!ok) await dismantleChainOf(io, id, { reason: 'booking ended' });
  }
}
