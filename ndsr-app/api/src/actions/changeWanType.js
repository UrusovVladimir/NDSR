import {TelnetConnection} from "./telnetClassEthernet.js"
import { getManagmentID } from "./getManagmentID.js";
import {getDeviceById, getVlanId, wanTypes} from "../devices.js";

// Адрес WAN-коммутатора по номеру из SWITCH_WAN_IPs (нумерация с 1)
function wanSwitchAddress(switchId, field) {
    const host = getManagmentID(process.env.SWITCH_WAN_IPs || '')[String(switchId)];
    if (!host) {
        throw new Error(`WAN switch #${switchId} (${field}) is not in SWITCH_WAN_IPs`);
    }
    return host;
}

// Порты WAN устройства могут быть на разных коммутаторах:
//   switchPortWan          — на switchIDWan;
//   switchPortWanSecondary — на switchIDWanSecondary, а если он не задан —
//                            на том же switchIDWan (оба порта на одном свиче).
// Шаги группируются по адресу коммутатора: на один свич — одна telnet-сессия.
//
// Сбой одного свича не останавливает другой: у каждого шага свой результат
// { role: 'wan1'|'wan2', port, host, ok, stage, error }:
//   stage 'connect'   — до свича не достучались, порт не менялся;
//   stage 'configure' — сбой посреди настройки, состояние порта неизвестно;
//   stage 'skipped'   — предыдущий шаг на этом свиче упал, порт не трогали.
// Всё прошло — возвращаются результаты; хоть что-то упало — бросается
// WanSwitchError с теми же results (что реально применено — решает
// вызывающий, см. services/wanService.js applyWanChange).
class WanSwitchError extends Error {
    constructor(results) {
        super(describeWanResults(results));
        this.name = 'WanSwitchError';
        this.results = results;
    }
}

const ROLE_LABEL = { wan1: 'WAN 1', wan2: 'WAN 2' };

function describeWanResults(results) {
    return results.map(r => {
        const where = `${ROLE_LABEL[r.role]} (port ${r.port} @ ${r.host})`;
        if (r.ok) return `${where}: applied`;
        if (r.stage === 'connect') return `${where}: not changed — switch unreachable (${r.error})`;
        if (r.stage === 'skipped') return `${where}: not changed — skipped after previous error`;
        return `${where}: failed during configuration, port state unknown (${r.error})`;
    }).join('; ');
}

