// utils/clientIp.js — IP клиента портала: одинаково для socket.io и HTTP API.
// TRUST_PROXY_HEADERS=true — только за nginx фронта (он ставит X-Real-IP
// = $remote_addr); иначе заголовки подделываются, берём адрес соединения.
const TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS === 'true';

export function resolveClientIp(headers = {}, remoteAddress = null) {
    if (TRUST_PROXY_HEADERS) {
        const xff = headers['x-forwarded-for'];
        return headers['x-real-ip']
            || (xff ? String(xff).split(',')[0].trim() : null)
            || 'unknown';
    }
    return String(remoteAddress || '').replace(/^::ffff:/, '') || 'unknown';
}
