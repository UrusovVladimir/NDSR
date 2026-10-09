// services/adminService.js — администраторы портала: по IP клиента из
// ADMIN_IPS (через запятую). Читается при каждом вызове — список можно
// поправить в env и перезапустить бэкенд без пересборки.
function adminIps() {
  return new Set(String(process.env.ADMIN_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean));
}

const isAdmin = (ip) => !!ip && adminIps().has(String(ip));

function requireAdmin(socket) {
  if (!isAdmin(socket.clientIp)) {
    throw new Error('Available to portal administrators only.');
  }
}

export { isAdmin, requireAdmin };
