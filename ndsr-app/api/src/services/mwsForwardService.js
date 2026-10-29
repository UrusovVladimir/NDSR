// services/mwsForwardService.js — сверка пробросов MWS-связок (экстендер → роутер).
//
// Веб подключённого экстендера открывается через порт = его id
// (http://<стенд>:<id>). При подключении (setupPortForwarding,
// mwsConnectionManager) ставятся два правила и запись state/mwsLinks:
//   хост:      nft ip nat PREROUTING  tcp dport <id> dnat to <routerIp>   (CFK роутера)
//   контейнер: iptables nat PREROUTING --dport <id> → <extenderIp>:80      (в CFK роутера)
// Что их ломает:
//   - `nft -f <файл>` с `flush ruleset` (выкатка, пересоздание бэкенда на
//     77/78) стирает правило хоста — порт уходит на статическое правило из
//     файла (собственный CFK экстендера), веб не открывается;
//   - пересоздание CFK роутера стирает правило контейнера;
//   - экстендер не успел получить адрес в DHCP роутера за время подключения
//     (его захватывают в MWS и он перезагружается) — связка пишется с
//     extenderIp: null, правила в контейнере нет; адрес мог и смениться.
//
// reconcileMwsForwards (bootstrap.js: через 30 с после старта, затем раз в 2 минуты):
//   - берёт связки mws_links.json, у которых current_modes = extender_connect
//     к тому же роутеру; ничего не удаляет, кроме правила на прежний адрес
//     экстендера, когда тот сменился;
//   - адрес экстендера — DHCP bindings роутера (по MAC, затем ARP): неизвестен —
//     каждый проход, известен — раз в 10 минут; нашёлся другой — правило в
//     контейнере переставляется, связка перезаписывается;
//   - недостающее правило ставится, только если его нет два прохода подряд —
//     чтобы не вернуть правило, которое прямо сейчас снимает отключение
//     (сначала снимаются правила, затем удаляется запись связки).
import { getParamRouter, getDeviceById } from '../devices.js';
import { currentModes } from '../state/modes.js';
import { deviceBookings } from '../state/bookings.js';
import { mwsLinks, getMwsLink, saveMwsLink, isRealExtenderIp } from '../state/mwsLinks.js';
import { initializeDockerManager } from './docker.js';
import { resolveRouterPassword } from './passwordService.js';
import { IpDiscoveryService } from '../utils/ipDiscovery.js';
import { containerNameOf } from '../utils/deviceFlags.js';
import { fetchMwsMembers, sameMac, assertRciOk } from '../actions/mwsRci.js';
import { makeAuthenticatedRequest } from '../actions/athentication.js';
import { deviceStatusCache } from '../state/statusCache.js';
import { getIO } from '../state/io.js';

const IP_REFRESH_MS = 10 * 60 * 1000;  // известный адрес экстендера — перепроверять
const PASSWORD_RETRY_MS = 10 * 60 * 1000; // подбор пароля роутера — не чаще (защита от блокировки входа)

const isIpv4 = (ip) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(String(ip));
const reEsc = (s) => String(s).replace(/\./g, '\\.');

// «host:2312» / «container:2312» → правила не было на прошлом проходе
let missingBefore = new Set();
const ipCheckedAt = new Map();       // extenderId → время последнего поиска адреса
const passwordTriedAt = new Map();   // routerId → время последнего подбора пароля
let running = false;
const checking = new Set();          // extenderId — идёт ручная проверка (checkMwsForward), сверка его не трогает

// Правило хоста есть: tcp dport <port> … dnat to <ip>[:порт] (подходит и
// ручное правило с iifname)
const hostHasRule = (nftChain, port, ip) =>
  new RegExp(`tcp dport ${port}\\b.*dnat to ${reEsc(ip)}(:\\d+)?\\s*$`, 'm').test(nftChain);

