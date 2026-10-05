// state/wan.js — текущие WAN-типы устройств: { [deviceId]: { type, ... } }.
// Объект мутируется на месте (delete/присваивание ключей), сам binding
// не переприсваивается — безопасно импортировать напрямую.
export const currentWanTypes = {};
