// rivals: true в devices.json — устройство конкурента. Доступны только бронь,
// статус, VNC и веб-интерфейс; остальные действия неактивны, прошивка — N/A.
// Сервер дублирует запрет (api/src/utils/deviceFlags.js).
export const isRival = (device) =>
  device?.rivals === true || String(device?.rivals ?? '').toLowerCase() === 'true'

// hwType: аппаратный переключатель режима (AP/extender). Режим задаёт
// физический переключатель — софтовая смена режима невозможна (сервер её
// отклоняет); к роутеру такое устройство подключается через MWS Connect
// (device:mwsConnected), без смены режима. В конфигах встречали
// 'yes'/'true'/'1' — как на сервере (api/src/utils/deviceFlags.js).
export const isApSwitchOn = (device) =>
  ['true', 'yes', '1'].includes(String(device?.hwType ?? '').toLowerCase())

// Устройству доступно MWS-подключение к роутеру через device:mwsConnected
export const canMwsConnectType = (device) => device?.type === 'AP' || isApSwitchOn(device)
