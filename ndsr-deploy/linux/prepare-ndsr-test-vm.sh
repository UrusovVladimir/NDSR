#!/usr/bin/env bash
# prepare-ndsr-test-vm.sh — подготовка Ubuntu VM (24.04–26.04, рабочий стол GNOME)
# для портала NDSR: тестовая VM в LAN устройства. Аналог
# ndsr-deploy/windows/Prepare-NdsrTestVm.ps1.
#
# Запускать в самой VM от root (sudo), один раз:
#   1. Сеть (NetworkManager): адаптер LAN (смотрит в LAN роутера) — DHCP,
#      служебный Mgmt — статический адрес БЕЗ шлюза (never-default).
#   2. RDP: удалённый вход GNOME (gnome-remote-desktop, системный демон):
#      RDP → экран входа GDM → свой сеанс. Пользователям ничего ставить не нужно:
#      mstsc / RDP из браузера портала (Guacamole). xrdp не годится — с GNOME 49
#      (Ubuntu 25.10/26.04) сеанса X11 нет.
#   3. Файрвол ufw: входящий RDP (3389) — только на Mgmt, остальное входящее
#      закрыто (портал адрес VM берёт из DHCP роутера, в VM не ходит).
#   4. Сторож LAN (systemd-служба ndsr-lan-watchdog): когда портал переносит
#      VM в LAN другого устройства или отключает её, линк у гостя не падает и
#      адрес сам не обновится — сторож видит, что шлюза нет / он не отвечает /
#      сменился его MAC, и переподнимает LAN (новый DHCP), не чаще раза в минуту.
#   5. Пользователь для RDP (в группе sudo), сон отключён.
# В конце печатает запись для vms.json (lanNic, lanMac).
#
# MAC сетевых карт — в настройках VM на ESXi (Network adapter 1/2).
# Адаптер LAN подключается к port group VLAN VM (например 4059), Mgmt — к mgmt.
#
# Примеры:
#   sudo ./prepare-ndsr-test-vm.sh --lan-mac 00:0c:29:aa:bb:01 --mgmt-mac 00:0c:29:aa:bb:02 \
#        --mgmt-ip 10.10.41.10 --user user --vm-id vm9 --vlan 4059 --rdp-port 40059
#   sudo ./prepare-ndsr-test-vm.sh --watchdog-only --lan-if ens192
#
# Обязательны --lan-mac, --mgmt-mac, --mgmt-ip (и --user, по умолчанию user).
# --vm-id, --vlan, --rdp-port в VM ничего не настраивают (VLAN задают port group
# в ESXi и docker-хост) — только подставляются в итоговую запись vms.json.
#
# Пароль: --password или запрос с клавиатуры. Только латиница/ASCII — иначе
# RDP из браузера (Guacamole) не войдёт.
set -euo pipefail

LAN_MAC=""
MGMT_MAC=""
MGMT_IP=""
MGMT_PREFIX=24
RDP_USER="user"
RDP_PASSWORD=""
VM_ID="vm9"
VLAN=4059
RDP_PORT=40059
LAN_IF=""
WATCHDOG_ONLY=0

usage() { awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"; exit "${1:-0}"; }
step() { printf '\033[36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --lan-mac) LAN_MAC="${2,,}"; shift 2 ;;
        --mgmt-mac) MGMT_MAC="${2,,}"; shift 2 ;;
        --mgmt-ip) MGMT_IP="$2"; shift 2 ;;
        --mgmt-prefix) MGMT_PREFIX="$2"; shift 2 ;;
        --user) RDP_USER="$2"; shift 2 ;;
        --password) RDP_PASSWORD="$2"; shift 2 ;;
        --vm-id) VM_ID="$2"; shift 2 ;;
        --vlan) VLAN="$2"; shift 2 ;;
        --rdp-port) RDP_PORT="$2"; shift 2 ;;
        --lan-if) LAN_IF="$2"; shift 2 ;;
        --watchdog-only) WATCHDOG_ONLY=1; shift ;;
        -h|--help) usage 0 ;;
        *) echo "Неизвестный параметр: $1" >&2; usage 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || die "запустите через sudo"
