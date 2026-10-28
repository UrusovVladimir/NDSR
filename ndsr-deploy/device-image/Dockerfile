# Образ CFK-контейнера устройства (Keenetic): Xvfb + XFCE + Firefox ESR под
# noVNC (веб роутера из браузера портала), TFTP для прошивок, скрипты
# changeContainersIp.sh (DHCP в LAN роутера, проброс веба на шлюз) и
# monitorRoutes.sh (маршруты к сетям портала через eth0).
#
# Отличия от образа 78 (docker_image, апрель 2026):
#   - база зафиксирована по дайджесту; пакеты — последние из bookworm
#     (stable получает только исправления безопасности);
#   - noVNC 1.1.0 проверяется по SHA256 (1.4.0 не работал из браузера);
#   - без pulseaudio (звук не используется);
#   - SSH только по ключу: пароль root случайный, вход по паролю выключен.
#     Ключей в образе нет: файл со стенда монтируется в compose на
#     /etc/ndsr/ssh/authorized_keys (README.md), при старте копируется в
#     /root/.ssh с владельцем root. Нет файла — вход по SSH закрыт;
#   - пароль VNC — переменная VNC_PASSWORD (по умолчанию прежний);
#   - Firefox: один процесс контента, ограниченный кэш; сторож закрывает его,
#     если к noVNC FIREFOX_IDLE_MIN минут никто не подключён;
#   - скрипты пишут в лог только изменения (повторы схлопываются), логи
#     ограничены по размеру.
# Контейнеру нужны только NET_ADMIN и NET_RAW (iptables, dhclient, ip route,
# ping) — без privileged (см. ndsr.yaml).
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC \
    VNC_PASSWORD=password \
    FIREFOX_IDLE_MIN=30

ARG NOVNC_VERSION=1.1.0
ARG NOVNC_SHA256=2c63418b624a221a28cac7b9a7efecc092b695fc1b7dd88255b074ab32bc72a7

# Только зеркало Яндекса, IPv4
RUN rm -f /etc/apt/sources.list && \
    rm -rf /etc/apt/sources.list.d/* && \
    echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4 && \
    echo "deb http://mirror.yandex.ru/debian bookworm main contrib non-free" > /etc/apt/sources.list && \
    echo "deb http://mirror.yandex.ru/debian bookworm-updates main contrib non-free" >> /etc/apt/sources.list && \
    echo "deb http://mirror.yandex.ru/debian-security bookworm-security main contrib non-free" >> /etc/apt/sources.list

RUN apt-get update -o Acquire::http::Timeout=30 -o Acquire::ftp::Timeout=30 && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    supervisor \
    openssh-server \
    x11vnc \
    websockify \
    xvfb \
    xfce4 \
    xfce4-terminal \
    net-tools \
    iproute2 \
    iputils-ping \
    iptables \
    isc-dhcp-client \
    dbus-x11 \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    nano \
    atftpd \
    telnet \
    firefox-esr && \
    # pulseaudio и его плагин панели XFCE не нужны (звука нет)
    apt-get purge -y --auto-remove pulseaudio xfce4-pulseaudio-plugin 2>/dev/null || true && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# noVNC с проверкой контрольной суммы
RUN wget -q "https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.tar.gz" -O /tmp/novnc.tar.gz && \
    echo "${NOVNC_SHA256}  /tmp/novnc.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/novnc.tar.gz -C /usr/share/ && \
    mv "/usr/share/noVNC-${NOVNC_VERSION}" /usr/share/novnc && \
    rm /tmp/novnc.tar.gz

# SSH: только по ключу. Пароль root — случайный (никто его не знает)
RUN head -c 32 /dev/urandom | base64 | sed 's/^/root:/' | chpasswd && \
    sed -i -E 's/^#?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && \
    sed -i -E 's/^#?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    sed -i -E 's/^#?KbdInteractiveAuthentication .*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config && \
    mkdir -p /var/run/sshd /root/.ssh && chmod 700 /root/.ssh

RUN mkdir -p /var/run/dbus && \
    dbus-uuidgen > /var/lib/dbus/machine-id && \
    mkdir -p /var/run/supervisor /var/log/supervisor

COPY supervisord.conf /etc/supervisor/
COPY supervisor-services.conf /etc/supervisor/conf.d/

COPY changeContainersIp.sh monitorRoutes.sh setup-firefox.sh firefox-idle-guard.sh ssh-keys.sh /usr/bin/
RUN chmod +x /usr/bin/changeContainersIp.sh /usr/bin/monitorRoutes.sh /usr/bin/setup-firefox.sh /usr/bin/firefox-idle-guard.sh /usr/bin/ssh-keys.sh

RUN mkdir -p /root/.mozilla/firefox && \
    printf '[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default\nIsRelative=1\nPath=default\n' > /root/.mozilla/firefox/profiles.ini

# Страница noVNC; пароль VNC подставляет setup-firefox.sh при старте
COPY index.html /usr/share/novnc/index.html.tpl

RUN mkdir -p /tftp && chmod 777 /tftp

# /etc/ndsr/router-ip — адрес роутера, заданный порталом (changeContainersIp.sh)
RUN mkdir -p /etc/ndsr

EXPOSE 22 5900 6080 69/udp

CMD ["/bin/bash", "-c", "/usr/bin/ssh-keys.sh; /usr/bin/setup-firefox.sh && /usr/bin/supervisord -c /etc/supervisor/supervisord.conf -n"]