// Правило контейнера есть: -A PREROUTING … --dport <port> … --to-destination <ip>:80
const containerHasRule = (iptablesS, port, ip) =>
  new RegExp(`--dport ${port}\\b.*--to-destination ${reEsc(ip)}:80\\b`, 'm').test(iptablesS);

// Связка всё ещё действует (её не сняли, пока шёл проход)
const stillLinked = (extenderId, routerId) => {
  const mode = currentModes.get(String(extenderId));
  return !!getMwsLink(extenderId) && mode?.mode === 'extender_connect' && String(mode.routerId) === String(routerId);
};

// Адрес экстендера в LAN роутера: сначала сессией, которую портал уже держит,
// без неё — пароль роутера (конфиг → бронь → daily), не чаще PASSWORD_RETRY_MS
async function lookupExtenderIp(link, extender) {
  const find = (password) => IpDiscoveryService.getExtenderIpFromRouter(link.routerId, extender.macAddress, password, 1, 0);
  try {
    return await find(null);
  } catch (err) {
    const last = passwordTriedAt.get(link.routerId) || 0;
    if (Date.now() - last < PASSWORD_RETRY_MS) throw err;
    passwordTriedAt.set(link.routerId, Date.now());
    const owner = deviceBookings.get(String(link.routerId))?.bookedBy || null;
    const password = await resolveRouterPassword(link.routerId, owner);
    return await find(password);
  }
}

// Адрес экстендера неизвестен или пора перепроверить — ищем; сменился —
// снимаем правило на старый адрес (и на запасной IP CFK роутера, который
// ставили прежние версии) и пишем новый в связку. Правило на новый адрес
// поставит проверка контейнера ниже.
async function refreshExtenderIp(dm, extenderId, link, router, extender) {
  const known = isRealExtenderIp(link.extenderIp, { routerIp: link.routerIp, device: extender });
  const since = Date.now() - (ipCheckedAt.get(extenderId) || 0);
  if (known && since < IP_REFRESH_MS) return link;
  if (!extender.macAddress) return link;
  ipCheckedAt.set(extenderId, Date.now());

  let ip;
  try {
    ip = await lookupExtenderIp(link, extender);
  } catch (err) {
    if (!known) console.warn(`⏳ MWS ${extenderId} → ${link.routerId}: extender IP still unknown (${err.message})`);
    return link;
  }
  if (!isRealExtenderIp(ip, { routerIp: link.routerIp, device: extender }) || ip === link.extenderIp) return link;
  if (!stillLinked(extenderId, link.routerId)) return link;

  const container = containerNameOf(router);
  console.warn(`🔧 MWS ${extenderId} → ${link.routerId}: extender IP ${link.extenderIp || 'unknown'} → ${ip}`);
  const stale = [link.extenderIp, link.routerIp].filter(old => old && old !== ip);
  for (const old of stale) await dm.manageContainerFirewall(container, Number(extenderId), old, 'remove');
  saveMwsLink(extenderId, { routerId: link.routerId, routerIp: link.routerIp, extenderIp: ip });
  missingBefore.add(`container:${Number(extenderId)}`); // поставить правило в этом же проходе
  return getMwsLink(extenderId);
}

