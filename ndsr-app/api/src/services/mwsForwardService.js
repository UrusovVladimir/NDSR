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

const IP_REFRESH_MS = 10 * 60 * 1000;  // известный адрес экстендера — перепроверять
const PASSWORD_RETRY_MS = 10 * 60 * 1000; // подбор пароля роутера — не чаще (защита от блокировки входа)

const isIpv4 = (ip) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(String(ip));
const reEsc = (s) => String(s).replace(/\./g, '\\.');

// «host:2312» / «container:2312» → правила не было на прошлом проходе
let missingBefore = new Set();
const ipCheckedAt = new Map();       // extenderId → время последнего поиска адреса
const passwordTriedAt = new Map();   // routerId → время последнего подбора пароля
let running = false;

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
