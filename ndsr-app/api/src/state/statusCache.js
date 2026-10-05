// state/statusCache.js — кэш HTTP-статусов устройств и метки троттлинга.
// Скалярные флаги свежести — только через функции (без let-экспорта).
export const deviceStatusCache = new Map();
export const lastStatusCheckTime = new Map();
export const lastFirmwareTriggerTime = new Map();

let lastGlobalStatusUpdate = 0;
let statusCacheInitialized = false;

// Отметить обновление кэша (без смены флага инициализации)
export function touchStatusCache(ts = Date.now()) {
  lastGlobalStatusUpdate = ts;
}

// Полный прогон статусов завершён
export function markStatusCacheFresh() {
  statusCacheInitialized = true;
  lastGlobalStatusUpdate = Date.now();
}

// Сброс после перезагрузки конфигов
export function invalidateStatusCache() {
  statusCacheInitialized = false;
  lastGlobalStatusUpdate = 0;
}

export function isStatusCacheFresh(maxAgeMs) {
  return statusCacheInitialized && (Date.now() - lastGlobalStatusUpdate < maxAgeMs);
}