async function changeWanType(deviceId, wanData, universalPromptRegex) {
    const isDualWan = wanData && typeof wanData === 'object' && wanData.type === 'dual_wan'
    
    let device = getDeviceById(deviceId);
    let wanVlan = getVlanId();

    // Определяем команды
    let PVID = wanTypes.find(command => command.setting === "onVlanPVID");
    let VLAN = wanTypes.find(command => command.setting === "onVlanFixPort");
    let OFF_VLAN = wanTypes.find(command => command.setting === "offVlanFixPort");
    let OFF_PVID = wanTypes.find(command => command.setting === "offVlanPVID");
    
    if (!OFF_PVID) {
        console.log('⚠️ offVlanPVID не найден, использую onVlanPVID');
        OFF_PVID = PVID;
    }
    
    if (!PVID || !VLAN || !OFF_VLAN) {
        console.error('❌ Не найдены необходимые команды');
        throw new Error('Missing required commands configuration');
    }

    const primaryPort = device.switchPortWan;
    const secondaryPort = device.switchPortWanSecondary;
    const steps = [];

    if (isDualWan) {
        console.log(`🔧 Настройка Dual WAN для устройства ${deviceId}`);
        console.log(`WAN 1: ${wanData.wan1}, WAN 2: ${wanData.wan2}`);
        steps.push({
            role: 'wan1',
            name: `настройки порта ${primaryPort}`,
            run: (c) => configureSingleWan(c, primaryPort, wanData.wan1, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN)
        });
        if (secondaryPort) {
            steps.push({
                role: 'wan2',
                name: `настройки порта ${secondaryPort}`,
                run: (c) => configureSingleWan(c, secondaryPort, wanData.wan2, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN)
            });
        }
    } else {
        if (wanData && wanData !== "4094") {
            steps.push({
                role: 'wan1',
                name: `настройки одиночного WAN`,
                run: (c) => configureSingleWanLegacy(c, device, wanData, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN)
            });
        } else {
            steps.push({
                role: 'wan1',
                name: `отключения WAN`,
                run: (c) => configureWanOffLegacy(c, device, wanVlan, universalPromptRegex, OFF_VLAN, OFF_PVID)
            });
        }
        // Одиночный WAN или выключение — второй порт гасим
        if (secondaryPort) {
            steps.push({
                role: 'wan2',
                name: `отключения порта ${secondaryPort}`,
                run: (c) => configureWanOff(c, secondaryPort, wanVlan, universalPromptRegex, OFF_VLAN, OFF_PVID)
            });
        }
    }

    // Адреса проверяем до первого подключения, чтобы не настроить полдела
    const primaryHost = wanSwitchAddress(device.switchIDWan, 'switchIDWan');
    const secondaryHost = secondaryPort
        ? wanSwitchAddress(device.switchIDWanSecondary || device.switchIDWan,
            device.switchIDWanSecondary ? 'switchIDWanSecondary' : 'switchIDWan')
        : null;

    const byHost = new Map();
    for (const step of steps) {
        step.host = step.role === 'wan2' ? secondaryHost : primaryHost;
        step.port = step.role === 'wan2' ? secondaryPort : primaryPort;
        if (!byHost.has(step.host)) byHost.set(step.host, []);
        byHost.get(step.host).push(step);
    }

    const results = [];
    const record = (step, ok, stage = null, error = null) =>
        results.push({ role: step.role, port: step.port, host: step.host, ok, stage, error });

    for (const [host, hostSteps] of byHost) {
        console.log(`🔌 WAN-коммутатор ${host}: ${hostSteps.map(s => s.name).join(', ')}`);
        const connection = new TelnetConnection(host, process.env.SWITCH_LOGIN, process.env.SWITCH_PASSWORD);
        try {
            await connection.connect();
        } catch (error) {
            console.error(`❌ WAN-коммутатор ${host} недоступен: ${error.message}`);
            hostSteps.forEach(step => record(step, false, 'connect', error.message));
            continue;
        }
        let failed = false;
        try {
            for (const step of hostSteps) {
                if (failed) {
                    record(step, false, 'skipped');
                    continue;
                }
                try {
                    await executeWithReconnect(connection, () => step.run(connection), step.name);
                    record(step, true);
                } catch (error) {
                    console.error(`❌ Ошибка ${step.name} на ${host}:`, error.message);
                    record(step, false, 'configure', error.message);
                    failed = true;
                }
            }
        } finally {
            console.log(`Завершаем соединение с коммутатором ${host}`);
            try {
                await connection.executeCommand("exit", null, universalPromptRegex);
            } catch (e) {}
            try {
                await connection.end();
            } catch (e) {}
        }
    }

    // Порядок как в шагах: WAN 1, затем WAN 2
    results.sort((a, b) => a.role.localeCompare(b.role));
    if (results.some(r => !r.ok)) {
        const error = new WanSwitchError(results);
        console.error(`❌ WAN ${deviceId}: ${error.message}`);
        throw error;
    }
    return results;
}