export async function reconcileMwsForwards() {
  if (running || mwsLinks.size === 0) return;
  running = true;
  const missingNow = new Set();
  try {
    const dm = await initializeDockerManager();
    const ssh = dm.sshManager;

    const nft = await ssh.executeCommand('nft list chain ip nat PREROUTING');
    if (nft.code !== 0) throw new Error(`nft list: ${nft.stderr || `exit ${nft.code}`}`);
    const rulesOf = new Map(); // контейнер роутера → iptables -S PREROUTING

    for (const [extenderId, saved] of [...mwsLinks.entries()]) {
      if (checking.has(String(extenderId))) continue;
      if (!stillLinked(extenderId, saved.routerId)) continue;
      const router = getParamRouter(saved.routerId);
      const extender = getDeviceById(extenderId);
      const port = Number(extenderId);
      if (!router || !extender || !Number.isInteger(port) || !isIpv4(saved.routerIp)) continue;

      if (!hostHasRule(nft.stdout, port, saved.routerIp)) {
        const key = `host:${port}`;
        missingNow.add(key);
        if (missingBefore.has(key) && stillLinked(extenderId, saved.routerId)) {
          console.warn(`🔧 MWS ${extenderId} → ${saved.routerId}: restoring host forward ${port} → ${saved.routerIp}`);
          await dm.manageHostFirewall(port, saved.routerIp, 'setup');
        }
      }

      const container = containerNameOf(router);
      if (!/^[A-Za-z0-9_.-]+$/.test(container)) continue;
      let link;
      try {
        link = await refreshExtenderIp(dm, extenderId, saved, router, extender);
      } catch (err) {
        console.warn(`⚠️ MWS ${extenderId} → ${saved.routerId}: extender IP refresh: ${err.message}`);
        link = saved;
      }
      if (!isRealExtenderIp(link.extenderIp, { routerIp: link.routerIp, device: extender })) continue;

      if (!rulesOf.has(container)) {
        const res = await ssh.executeCommand(`docker exec ${container} iptables -t nat -S PREROUTING`);
        rulesOf.set(container, res.code === 0 ? res.stdout : null); // null — контейнер не запущен
      }
      const rules = rulesOf.get(container);
      if (rules !== null && !containerHasRule(rules, port, link.extenderIp)) {
        const key = `container:${port}`;
        missingNow.add(key);
        if (missingBefore.has(key) && stillLinked(extenderId, link.routerId)) {
          console.warn(`🔧 MWS ${extenderId} → ${link.routerId}: restoring forward in ${container} ${port} → ${link.extenderIp}:80`);
          await dm.manageContainerFirewall(container, port, link.extenderIp, 'setup');
        }
      }
    }
  } catch (err) {
    console.error(`❌ MWS forward reconcile: ${err.message}`);
  } finally {
    missingBefore = missingNow;
    running = false;
  }
}

// ============================================================
// Ручная проверка проброса одного экстендера (кнопка «Check forwarding»
// в портале, событие mws:checkForward). То же, что сверка, но сразу и с
// отчётом по шагам:
//   1. связка: current_modes = extender_connect к роутеру;
//   2. адрес экстендера по MAC: участники MWS на контроллере (если отдают ip) →
//      DHCP bindings роутера → ARP роутера → ARP изнутри CFK роутера (с пингом
//      подсети, если сразу не нашёлся);
//   3. адрес — в mws_links.json (им пользуются снятие правил и сверка);
//   4. правило хоста (dport <id> → CFK роутера) — нет, ставим;
//   5. правило в CFK роутера (dport <id> → <ip>:80): правила этого порта на
//      другие адреса снимаем, нужного нет — ставим;
//   6. доступность: веб экстендера изнутри CFK роутера и через порт портала.
// Возвращает { ok, ip, steps: [{ step, ok, detail }], reachable }.
// ============================================================
const sh = (dm, cmd) => dm.sshManager.executeCommand(cmd);

