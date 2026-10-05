// hwType: аппаратный переключатель режима AP. Установлен — после ребута
// устройство вернётся в extender, софтовый переход в router невозможен.
// Конфиги встречали 'yes'/'true'/'1' — принимаем все варианты.
export const isApSwitchOn = (device) =>
  ['true', 'yes', '1'].includes(String(device?.hwType ?? '').toLowerCase())

// rivals: устройство конкурента. Доступны только бронь, статус, VNC и веб —
// никаких операций (питание, сброс, WAN, режимы, консоль, прошивка),
// ночной сброс его не трогает.
export const isRival = (device) =>
  device?.rivals === true || String(device?.rivals ?? '').toLowerCase() === 'true'