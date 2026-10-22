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

// Положение аппаратного переключателя (device.switchPosition, от сервера):
// 'router' — A (Router): к роутеру по MWS не подключить, сначала переключить
// в B; 'ap' — B (Access point); null — ещё не определялось.
export const SWITCH_A_HINT =
  'The hardware mode switch is in position A (Router) — the device works as a router. ' +
  'To connect it to a router via MWS, first move the switch to position B (Access point) ' +
  'and wait until the device reboots.'

export const isSwitchInRouterPosition = (device) =>
  isApSwitchOn(device) && device?.switchPosition === 'router'

// Тег «HW switch» у имени устройства: { value, severity, tooltip }
export const hwSwitchTag = (device) => {
  if (device?.switchPosition === 'router') {
    return { value: 'HW switch: A · Router', severity: 'warning', tooltip: SWITCH_A_HINT }
  }
  if (device?.switchPosition === 'ap') {
    return {
      value: 'HW switch: B · AP',
      severity: 'info',
      tooltip: 'The hardware mode switch is in position B (Access point). The mode cannot be changed ' +
        'from the portal; connect the device to a router with MWS Connect.'
    }
  }
  return {
    value: 'HW switch',
    severity: 'secondary',
    tooltip: 'Hardware mode switch: A — Router, B — Access point. The position is not detected yet — ' +
      'it is checked on Refresh mode and before MWS Connect. MWS Connect needs position B.'
  }
}