async function findExtenderIp(dm, router, extender, routerPassword, steps) {
  const mac = extender.macAddress;
  // 2a. контроллер MWS
  try {
    const member = (await fetchMwsMembers(router.URL, routerPassword)).find(m => sameMac(m.mac, mac));
    const ip = member && [member.ip, member.address, member.ipv4, member['ip-address']].find(isIpv4);
    if (member) steps.push({ step: 'controller', ok: true, detail: `MWS member found${ip ? `, IP ${ip}` : ' (no IP in member info)'}` });
    else steps.push({ step: 'controller', ok: false, detail: 'Not a member of the router MWS' });
    if (ip) return ip;
  } catch (err) {
    steps.push({ step: 'controller', ok: false, detail: `MWS member list: ${err.message}` });
  }
  // 2b. DHCP / ARP роутера
  try {
    const ip = await IpDiscoveryService.getExtenderIpFromRouter(router.id, mac, routerPassword, 1, 0);
    if (isIpv4(ip)) {
      steps.push({ step: 'dhcp', ok: true, detail: `Found in router DHCP/ARP: ${ip}` });
      return ip;
    }
  } catch (err) {
    steps.push({ step: 'dhcp', ok: false, detail: `Not in router DHCP/ARP (${err.message})` });
  }
  // 2c. ARP изнутри CFK роутера (контейнер — в LAN роутера)
  const container = containerNameOf(router);
  const neigh = async () => {
    const r = await sh(dm, `docker exec ${container} sh -c "ip neigh show"`);
    const line = (r.stdout || '').split('\n').find(l => sameMac((l.match(/lladdr\s+(\S+)/) || [])[1], mac));
    return line ? line.split(/\s+/)[0] : null;
  };
  let ip = await neigh();
  if (!ip) {
    // Пинг подсети LAN-интерфейса контейнера, чтобы заполнить ARP
    await sh(dm, `docker exec ${container} sh -c 'n=$(ip -4 -o addr show | grep -v " eth0 " | grep -v " lo " | awk "{print \\$4}" | head -1 | cut -d/ -f1 | cut -d. -f1-3); [ -n "$n" ] && for i in $(seq 1 254); do ping -c1 -W1 $n.$i >/dev/null 2>&1 & done; wait' 2>/dev/null`);
    ip = await neigh();
  }
  steps.push(ip
    ? { step: 'arp', ok: true, detail: `Found from the router container (ARP): ${ip}` }
    : { step: 'arp', ok: false, detail: 'Not found in the router LAN by MAC' });
  return isIpv4(ip) ? ip : null;
}

