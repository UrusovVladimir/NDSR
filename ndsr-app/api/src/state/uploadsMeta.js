// state/uploadsMeta.js — кто и когда загрузил файл в файловый менеджер.
// Формат: { "<имя файла в UPLOAD_DIR>": { uploadedBy: "<ip>", uploadedAt: <ms> } }.
// Лежит рядом с devices.json (на стендах — каталог состояния), а не в
// UPLOAD_DIR: тот же каталог отдаётся по TFTP и показывается списком файлов.
import path from 'path';
import { PersistentMap } from '../utils/persistentMap.js';

const defaultPath = path.join(path.dirname(process.env.DEVICES_CONFIG_PATH || './devices.json'), 'uploads_meta.json');

export const uploadsMeta = new PersistentMap(process.env.UPLOADS_META_PATH || defaultPath);
