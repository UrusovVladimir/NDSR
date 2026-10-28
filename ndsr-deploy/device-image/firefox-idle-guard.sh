#!/bin/bash
# firefox-idle-guard.sh — закрывает Firefox, если к noVNC (websockify :6080)
# и к VNC (:5900 напрямую) FIREFOX_IDLE_MIN минут никто не подключён.
# Открытый через VNC и брошенный Firefox держал в контейнере до 1,3 ГБ памяти.
# Пишет в лог только когда закрывает.
IDLE_MIN=${FIREFOX_IDLE_MIN:-30}
idle_since=$(date +%s)

while true; do
    sleep 60
    # Внешние клиенты: noVNC (браузер) и прямой VNC; связь websockify→x11vnc
    # (localhost) не считаем
    clients=$(ss -Htn state established '( sport = :6080 or sport = :5900 )' 2>/dev/null \
        | awk '$4 !~ /^127\.0\.0\.1:/ && $4 !~ /^\[::1\]:/' | wc -l)
    now=$(date +%s)
    if [ "$clients" -gt 0 ]; then
        idle_since=$now
        continue
    fi
    if [ $((now - idle_since)) -ge $((IDLE_MIN * 60)) ] && pgrep -x firefox-esr >/dev/null 2>&1; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') - no VNC clients for ${IDLE_MIN} min — closing Firefox"
        pkill -TERM -x firefox-esr
        sleep 10
        pkill -KILL -x firefox-esr 2>/dev/null
        idle_since=$now
    fi
done