export async function checkMwsForward(extenderId, { userId = null, auto = false } = {}) {
  const id = String(extenderId);
  const steps = [];
  const fail = (step, detail) => { steps.push({ step, ok: false, detail }); return { ok: false, ip: null, reachable: false, steps }; };

  const mode = currentModes.get(id);
  if (mode?.mode !== 'extender_connect' || !mode.routerId) {
    return fail('link', `Not connected to a router (mode: ${mode?.mode || 'unknown'})`);
  }
  const extender = getDeviceById(id);
  const router = getParamRouter(mode.routerId);
  if (!extender || !router) return fail('link', 'Device or router not found in devices.json');
  if (!extender.macAddress) return fail('link', `No macAddress for ${extender.hwId} in devices.json — cannot search by MAC`);
  steps.push({ step: 'link', ok: true, detail: `Connected to ${router.hwId}` });

  if (checking.has(id)) return fail('busy', 'A check for this device is already running');
  checking.add(id);
  try {
    const dm = await initializeDockerManager();
    const container = containerNameOf(router);
    const routerIp = String(router.ip || '').split('/')[0];
    const port = Number(id);

    let routerPassword;
    try {
      const owner = deviceBookings.get(String(router.id))?.bookedBy || userId;
      routerPassword = await resolveRouterPassword(router.id, owner);
    } catch (err) {
      steps.push({ step: 'router', ok: false, detail: `Router login: ${err.message}` });
    }

    const ip = await findExtenderIp(dm, router, extender, routerPassword, steps);
    if (!ip) return { ok: false, ip: null, reachable: false, steps };

    const old = getMwsLink(id);
    // Автопроверка не воскрешает связку, которую тем временем сняло отключение
    if (auto && (!old || !stillLinked(id, router.id))) return fail('link', 'Link was removed during the check');
    saveMwsLink(id, { routerId: String(router.id), routerIp, extenderIp: ip });
    steps.push({ step: 'saved', ok: true, detail: old?.extenderIp && old.extenderIp !== ip ? `Address saved (was ${old.extenderIp})` : 'Address saved' });

    // Автопроверка: связку могли снять, пока шёл поиск — правила не ставим
    const unlinked = () => auto && !stillLinked(id, router.id);
    if (unlinked()) return fail('link', 'Link was removed during the check');

    // Правило хоста
    const nft = await sh(dm, 'nft list chain ip nat PREROUTING');
    if (hostHasRule(nft.stdout || '', port, routerIp)) {
      steps.push({ step: 'host', ok: true, detail: `Host rule ${port} → ${router.hwId} is in place` });
    } else {
      await dm.manageHostFirewall(port, routerIp, 'setup');
      steps.push({ step: 'host', ok: true, detail: `Host rule ${port} → ${router.hwId} created` });
    }

    // Правило в CFK роутера: чужие адреса этого порта — снять, нужного нет — поставить
    if (unlinked()) return fail('link', 'Link was removed during the check');
    const ipt = await sh(dm, `docker exec ${container} iptables -t nat -S PREROUTING`);
    if (ipt.code !== 0) return fail('container', `Router container ${container} is not running`);
    const stale = [...new Set([...(ipt.stdout || '').matchAll(new RegExp(`--dport ${port}\\b.*--to-destination ([0-9.]+):80`, 'g'))]
      .map(m => m[1]).filter(a => a !== ip))];
    for (const a of stale) await dm.manageContainerFirewall(container, port, a, 'remove');
    if (containerHasRule(ipt.stdout || '', port, ip)) {
      steps.push({ step: 'container', ok: true, detail: `Rule ${port} → ${ip}:80 in ${container} is in place${stale.length ? ` (removed old: ${stale.join(', ')})` : ''}` });
    } else {
      await dm.manageContainerFirewall(container, port, ip, 'setup');
      steps.push({ step: 'container', ok: true, detail: `Rule ${port} → ${ip}:80 in ${container} created${stale.length ? ` (removed old: ${stale.join(', ')})` : ''}` });
    }

    // Доступность: из контейнера роутера и через порт портала
    const inLan = await sh(dm, `docker exec ${container} sh -c "curl -s -m4 -o /dev/null -w '%{http_code}' http://${ip}/"`);
    const lanCode = (inLan.stdout || '').trim();
    const lanOk = /^[23]\d\d$|^401$/.test(lanCode);
    steps.push({ step: 'lan', ok: lanOk, detail: lanOk ? `Web of ${extender.hwId} answers in the router LAN (${lanCode})` : `No web answer from ${ip} in the router LAN (${lanCode || 'timeout'})` });

    let portalOk = false;
    if (extender.checkUrl) {
      try {
        const res = await fetch(extender.checkUrl, { signal: AbortSignal.timeout(6000), redirect: 'manual' });
        portalOk = res.status > 0 && res.status < 500;
        steps.push({ step: 'portal', ok: portalOk, detail: `Through the portal port: HTTP ${res.status}` });
      } catch (err) {
        steps.push({ step: 'portal', ok: false, detail: `Through the portal port: ${err.cause?.code || err.message}` });
      }
    }
    let reservation = null;
    if (routerPassword) {
      try {
        reservation = await getDhcpReservation(router, extender.macAddress, routerPassword);
      } catch { /* необязательно для проверки */ }
    }
    console.log(`🔎 MWS ${id} → ${router.id}: ${auto ? 'auto-' : ''}check done, IP ${ip}, LAN ${lanCode || '-'}, portal ${portalOk ? 'ok' : 'fail'}`);
    return { ok: true, ip, reachable: lanOk && (portalOk || !extender.checkUrl), reservation, steps };
  } catch (err) {
    return fail('error', err.message);
  } finally {
    checking.delete(id);
  }
}

// ============================================================
// Резервирование адреса экстендера на роутере (ip dhcp host <mac> <ip>) —
// по решению пользователя (кнопка в окне проверки): схеме может быть нужно,
// чтобы точка получала новый адрес. Синтаксис проверен на 196 (1121), 29.10.2026.
// ============================================================
async function getDhcpReservation(router, mac, routerPassword) {
  const hosts = await makeAuthenticatedRequest(router.URL, 'admin', routerPassword, '/rci/ip/dhcp/host', 'GET');
  const list = Array.isArray(hosts) ? hosts : Object.values(hosts || {});
  return list.find(h => sameMac(h?.mac, mac))?.ip || null;
}

