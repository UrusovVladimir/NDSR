// actions/mwsRci.js — RCI-помощники MWS (роутер — контроллер, экстендер —
// кандидат/участник). Отдельный модуль: нужен и changeModeType.js, и
// utils/disconnectManager.js (друг друга они импортировать не могут).
//
// Жизненный цикл экстендера у контроллера: show/mws/candidate (виден, ещё не
// принят; DISCONNECTED + «access unauthorized» — у экстендера другой пароль)
// → принят → show/mws/member (в конфиге роутера: mws member <mac>). Принятый
// из кандидатов пропадает. Участник MWS не принимает смену режима
// («system mode: execute blocked in MWS member mode») — сначала контроллер
// должен его отпустить: no mws member <mac>.
import { makeAuthenticatedRequest } from './athentication.js';

export const normMac = (mac) => String(mac || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
export const sameMac = (a, b) => normMac(a).length === 12 && normMac(a) === normMac(b);

// show/mws/candidate отдаёт объект ({} без кандидатов, { candidate: [...] |
// {...} }), show/mws/member — массив; приводим всё к массиву записей с mac
export function normalizeMwsList(data, key) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data[key]) return [].concat(data[key]).filter(Boolean);
  if (data.mac) return [data];
  return Object.values(data).flat().filter(c => c && typeof c === 'object' && c.mac);
}
export const normalizeCandidates = (data) => normalizeMwsList(data, 'candidate');

// Кандидат DISCONNECTED с «access unauthorized»: контроллер не может зайти
// на экстендер — у экстендера другой пароль
export const isUnauthorizedCandidate = (c) =>
  String(c?.state || '').toUpperCase() === 'DISCONNECTED' &&
  /unauthori[sz]ed/i.test(JSON.stringify(c || {}));

// Ответ RCI с ошибкой ("status":"error" в любом месте) → throw с текстом
export function assertRciOk(response, what) {
  const text = JSON.stringify(response || {});
  if (!/"status"\s*:\s*"error"/.test(text)) return response;
  const m = text.match(/"message"\s*:\s*"([^"]*)"/);
  throw new Error(`${what}: ${m ? m[1] : text.slice(0, 200)}`);
}

export const isMemberModeBlocked = (error) => /blocked in MWS member mode/i.test(String(error?.message || error || ''));

export async function fetchMwsMembers(routerUrl, routerPassword) {
  const data = await makeAuthenticatedRequest(routerUrl, 'admin', routerPassword, '/rci/show/mws/member', 'GET');
  return normalizeMwsList(data, 'member');
}

export async function findMwsMember(routerUrl, routerPassword, mac) {
  const members = await fetchMwsMembers(routerUrl, routerPassword);
  return members.find(m => sameMac(m.mac, mac)) || null;
}

// Контроллер отпускает участника (убирает mws member <mac> из конфига)
export async function releaseMwsMember(routerUrl, routerPassword, mac) {
  const res = await makeAuthenticatedRequest(routerUrl, 'admin', routerPassword, '/rci/', 'POST', [
    { parse: `no mws member ${String(mac).toLowerCase()}` },
    { parse: 'system configuration save' }
  ]);
  assertRciOk(res, 'no mws member');
}
