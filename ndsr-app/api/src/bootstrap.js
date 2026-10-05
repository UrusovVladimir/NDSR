// bootstrap.js — фоновые задачи сервера. Вызывается явно, импорт ничего не запускает.
import { deviceBookings, loadBookings } from './state/bookings.js';
import { getIO, setIO } from './state/io.js';
import { autoReleaseOldBookings } from './services/bookingService.js';
import { updateDailyPasswords } from './services/passwordService.js';
import { initializeStatusCache, initializeStatusSystem, initializePowerStatus } from './services/statusService.js';
import { initDockerManagerOnStart } from './services/docker.js';
import { scheduleNightlyReset } from './services/nightlyReset.js';
import { reconcileVms } from './services/vmService.js';
import { startBrowserRdp } from './services/browserRdp.js';

let started = false;

// Старт при загрузке модуля socketHandler (как раньше — import-time),
// до initPasswordSystem(io) из server.js. Повторный вызов — no-op.
export function startBackgroundTasks() {
  if (started) return;
  started = true;

  loadBookings();
  initializeStatusSystem();
  initializePowerStatus();
  scheduleNightlyReset();
  startBrowserRdp();

  // Запускаем инициализацию через 2 секунды после старта сервера
  setTimeout(() => {
      initDockerManagerOnStart();
  }, 2000);

  // После автоснятия броней — сверка тестовых VM: отцепить VM от снятых
  // броней, восстановить связки после перезагрузки docker-хоста
  setInterval(() => {
    autoReleaseOldBookings(getIO());
    reconcileVms();
  }, 60 * 1000);
  setTimeout(() => reconcileVms(), 10 * 1000);

  // 🔒 Отладочный вывод бронирований — только при явном включении в .env
  // (раньше шел каждые 30 секунд в логи на весь uptime сервера)
  if (process.env.DEBUG_BOOKINGS === 'true') {
    setInterval(() => console.log('Current bookings:', Array.from(deviceBookings.entries())), 30000);
  }
}

export function initPasswordSystem(io) {
  setIO(io);
  initializeStatusCache()
  updateDailyPasswords();
  setInterval(updateDailyPasswords, 5 * 60 * 1000);
}