// action: 'set' — закрепить текущий адрес из связки, 'clear' — снять
export async function setDhcpReservation(extenderId, action, { userId = null } = {}) {
  const id = String(extenderId);
  const mode = currentModes.get(id);
  if (mode?.mode !== 'extender_connect' || !mode.routerId) throw new Error('Device is not connected to a router');
  const extender = getDeviceById(id);
  const router = getParamRouter(mode.routerId);
  if (!extender?.macAddress || !router) throw new Error('Device MAC or router not found in devices.json');
  const owner = deviceBookings.get(String(router.id))?.bookedBy || userId;
  const routerPassword = await resolveRouterPassword(router.id, owner);
  const mac = String(extender.macAddress).toLowerCase();

  let cmd;
  if (action === 'set') {
    const ip = getMwsLink(id)?.extenderIp;
    if (!isRealExtenderIp(ip, { routerIp: router.ip, device: extender })) {
      throw new Error('Extender address is unknown — run the port forwarding check first');
    }
    cmd = `ip dhcp host ${mac} ${ip}`;
  } else if (action === 'clear') {
    cmd = `no ip dhcp host ${mac}`;
  } else {
    throw new Error(`Unknown action ${action}`);
  }
  const res = await makeAuthenticatedRequest(router.URL, 'admin', routerPassword, '/rci/', 'POST', [
    { parse: cmd },
    { parse: 'system configuration save' }
  ]);
  assertRciOk(res, cmd);
  const reservation = await getDhcpReservation(router, mac, routerPassword);
  console.log(`📌 MWS ${id} → ${router.id}: ${cmd} (reservation now ${reservation || 'none'})`);
  return { reservation };
}

// ============================================================
// Автопроверка: подключённый экстендер не отвечает (статус ≠ 200) дольше
// AUTO_OFFLINE_MS — та же checkMwsForward, не чаще AUTO_RETRY_MS на
// экстендер. Починила (устройство ответило) — тост владельцу брони
// (mws:forwardAutoFixed). Ручная кнопка остаётся. Запуск — bootstrap.js, раз в 30 с.
// ============================================================
const AUTO_OFFLINE_MS = 60 * 1000;
const AUTO_RETRY_MS = 5 * 60 * 1000;
const autoOfflineSince = new Map();
const autoLastRun = new Map();
let autoRunning = false;

export async function autoCheckOfflineExtenders() {
  if (autoRunning || mwsLinks.size === 0) return;
  autoRunning = true;
  try {
    const now = Date.now();
    for (const [extenderId, link] of [...mwsLinks.entries()]) {
      const id = String(extenderId);
      const online = deviceStatusCache.get(id) === 200;
      if (online || !stillLinked(id, link.routerId)) {
        autoOfflineSince.delete(id);
        continue;
      }
      if (!autoOfflineSince.has(id)) autoOfflineSince.set(id, now);
      if (now - autoOfflineSince.get(id) < AUTO_OFFLINE_MS) continue;
      if (now - (autoLastRun.get(id) || 0) < AUTO_RETRY_MS || checking.has(id)) continue;
      autoLastRun.set(id, now);
      console.log(`🔎 MWS ${id} → ${link.routerId}: not reachable for ${Math.round((now - autoOfflineSince.get(id)) / 1000)} s — auto-check`);
      const result = await checkMwsForward(id, { auto: true });
      if (result.reachable) {
        const owner = deviceBookings.get(id)?.bookedBy || null;
        getIO()?.emit('mws:forwardAutoFixed', { deviceId: id, ip: result.ip, owner,
          steps: result.steps.filter(s => /created|saved|removed/.test(s.detail)).map(s => s.detail) });
        getIO()?.emit('device:status', { deviceId: id, status: 200 });
      }
    }
  } catch (err) {
    console.error(`❌ MWS auto-check: ${err.message}`);
  } finally {
    autoRunning = false;
  }
}
