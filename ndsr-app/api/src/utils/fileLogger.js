// utils/fileLogger.js — дублирует console.* в файл LOG_DIR/backend.log с ротацией
// по размеру: backend.log → backend.log.1 → … → backend.log.(LOG_MAX_FILES-1),
// самый старый перезаписывается. Без LOG_DIR — только stdout (его ротирует
// docker json-file, см. ndsr-app.yml.j2). Импортируется в server.js сразу
// после loadEnv.js, чтобы перехватить логи всех модулей.
import fs from 'fs';
import path from 'path';
import { format } from 'util';

const LOG_DIR = process.env.LOG_DIR;
const MAX_BYTES = (parseFloat(process.env.LOG_MAX_SIZE_MB) || 10) * 1024 * 1024;
const MAX_FILES = Math.max(1, parseInt(process.env.LOG_MAX_FILES) || 5);
const LOG_FILE = 'backend.log';

const LEVELS = { log: 'INFO', info: 'INFO', warn: 'WARN', error: 'ERROR', debug: 'DEBUG' };

if (LOG_DIR) setupFileLog();

function setupFileLog() {
  const file = path.join(LOG_DIR, LOG_FILE);
  const original = {};
  for (const method of Object.keys(LEVELS)) original[method] = console[method].bind(console);

  let fd;
  let size;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fd = fs.openSync(file, 'a');
    size = fs.fstatSync(fd).size;
  } catch (e) {
    original.error(`📝 File logging disabled (${file}): ${e.message}`);
    return;
  }

  // Сдвиг .1 → .2 → …; renameSync перезаписывает самый старый.
  // При LOG_MAX_FILES=1 текущий файл просто обрезается.
  const rotate = () => {
    fs.closeSync(fd);
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const src = i === 1 ? file : `${file}.${i - 1}`;
      if (fs.existsSync(src)) fs.renameSync(src, `${file}.${i}`);
    }
    fd = fs.openSync(file, 'w');
    size = 0;
  };

  const write = (level, args) => {
    if (fd === null) return;
    const line = `${new Date().toISOString()} ${level} ${format(...args)}\n`;
    const bytes = Buffer.byteLength(line);
    try {
      if (size > 0 && size + bytes > MAX_BYTES) rotate();
      fs.writeSync(fd, line);
      size += bytes;
    } catch (e) {
      // диск/права — отключаемся, не роняя процесс и не зацикливаясь на console.error
      fd = null;
      original.error(`📝 File logging stopped: ${e.message}`);
    }
  };

  for (const [method, level] of Object.entries(LEVELS)) {
    console[method] = (...args) => {
      original[method](...args);
      write(level, args);
    };
  }

  original.log(`📝 File logging: ${file} (max ${MAX_BYTES / 1024 / 1024} MB × ${MAX_FILES} files)`);
}