command -v nmcli >/dev/null || die "нет nmcli — нужна Ubuntu Desktop (NetworkManager)"

# Имя интерфейса по MAC (ip -o link: «2: ens192: ... link/ether 00:0c:29:..»)
if_by_mac() {
    local mac="${1,,}"
    ip -o link show | awk -v mac="$mac" '{ for (i = 1; i < NF; i++) if ($i == "link/ether" && tolower($(i + 1)) == mac) { sub(":", "", $2); sub("@.*", "", $2); print $2; exit } }'
}
mac_of_if() { cat "/sys/class/net/$1/address" 2>/dev/null; }

# --- Сторож LAN ---
install_watchdog() {
    local nic="$1"
    step "Сторож LAN для $nic (служба ndsr-lan-watchdog)"
    install -d -m 0755 /usr/local/sbin
    cat > /usr/local/sbin/ndsr-lan-watchdog <<'WATCHDOG'
#!/usr/bin/env bash
# ndsr-lan-watchdog — переподнимает LAN (новый DHCP), когда портал NDSR
# перенёс VM в LAN другого устройства или отключил её: адреса нет, шлюз
# не отвечает 2 раза подряд или сменился MAC шлюза. Не чаще раза в минуту.
NIC="${1:?interface}"
CON="ndsr-lan"
fails=0
last_renew=0
last_gw_mac=""
log() { logger -t ndsr-lan-watchdog "$*"; }

renew() {
    log "$1 — renew"
    nmcli connection down "$CON" >/dev/null 2>&1
    nmcli connection up "$CON" >/dev/null 2>&1 || log "nmcli connection up $CON failed"
    last_renew=$(date +%s)
    fails=0
    last_gw_mac=""
}

while true; do
    sleep 10
    reason=""
    ip4=$(ip -4 -o addr show dev "$NIC" scope global 2>/dev/null | awk '{ print $4; exit }')
    gw=$(ip -4 route show default dev "$NIC" 2>/dev/null | awk '{ print $3; exit }')
    if [[ -z "$ip4" ]]; then
        reason="no IPv4 address"
    elif [[ -z "$gw" ]]; then
        reason="no default gateway"
    elif ! ping -c 1 -W 2 -I "$NIC" "$gw" >/dev/null 2>&1; then
        fails=$((fails + 1))
        reason="gateway $gw not answering"
    else
        fails=0
        mac=$(ip neigh show "$gw" dev "$NIC" 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "lladdr") print $(i + 1) }')
        if [[ -n "$last_gw_mac" && -n "$mac" && "$mac" != "$last_gw_mac" ]]; then
            reason="gateway MAC changed $last_gw_mac -> $mac"
        fi
        [[ -n "$mac" ]] && last_gw_mac="$mac"
    fi
    now=$(date +%s)
    if [[ -n "$reason" && $((now - last_renew)) -ge 60 ]]; then
        if [[ "$reason" != gateway*not\ answering || $fails -ge 2 ]]; then
            renew "$reason"
        fi
    fi
done
WATCHDOG
    chmod 0755 /usr/local/sbin/ndsr-lan-watchdog
    cat > /etc/systemd/system/ndsr-lan-watchdog.service <<EOF
[Unit]
Description=NDSR LAN watchdog (renew DHCP on $nic when the portal moves the VM)
After=NetworkManager.service
Wants=NetworkManager.service

[Service]
ExecStart=/usr/local/sbin/ndsr-lan-watchdog $nic
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable ndsr-lan-watchdog.service >/dev/null
    systemctl restart ndsr-lan-watchdog.service
    echo "    журнал: journalctl -t ndsr-lan-watchdog"
}

if [[ $WATCHDOG_ONLY -eq 1 ]]; then
    [[ -n "$LAN_IF" ]] || die "укажите --lan-if (имя адаптера LAN)"
    [[ -e "/sys/class/net/$LAN_IF" ]] || die "нет интерфейса $LAN_IF"
    nmcli -t -f NAME connection show | grep -qx "ndsr-lan" || die "нет подключения ndsr-lan — сначала полная подготовка"
    install_watchdog "$LAN_IF"
    printf '\033[32mГотово. Для vms.json: "lanNic": "%s", "lanMac": "%s"\033[0m\n' "$LAN_IF" "$(mac_of_if "$LAN_IF")"
    exit 0
