import { broadcastDevicesStatus } from './services/statusService.js';
import { sendInitData } from './services/initData.js';
import { startBackgroundTasks, initPasswordSystem } from './bootstrap.js';
import { register as registerAdmin } from './socket/handlers/admin.js';
import { register as registerPower } from './socket/handlers/power.js';
import { register as registerWan } from './socket/handlers/wan.js';
import { register as registerMode } from './socket/handlers/mode.js';
import { register as registerBooking } from './socket/handlers/booking.js';
import { register as registerAccess } from './socket/handlers/access.js';
import { register as registerFirmware } from './socket/handlers/firmware.js';
import { register as registerPasswords } from './socket/handlers/passwords.js';
import { register as registerChat } from './socket/handlers/chat.js';
import { register as registerVm } from './socket/handlers/vm.js';

// 🔒 S4 (light): доверие к заголовкам прокси.
// TRUST_PROXY_HEADERS=true ТОЛЬКО если перед сервером nginx, который
// ПЕРЕЗАПИСЫВАЕТ заголовок (proxy_set_header X-Real-IP $remote_addr;).
// При прямом подключении клиентов заголовкам верить нельзя.
const TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS === 'true';
const VPN_IP_PREFIXES = (process.env.VPN_IP_PREFIXES || '172.16.').split(',');

function resolveClientIp(handshake) {
    if (TRUST_PROXY_HEADERS) {
        const xff = handshake.headers['x-forwarded-for'];
        return handshake.headers['x-real-ip']
            || (xff ? xff.split(',')[0].trim() : null)
            || 'unknown';
    }
    // Прямое подключение: только реальный адрес сокета
    return handshake.address?.replace(/^::ffff:/, '') || 'unknown';
}

startBackgroundTasks();

function setupEvents(socket, io) {
  // 🔒 S4 (light): идентификация клиента через resolveClientIp.
  // При TRUST_PROXY_HEADERS=false заголовкам x-real-ip/x-forwarded-for
  // не доверяем — берём только реальный адрес сокета.
  socket.clientIp = resolveClientIp(socket.handshake);

  // Аудит: подключение из неожиданной подсети
  if (!VPN_IP_PREFIXES.some(p => socket.clientIp.startsWith(p))) {
    console.warn(`⚠️ Client from unexpected subnet: ${socket.clientIp}`);
  }
    
  console.log('🔗 Client connected:', {
    ip: socket.clientIp,
    trustedProxy: TRUST_PROXY_HEADERS,
    headerXRealIp: socket.handshake.headers['x-real-ip'],
    headerXForwardedFor: socket.handshake.headers['x-forwarded-for']
  });
  
  socket.emit('CLIENT_IP', socket.clientIp);

  registerAdmin(socket, io);
  registerPower(socket, io);
  registerWan(socket, io);
  registerMode(socket, io);
  registerBooking(socket, io);
  registerAccess(socket, io);
  registerFirmware(socket, io);
  registerPasswords(socket, io);
  registerChat(socket, io);
  registerVm(socket, io);
}

export {
  sendInitData,
  setupEvents,
  broadcastDevicesStatus,
  initPasswordSystem
}
