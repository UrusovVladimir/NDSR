// state/runtime.js — рантайм-флаги сервера (не персистятся).
// Флаг cron отдается только через геттер/сеттер — без let-экспорта.
let cronEnabled = false;

export function getCronStatus() {
  return cronEnabled;
}

export function setCronEnabled(value) {
  cronEnabled = value;
}
