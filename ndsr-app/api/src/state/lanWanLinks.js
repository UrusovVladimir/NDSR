// state/lanWanLinks.js — схема «LAN роутера как WAN» (services/lanWanService.js).
// Ключ — роутер-потребитель (его WAN — LAN другого роутера):
// { "<consumerId>": { upstreamId, vlan, owner, createdAt,
//     lan: null | { original: { ip, mask, pool: { name, begin, end } },
//                   applied:  { ip, mask, pool: { name, begin, end } } } } }
// lan — подсеть потребителя менялась (совпадала с подсетью вышестоящего);
// при разборке возвращается original.
import path from 'path';
import { PersistentMap } from '../utils/persistentMap.js';

const defaultPath = path.join(path.dirname(process.env.DEVICES_CONFIG_PATH || './devices.json'), 'lan_wan_links.json');

export const lanWanLinks = new PersistentMap(process.env.LAN_WAN_LINKS_PATH || defaultPath);
