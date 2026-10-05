// rivals: true в devices.json — устройство конкурента. Доступны только бронь,
// статус, VNC и веб-интерфейс; остальные действия неактивны, прошивка — N/A.
// Сервер дублирует запрет (api/src/utils/deviceFlags.js).
export const isRival = (device) =>
  device?.rivals === true || String(device?.rivals ?? '').toLowerCase() === 'true'
