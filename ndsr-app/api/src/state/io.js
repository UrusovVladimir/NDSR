// state/io.js — единственная точка доступа к socket.io для контрактных
// эмиттеров (emitBookingUpdate/emitPasswordUpdate) и фоновых задач.
// io НЕ экспортируется как let-binding (ловушка live-binding devices.js) —
// только setIO/getIO. До первого setIO() getIO() возвращает null —
// эквивалент прежнего globalIO = null (эмиттеры глотали через ?.).
let ioInstance = null;

export function setIO(io) {
  ioInstance = io;
}

export function getIO() {
  return ioInstance;
}