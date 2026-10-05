// state/consoleUrlCache.js — кэш URL консоли (Moxa) по deviceId, TTL 5 минут
// проверяется в device:getConsoleUrl; чистится при device:reloadConfigs.
export const consoleUrlCache = new Map();
