// utils/vmConfig.js — проверка vms.json. Неверные записи отбрасываются с
// понятным сообщением в логе, остальные VM работают. Ошибки видны сразу при
// старте/reloadConfigs, а не при первом Attach.
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ASCII = /^[\x20-\x7E]*$/;

function validateVms(list) {
    if (!Array.isArray(list)) {
        console.error('❌ vms.json: ожидается массив VM — тестовые VM отключены');
        return [];
    }
    const seen = { id: new Map(), vlan: new Map(), mgmtIp: new Map(), rdpPort: new Map() };
    const valid = [];

    list.forEach((vm, index) => {
        const where = `vms.json[${index}]${vm?.id ? ` (${vm.id})` : ''}`;
        const errors = [];
        const vlan = Number(vm?.vlan);
        const rdpPort = Number(vm?.rdpPort);

        if (!vm || typeof vm !== 'object') errors.push('запись не объект');
        else {
            if (!SAFE_ID.test(String(vm.id ?? ''))) errors.push('id: только латиница, цифры, _ . -');
            if (!Number.isInteger(vlan) || vlan < 2 || vlan > 4094) errors.push('vlan: целое 2–4094');
            if (!IPV4.test(String(vm.mgmtIp ?? ''))) errors.push('mgmtIp: IPv4-адрес');
            if (!Number.isInteger(rdpPort) || rdpPort < 1024 || rdpPort > 65535) errors.push('rdpPort: 1024–65535');
            if (!vm.rdpUser) errors.push('rdpUser не задан');
            if (!vm.rdpPassword) errors.push('rdpPassword не задан');
            const nic = vm.lanNic ?? vm.testNic;
            if (nic && !/^[A-Za-z0-9 _.-]+$/.test(nic)) errors.push('lanNic: латиница, цифры, пробел, _ . -');
            if (vm.lanMac && String(vm.lanMac).toLowerCase().replace(/[^0-9a-f]/g, '').length !== 12) {
                errors.push('lanMac: MAC-адрес вида 00:0c:29:bb:d7:e3');
            }
        }

        for (const key of ['id', 'vlan', 'mgmtIp', 'rdpPort']) {
            if (!vm || vm[key] === undefined) continue;
            const value = String(vm[key]);
            if (seen[key].has(value)) errors.push(`${key} ${value} уже занят VM ${seen[key].get(value)}`);
        }

        if (errors.length) {
            console.error(`❌ ${where} пропущена: ${errors.join('; ')}`);
            return;
        }

        if (!vm.lanMac) {
            console.warn(`⚠️ ${where}: нет lanMac (MAC адаптера LAN) — адрес VM в портале не будет показан`);
        }
        // Не критично для RDP-клиента, но guacamole-lite расшифровывает токен как ASCII
        if (!ASCII.test(String(vm.rdpPassword)) || !ASCII.test(String(vm.rdpUser))) {
            console.warn(`⚠️ ${where}: rdpUser/rdpPassword не ASCII — RDP из браузера не войдёт, RDP-клиент будет работать`);
        }

        for (const key of ['id', 'vlan', 'mgmtIp', 'rdpPort']) seen[key].set(String(vm[key]), vm.id);
        valid.push(vm);
    });

    console.log(`🖥️ vms.json: ${valid.length} VM загружено${valid.length !== list.length ? `, ${list.length - valid.length} пропущено` : ''}`);
    return valid;
}

export { validateVms };
