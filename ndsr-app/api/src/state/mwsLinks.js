// state/mwsLinks.js — активные MWS-связки экстендер → роутер и IP, на которые
// поставлены DNAT-пробросы. Запись живёт, пока пробросы стоят: создаётся
// после их настройки, удаляется после снятия. Нужна, чтобы снять правило
// контейнера с тем же IP, что ставили, — после рестарта бэкенда DHCP-поиск
// может не найти экстендер, и правило осталось бы висеть.
// Формат файла: { "extenderId": { routerId, routerIp, extenderIp, timestamp } }.
// Путь резолвится от process.cwd(), как у current_modes.json.
import { PersistentMap } from '../utils/persistentMap.js';

export const mwsLinks = new PersistentMap(process.env.MWS_LINKS_PATH || './mws_links.json');

// Ключи — строки: после загрузки из JSON числовые id стали бы строками,
// и get(5) перестал бы находить запись, сохранённую как set(5).
export function saveMwsLink(extenderId, { routerId, routerIp, extenderIp }) {
  mwsLinks.set(String(extenderId), {
    routerId: String(routerId),
    routerIp,
    extenderIp,
    timestamp: Date.now()
  });
}

export function getMwsLink(extenderId) {
  return mwsLinks.get(String(extenderId)) || null;
}

export function dropMwsLink(extenderId) {
  return mwsLinks.delete(String(extenderId));
}
