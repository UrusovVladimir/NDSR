// utils/vmNetwork.js — сеть тестовых VM на docker-хосте (по SSH).
//
// LAN-адаптер каждой VM висит на своей port group ESXi с VLAN `vm.vlan`; на
// docker-хосте этому VLAN соответствует сабинтерфейс ndsr-vm<vlan> на trunk-NIC
// (VM_TRUNK_IFACE, в netplan стенда это `int`). Атач = он входит в мост LAN
// устройства — мост, в котором на хосте сидит VLAN `vlanLocal` устройства
// (у CFK-моделей это kn2610 с vlan1904), а если такого нет — мост
// ndsr-lan<vlan>, который создаётся здесь и удаляется с последней VM.
// `ip link set master` не переживает перезагрузку хоста — vmService сверяет
// и восстанавливает связки (reconcile).
//
// RDP: DNAT на хосте `-s <IP владельца брони> --dport <vm.rdpPort>` →
// mgmt-IP VM:3389, метка `ndsr-vm-<id>` в комментарии — по ней правила
// находятся и снимаются без дублей.

// Trunk-NIC хоста. В netplan стенда он описан как `ethernets: int: match: macaddress`
// без set-name — `int` там только id netplan, в системе у интерфейса имя ядра
// (ens160 и т.п.). Поэтому по умолчанию trunk определяется сам — как родитель
// существующих VLAN-интерфейсов хоста (vlan4064@ens160 → ens160).
// VM_TRUNK_IFACE учитывается, только если такое устройство есть.
let trunkCache = null;

