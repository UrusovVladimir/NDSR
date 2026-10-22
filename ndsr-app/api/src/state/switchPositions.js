// state/switchPositions.js — положение аппаратного переключателя режима у
// устройств с hwType (services/switchPosition.js).
// Формат: { "<deviceId>": { position: "router" | "ap", at: <ms> } }.
// Лежит рядом с devices.json (на стендах — каталог состояния).
import path from 'path';
import { PersistentMap } from '../utils/persistentMap.js';

const defaultPath = path.join(path.dirname(process.env.DEVICES_CONFIG_PATH || './devices.json'), 'switch_positions.json');

export const switchPositions = new PersistentMap(process.env.SWITCH_POSITIONS_PATH || defaultPath);
