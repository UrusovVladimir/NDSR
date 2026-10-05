// state/modes.js — сервер = источник правды режимов (контракт §6).
// PersistentMap: автосейв set/delete/clear, автозагрузка в конструкторе.
// ВАЖНО: путь резолвится от process.cwd(), НЕ от файла модуля —
// поведение идентично прежнему (строка та же самая).
import { PersistentMap } from '../utils/persistentMap.js';

export const currentModes = new PersistentMap(process.env.CURRENT_MODES_PATH || './current_modes.json');