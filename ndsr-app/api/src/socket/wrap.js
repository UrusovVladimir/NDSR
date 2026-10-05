// socket/wrap.js — страховочная обёртка для socket.on-обработчиков.
//
// Что даёт каждому обработчику:
//  1. ack всегда функция: если клиент не передал callback — no-op,
//     обработчик может звать callback(...) без typeof-проверок.
//  2. ack срабатывает один раз: повторный вызов (таймер + успешный ответ,
//     как в getCurrentFW) игнорируется с предупреждением в лог.
//  3. Аргументы выравниваются по арности обработчика: ack всегда
//     последний параметр, даже если клиент прислал меньше аргументов
//     (emit('device:getPassword', cb) → deviceId = undefined, callback = cb).
//     Поэтому у обработчиков не должно быть default/rest-параметров
//     на верхнем уровне — они ломают handler.length.
//  4. Синхронный throw и rejected promise ловятся: лог + ack с ошибкой,
//     если обработчик ещё не ответил. Раньше синхронные обработчики без
//     try/catch (деструктуризация undefined, callback не функция) роняли
//     обработку события, а async — давали unhandled rejection.
//
// Форма ошибки у существующих событий разная, фронт её различает —
// сохраняем через errorShape:
//   'success' (по умолчанию) → { success: false, error, message }
//   'status'                 → { status: 'error', error, message }
//
// Если обработчик ведёт себя по-разному в зависимости от наличия callback,
// проверять нужно callback.provided, а не typeof — typeof теперь всегда 'function'.
//
// Обработчики без ответа (чат, disconnect) регистрируются с { ack: false }:
// аргументы передаются как есть, ошибка только логируется. Без этого флага
// арность не отличает (messageData) от (callback).

const ERROR_SHAPES = {
  success: (msg) => ({ success: false, error: msg, message: msg }),
  status: (msg) => ({ status: 'error', error: msg, message: msg }),
};

export function wrap(event, handler, { errorShape = 'success', ack: hasAck = true } = {}) {
  const buildError = ERROR_SHAPES[errorShape];
  if (!buildError) throw new Error(`wrap(${event}): unknown errorShape "${errorShape}"`);

  const arity = handler.length;

  return function wrappedHandler(...args) {
    const clientAck = typeof args[args.length - 1] === 'function' ? args.pop() : null;

    let acked = false;
    const ack = (...payload) => {
      if (acked) {
        console.warn(`⚠️ [${event}] duplicate ack ignored`);
        return;
      }
      acked = true;
      clientAck?.(...payload);
    };
    // Для событий с запасным каналом (cron:get-status без callback →
    // socket.emit('cron:status')): отличает реальный ack клиента от no-op
    ack.provided = clientAck !== null;

    const fail = (error) => {
      console.error(`❌ [${event}] unhandled error:`, error);
      if (!acked) ack(buildError(error?.message || String(error)));
    };

    let callArgs = args;
    if (hasAck) {
      callArgs = args.slice(0, Math.max(arity - 1, 0));
      while (callArgs.length < arity - 1) callArgs.push(undefined);
      callArgs.push(ack);
    }

    try {
      const result = handler.apply(this, callArgs);
      if (result && typeof result.then === 'function') result.catch(fail);
    } catch (error) {
      fail(error);
    }
  };
}

export function on(socket, event, handler, options) {
  socket.on(event, wrap(event, handler, options));
}
