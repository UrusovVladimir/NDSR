// state/vmAttachments.js — какая тестовая VM к какому устройству подключена.
// Формат файла: { "vmId": { deviceId, bridge, attachedBy, attachedAt, ip } }.
// ip — адрес LAN-адаптера VM от DHCP роутера (null — не получен).
// Путь резолвится от process.cwd(), как у current_modes.json.
import { PersistentMap } from '../utils/persistentMap.js';

export const vmAttachments = new PersistentMap(process.env.VM_ATTACHMENTS_PATH || './vm_attachments.json');