async function resolveTrunk(ssh) {
    if (trunkCache) return trunkCache;
    const configured = process.env.VM_TRUNK_IFACE;
    if (configured && SAFE_NAME.test(configured)) {
        const res = await run(ssh, `ip -o link show dev ${configured}`, { allowFail: true });
        if (res.code === 0) return (trunkCache = configured);
    }
    const res = await run(ssh, 'ip -d -o link show type vlan', { allowFail: true });
    const counts = new Map();
    for (const line of res.stdout.split('\n')) {
        const m = line.match(/^\d+:\s+([^@:\s]+)@([^:\s]+):/);
        if (!m || m[1].startsWith('ndsr-')) continue;
        counts.set(m[2], (counts.get(m[2]) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) {
        throw new Error('Cannot detect trunk interface on docker host (no VLAN interfaces) — set VM_TRUNK_IFACE');
    }
    if (configured && configured !== best[0]) {
        console.warn(`⚠️ VM_TRUNK_IFACE=${configured} not found on docker host — using ${best[0]} (parent of existing VLAN interfaces)`);
    }
    assertSafe(best[0], SAFE_NAME, 'trunk interface');
    return (trunkCache = best[0]);
}
const PUBLIC_IFACE = () => process.env.VM_RDP_IN_IFACE || 'internet';

const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;
const SAFE_IP = /^\d{1,3}(\.\d{1,3}){3}$/;

function assertSafe(value, re, what) {
    if (!re.test(String(value))) throw new Error(`Unsafe ${what}: ${value}`);
}

// executeCommand не считает ненулевой код ошибкой — проверяем сами
async function run(ssh, command, { allowFail = false } = {}) {
    const res = await ssh.executeCommand(command);
    if (!allowFail && res.code !== 0) {
        throw new Error(`${command} → exit ${res.code}: ${res.stderr || res.stdout}`);
    }
    return res;
}

function vlanId(vlan) {
    const id = Number(vlan);
    if (!Number.isInteger(id) || id < 1 || id > 4094) throw new Error(`Invalid VLAN: ${vlan}`);
    return id;
}

// Имена ≤ 15 символов (ограничение ядра)
const vlanIfName = (vlan) => `ndsr-vm${vlanId(vlan)}`;
const lanBridgeName = (vlan) => `ndsr-lan${vlanId(vlan)}`;
const lanVlanIfName = (vlan) => `ndsr-l${vlanId(vlan)}`;
const isOwnLanBridge = (name) => /^ndsr-lan\d+$/.test(String(name || ''));

// VLAN-интерфейс с этим id на trunk (любое имя: vlan1904 из netplan и т.п.)
async function findTrunkVlanIf(ssh, vlan) {
    const id = vlanId(vlan);
    const parent = await resolveTrunk(ssh);
    const res = await run(ssh, 'ip -d -o link show type vlan', { allowFail: true });
    for (const line of res.stdout.split('\n')) {
        const m = line.match(/^\d+:\s+([^@:\s]+)@([^:\s]+):/);
        const vid = line.match(/\bvlan protocol 802\.1Q id (\d+)\b/);
        if (!m || !vid || m[2] !== parent || Number(vid[1]) !== id) continue;
        const master = line.match(/\bmaster (\S+)/);
        return { name: m[1], master: master ? master[1] : null };
    }
    return null;
}

// Мост LAN устройства по его vlanLocal: существующий (CFK) или свой ndsr-lan<vlan>
async function ensureLanBridge(ssh, vlan) {
    const existing = await findTrunkVlanIf(ssh, vlan);
    if (existing?.master) return existing.master;

    const bridge = lanBridgeName(vlan);
    const parent = await resolveTrunk(ssh);
    const br = await run(ssh, `ip -o link show dev ${bridge}`, { allowFail: true });
    if (br.code !== 0) await run(ssh, `ip link add name ${bridge} type bridge`);
    await run(ssh, `ip link set dev ${bridge} up`);

    let ifname = existing?.name;
    if (!ifname) {
        ifname = lanVlanIfName(vlan);
        await run(ssh, `ip link add link ${parent} name ${ifname} type vlan id ${vlanId(vlan)}`);
    }
    assertSafe(ifname, SAFE_NAME, 'vlan interface');
    await run(ssh, `ip link set dev ${ifname} up`);
    await run(ssh, `ip link set dev ${ifname} master ${bridge}`);
    return bridge;
}

// Свой мост удаляется, когда в нём не осталось VM (только наш VLAN-интерфейс)
async function cleanupLanBridge(ssh, bridge) {
    if (!isOwnLanBridge(bridge)) return;
    const res = await run(ssh, `ip -o link show master ${bridge}`, { allowFail: true });
    if (res.code !== 0) return;
    const members = res.stdout.split('\n')
        .map(line => line.match(/^\d+:\s+([^@:\s]+)/)?.[1])
        .filter(Boolean);
    if (members.some(name => !/^ndsr-l\d+$/.test(name))) return;
    for (const name of members) await run(ssh, `ip link del dev ${name}`, { allowFail: true });
    await run(ssh, `ip link del dev ${bridge}`, { allowFail: true });
}

async function bridgeExists(ssh, bridge) {
    assertSafe(bridge, SAFE_NAME, 'bridge name');
    const res = await run(ssh, `ip -o link show type bridge dev ${bridge}`, { allowFail: true });
    return res.code === 0 && res.stdout.includes(bridge);
}

// Мост, в котором сейчас сабинтерфейс VM (null — не подключён / не существует)
async function getVlanMaster(ssh, vlan) {
    const ifname = vlanIfName(vlan);
    const res = await run(ssh, `ip -o link show dev ${ifname}`, { allowFail: true });
    if (res.code !== 0) return null;
    const m = res.stdout.match(/\bmaster (\S+)/);
    return m ? m[1] : null;
}

// Сабинтерфейс создаётся по требованию — netplan для VM не нужен
async function ensureVlanIf(ssh, vlan) {
    const ifname = vlanIfName(vlan);
    const parent = await resolveTrunk(ssh);
    const exists = await run(ssh, `ip -o link show dev ${ifname}`, { allowFail: true });
    if (exists.code !== 0) {
        await run(ssh, `ip link add link ${parent} name ${ifname} type vlan id ${vlanId(vlan)}`);
    }
    await run(ssh, `ip link set dev ${ifname} up`);
    return ifname;
}

async function attachVlanToBridge(ssh, vlan, bridge) {
    assertSafe(bridge, SAFE_NAME, 'bridge name');
    const ifname = await ensureVlanIf(ssh, vlan);
    await run(ssh, `ip link set dev ${ifname} master ${bridge}`);
}

// Парковка: вне мостов VLAN VM ни с чем не связан
async function detachVlan(ssh, vlan) {
    const ifname = vlanIfName(vlan);
    const exists = await run(ssh, `ip -o link show dev ${ifname}`, { allowFail: true });
    if (exists.code !== 0) return;
    await run(ssh, `ip link set dev ${ifname} nomaster`);
}

function rdpRuleSpec(vm, clientIp) {
    assertSafe(vm.id, SAFE_NAME, 'vm id');
    assertSafe(vm.mgmtIp, SAFE_IP, 'vm mgmtIp');
    assertSafe(clientIp, SAFE_IP, 'client IP');
    const port = Number(vm.rdpPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid rdpPort: ${vm.rdpPort}`);
    const inIface = PUBLIC_IFACE();
    assertSafe(inIface, SAFE_NAME, 'RDP in interface');
    return `PREROUTING -i ${inIface} -s ${clientIp} -p tcp --dport ${port} ` +
        `-m comment --comment ndsr-vm-${vm.id} -j DNAT --to-destination ${vm.mgmtIp}:3389`;
}

// Все правила VM снимаются (в т.ч. для прежнего владельца), ставится одно
async function setRdpAccess(ssh, vm, clientIp) {
    await removeRdpAccess(ssh, vm);
    await run(ssh, `iptables -t nat -I ${rdpRuleSpec(vm, clientIp)}`);
}

// Снять все RDP-правила VM. На стендах, где в nat PREROUTING есть нативные
// правила nft, `iptables -S` падает («chain is incompatible, use nft»), а nft
// в зависимости от версии показывает правило iptables как «dnat to IP:port»
// или как «xt target "DNAT"» без адреса (и комментарий не показывает).
// Поэтому ищем по порту: RDP-порт выделен VM (vms.json, уникален), любое
// DNAT-правило с этим dport — её. Удаление по handle. Без nft — по метке
// ndsr-vm-<id> из `iptables -S`.
async function removeRdpAccess(ssh, vm) {
    assertSafe(vm.id, SAFE_NAME, 'vm id');
    const port = Number(vm.rdpPort);
    const viaNft = await run(ssh, 'nft -a list chain ip nat PREROUTING', { allowFail: true });
    if (viaNft.code === 0) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid rdpPort: ${vm.rdpPort}`);
        const handles = viaNft.stdout.split('\n')
            .filter(line => line.includes(`dport ${port} `) &&
                (line.includes('dnat to') || line.includes('xt target "DNAT"')))
            .map(line => line.match(/# handle (\d+)\s*$/)?.[1])
            .filter(Boolean);
        for (const handle of handles) {
            await run(ssh, `nft delete rule ip nat PREROUTING handle ${handle}`, { allowFail: true });
        }
        return;
    }
    const res = await run(ssh, `iptables -t nat -S PREROUTING`, { allowFail: true });
    const tag = `--comment ndsr-vm-${vm.id} `;
    const rules = res.stdout.split('\n').filter(line => line.startsWith('-A ') && line.includes(tag));
    for (const rule of rules) {
        await run(ssh, `iptables -t nat ${rule.replace(/^-A /, '-D ')}`, { allowFail: true });
    }
}

async function hasRdpAccess(ssh, vm, clientIp) {
    const res = await run(ssh, `iptables -t nat -C ${rdpRuleSpec(vm, clientIp)}`, { allowFail: true });
    return res.code === 0;
}

export {
    vlanIfName,
    isOwnLanBridge,
    findTrunkVlanIf,
    ensureLanBridge,
    cleanupLanBridge,
    bridgeExists,
    getVlanMaster,
    ensureVlanIf,
    attachVlanToBridge,
    detachVlan,
    setRdpAccess,
    removeRdpAccess,
    hasRdpAccess
};