// ✅ УНИВЕРСАЛЬНАЯ ФУНКЦИЯ ДЛЯ ВЫПОЛНЕНИЯ С ПЕРЕПОДКЛЮЧЕНИЕМ
async function executeWithReconnect(connection, operationFn, operationName) {
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
        try {
            attempts++;
            console.log(`🔄 Попытка ${attempts}/${maxAttempts} ${operationName}`);
            await operationFn();
            console.log(`✅ ${operationName} успешно завершена`);
            return;
        } catch (error) {
            console.error(`❌ Ошибка ${operationName} (попытка ${attempts}):`, error.message);
            
            if (error.message === 'RECONNECTED' && attempts < maxAttempts) {
                console.log(`🔄 Переподключение выполнено, повторяем ${operationName}...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }
            
            throw error;
        }
    }
}

// ✅ ФУНКЦИЯ ДЛЯ НАСТРОЙКИ ОДНОГО WAN (упрощенная версия для Dual WAN)
async function configureSingleWan(connection, port, vlanId, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN) {
    console.log(`🔧 Настройка порта ${port} на VLAN ${vlanId}`);
    
    let selectedWanTypes = wanTypes.filter(wan => String(wan.vlanId) === String(vlanId));
    let selectedWanType = selectedWanTypes[0];
    
    if (!selectedWanType) {
        throw new Error(`WAN type with VLAN ${vlanId} not found`);
    }
    
    let vlan = selectedWanType.vlanId;
    
    // Шаг 1: Вход в режим конфигурации
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    // Шаг 2: Очистка порта от всех VLAN
    for (let cmd of OFF_VLAN.commands) {
        for (let wan of wanVlan) {
            try {
                await connection.executeCommand("vlan", wan, universalPromptRegex);
                await connection.executeCommand(cmd, port, universalPromptRegex);
                await connection.executeCommand("exit", null, universalPromptRegex);
            } catch (error) {
                console.warn(`⚠️ Ошибка очистки VLAN ${wan}: ${error.message}`);
            }
        }
    }
    
    // Шаг 3: Настройка PVID
    for (let cmd of PVID.commands) {
        await connection.executeCommand(
            cmd, 
            cmd === 'interface port-channel' ? port : (cmd === 'pvid' ? vlan : null), 
            universalPromptRegex
        );
    }
    
    // Шаг 4: Активация порта
    await connection.executeCommand("no inactive", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    
    // Пауза для стабилизации
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Шаг 5: Повторный вход для настройки VLAN
    await connection.executeCommand('configure', null, universalPromptRegex);
    await connection.executeCommand("vlan", vlan, universalPromptRegex);
    
    // Шаг 6: fixed + untagged
    for (let cmd of VLAN.commands) {
        await connection.executeCommand(cmd, port, universalPromptRegex);
        console.log(`✅ ${cmd} ${port}`);
    }
    
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    
    console.log(`✅ Порт ${port} настроен: PVID=${vlan}, fixed+untagged`);
}

// ✅ ФУНКЦИЯ ДЛЯ ОДИНОЧНОГО WAN (сохраняем оригинальную логику)
async function configureSingleWanLegacy(connection, device, wanData, wanVlan, universalPromptRegex, PVID, VLAN, OFF_VLAN) {
    let selectedWanTypes = wanTypes.filter(wan => String(wan.vlanId) === String(wanData));
    let selectedWanType = selectedWanTypes[0];
    
    if (!selectedWanType) {
        throw new Error(`WAN type with VLAN ${wanData} not found`);
    }
    
    console.log("Выбрано", selectedWanType.type, "VLAN:", selectedWanType.vlanId);
    
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    // Очищаем порт от всех VLAN
    for (let cmd of OFF_VLAN.commands) {
        for (let wan of wanVlan) {
            await connection.executeCommand("vlan", wan, universalPromptRegex);
            await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
            await connection.executeCommand("exit", null, universalPromptRegex);
        }
    }
    
    let vlan = selectedWanType.vlanId;
    
    // Настраиваем PVID
    for (let cmd of PVID.commands) {
        await connection.executeCommand(cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? vlan : null), universalPromptRegex);
    }
    
    await connection.executeCommand("no inactive", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
    
    // Заново входим в configure для VLAN
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    // Настраиваем VLAN
    await connection.executeCommand("vlan", vlan, universalPromptRegex);
    for (let cmd of VLAN.commands) {
        await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
    }
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
}

// ✅ ФУНКЦИЯ ДЛЯ ВЫКЛЮЧЕНИЯ WAN (сохраняем оригинальную логику)
async function configureWanOffLegacy(connection, device, wanVlan, universalPromptRegex, OFF_VLAN, PVID) {
    console.log(`Выключение WAN для устройства`);
    
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    // Очищаем порт от всех VLAN
    for (let cmd of OFF_VLAN.commands) {
        for (let wan of wanVlan) {
            await connection.executeCommand("vlan", wan, universalPromptRegex);
            await connection.executeCommand(cmd, device.switchPortWan, universalPromptRegex);
            await connection.executeCommand("exit", null, universalPromptRegex);
        }
    }
    
    let fakeVlan = "4094";
    for (let cmd of PVID.commands) {
        await connection.executeCommand(cmd, cmd === 'interface port-channel' ? device.switchPortWan : (cmd === 'pvid' ? fakeVlan : null), universalPromptRegex);
    }
    
    await connection.executeCommand("inactive", null, universalPromptRegex);
    console.log(`✅ Порт ${device.switchPortWan} деактивирован`);
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
}

// Отключение WAN порта
async function configureWanOff(connection, port, wanVlan, universalPromptRegex, OFF_VLAN, PVID) {
    console.log(`🔧 Отключение порта ${port}`);
    
    let fakeVlan = "4094";
    
    await connection.executeCommand('configure', null, universalPromptRegex);
    
    for (let cmd of OFF_VLAN.commands) {
        for (let wan of wanVlan) {
            try {
                await connection.executeCommand("vlan", wan, universalPromptRegex);
                await connection.executeCommand(cmd, port, universalPromptRegex);
                await connection.executeCommand("exit", null, universalPromptRegex);
            } catch (error) {
                console.warn(`⚠️ Ошибка очистки VLAN ${wan}: ${error.message}`);
            }
        }
    }
    
    for (let cmd of PVID.commands) {
        await connection.executeCommand(cmd, cmd === 'interface port-channel' ? port : (cmd === 'pvid' ? fakeVlan : null), universalPromptRegex);
    }
    
    await connection.executeCommand("inactive", null, universalPromptRegex);
    console.log(`✅ Порт ${port} деактивирован`);
    
    await connection.executeCommand("exit", null, universalPromptRegex);
    await connection.executeCommand("exit", null, universalPromptRegex);
}

export {
    changeWanType,
    WanSwitchError
}