fi

# --- Проверки ---
for p in LAN_MAC MGMT_MAC MGMT_IP; do
    [[ -n "${!p}" ]] || die "укажите --$(tr '_' '-' <<<"${p,,}") (см. --help)"
done
LAN_IF=$(if_by_mac "$LAN_MAC")
MGMT_IF=$(if_by_mac "$MGMT_MAC")
[[ -n "$LAN_IF" ]] || die "нет адаптера с MAC $LAN_MAC (ip -br link)"
[[ -n "$MGMT_IF" ]] || die "нет адаптера с MAC $MGMT_MAC (ip -br link)"
[[ "$LAN_IF" != "$MGMT_IF" ]] || die "LAN и Mgmt — один и тот же адаптер"
[[ "$RDP_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "--user: латиница в нижнем регистре, цифры, _ -"
if [[ -z "$RDP_PASSWORD" ]]; then
    read -r -s -p "Пароль пользователя $RDP_USER: " RDP_PASSWORD; echo
    read -r -s -p "Ещё раз: " again; echo
    [[ "$RDP_PASSWORD" == "$again" ]] || die "пароли не совпадают"
fi
[[ -n "$RDP_PASSWORD" ]] || die "пустой пароль"
if LC_ALL=C grep -q '[^ -~]' <<<"$RDP_PASSWORD"; then
    die "пароль: только ASCII (иначе RDP из браузера не войдёт)"
fi
echo "    LAN:  $LAN_IF ($LAN_MAC)"
echo "    Mgmt: $MGMT_IF ($MGMT_MAC) -> $MGMT_IP/$MGMT_PREFIX"

# --- 1. Сеть ---
step "Сеть: NetworkManager-подключения ndsr-lan (DHCP) и ndsr-mgmt (статический, без шлюза)"
# Прочие профили на этих адаптерах (автоматические «Wired connection N»)
while IFS=: read -r name dev; do
    if [[ ( "$dev" == "$LAN_IF" || "$dev" == "$MGMT_IF" ) && "$name" != ndsr-* ]]; then
        nmcli connection delete "$name" >/dev/null && echo "    удалён профиль «$name» ($dev)"
    fi
done < <(nmcli -t -f NAME,DEVICE connection show)
for c in ndsr-lan ndsr-mgmt; do nmcli connection delete "$c" >/dev/null 2>&1 || true; done
# Не создавать автопрофили на новых/сменивших VLAN адаптерах
install -d /etc/NetworkManager/conf.d
printf '[main]\nno-auto-default=*\n' > /etc/NetworkManager/conf.d/90-ndsr.conf
nmcli connection add type ethernet con-name ndsr-mgmt ifname "$MGMT_IF" \
    ipv4.method manual ipv4.addresses "$MGMT_IP/$MGMT_PREFIX" ipv4.never-default yes \
    ipv4.ignore-auto-dns yes ipv6.method disabled connection.autoconnect yes >/dev/null
nmcli connection add type ethernet con-name ndsr-lan ifname "$LAN_IF" \
    ipv4.method auto ipv6.method disabled ipv4.dhcp-timeout 30 \
    connection.autoconnect yes connection.autoconnect-retries 0 >/dev/null
systemctl reload NetworkManager || true
nmcli connection up ndsr-mgmt >/dev/null
nmcli connection up ndsr-lan >/dev/null 2>&1 || echo "    ndsr-lan пока без адреса (VM не подключена к устройству) — это нормально"

# --- 2. RDP: удалённый вход GNOME (gnome-remote-desktop) ---
# Не xrdp: с GNOME 49 (Ubuntu 25.10/26.04) сессии X11 нет вовсе — xrdp поднимает
# Xorg, gnome-session через секунду выходит («Window manager exited quickly»).
# gnome-remote-desktop в режиме системного демона («Remote Login», есть и в
# 24.04): RDP → экран входа GDM → свой сеанс Wayland. RDP-учётка (её портал
# передаёт автоматически) = пользователь/пароль ниже; затем вход в GDM тем же
# пользователем.
step "RDP: удалённый вход GNOME (gnome-remote-desktop, system)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq gnome-remote-desktop openssl ufw >/dev/null
command -v grdctl >/dev/null || die "нет grdctl (gnome-remote-desktop)"
systemctl disable --now xrdp xrdp-sesman >/dev/null 2>&1 || true   # занимал бы 3389
GRD_DIR=/var/lib/gnome-remote-desktop/.local/share/gnome-remote-desktop
install -d -o gnome-remote-desktop -g gnome-remote-desktop -m 0700 "$GRD_DIR"
if [[ ! -f "$GRD_DIR/rdp-tls.crt" ]]; then
    openssl req -new -newkey rsa:4096 -days 3650 -nodes -x509 -subj "/CN=$(hostname)" \
        -keyout "$GRD_DIR/rdp-tls.key" -out "$GRD_DIR/rdp-tls.crt" 2>/dev/null
    chown gnome-remote-desktop:gnome-remote-desktop "$GRD_DIR/rdp-tls.key" "$GRD_DIR/rdp-tls.crt"
    chmod 0600 "$GRD_DIR/rdp-tls.key"
fi
grdctl --system rdp set-tls-key "$GRD_DIR/rdp-tls.key" 2>/dev/null
grdctl --system rdp set-tls-cert "$GRD_DIR/rdp-tls.crt" 2>/dev/null
grdctl --system rdp set-credentials "$RDP_USER" "$RDP_PASSWORD" 2>/dev/null
grdctl --system rdp disable-port-negotiation 2>/dev/null   # всегда 3389 (на него DNAT портала)
grdctl --system rdp enable 2>/dev/null
systemctl enable --now gnome-remote-desktop.service >/dev/null
systemctl restart gnome-remote-desktop.service
sleep 2
grdctl --system status 2>/dev/null | grep -E 'Unit status|Status|Port' | sed 's/^/    /'

# --- 3. Файрвол: RDP только на Mgmt ---
step "Файрвол ufw: RDP (3389) только на $MGMT_IF"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow in on "$MGMT_IF" to any port 3389 proto tcp comment 'NDSR RDP (mgmt)' >/dev/null
ufw --force enable >/dev/null
ufw status verbose | sed 's/^/    /'

# --- 4. Сторож LAN ---
install_watchdog "$LAN_IF"

# --- 5. Пользователь, сон ---
step "Пользователь $RDP_USER (sudo) и отключение сна"
if ! id "$RDP_USER" >/dev/null 2>&1; then
    useradd -m -s /bin/bash -G sudo,users "$RDP_USER"
else
    usermod -aG sudo,users "$RDP_USER"
fi
printf '%s:%s\n' "$RDP_USER" "$RDP_PASSWORD" | chpasswd
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true
# GNOME не пускает один и тот же пользователь одновременно на консоль и в RDP —
# автовход на консоли отключаем
if [[ -f /etc/gdm3/custom.conf ]]; then
    sed -i 's/^\s*AutomaticLoginEnable\s*=.*/AutomaticLoginEnable=false/' /etc/gdm3/custom.conf
fi

LAN_MAC_REAL=$(mac_of_if "$LAN_IF")
step "Готово. Запись для vms.json (пароль подставьте сами):"
cat <<EOF
{
  "id": "$VM_ID",
  "name": "Ubuntu-1",
  "os": "Ubuntu 24.04",
  "vlan": $VLAN,
  "mgmtIp": "$MGMT_IP",
  "rdpPort": $RDP_PORT,
  "rdpUser": "$RDP_USER",
  "rdpPassword": "<пароль>",
  "lanNic": "$LAN_IF",
  "lanMac": "$LAN_MAC_REAL"
}
EOF
echo
echo "Вход по RDP: сначала RDP-учётка (портал передаёт её сам), затем экран входа"
echo "GDM — тот же пользователь и пароль. Не держите этого пользователя открытым на"
echo "консоли VM (в ESXi): GNOME не пустит тот же пользователь второй сессией."
echo "Сторож LAN: systemctl status ndsr-lan-watchdog; журнал: journalctl -t ndsr-lan-watchdog"
