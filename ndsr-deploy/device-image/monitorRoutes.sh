#!/bin/bash

# Шлюз к сетям портала через eth0: аргумент → CFK_GATEWAY → первый адрес
# подсети eth0 (шлюз docker-сети CFK: 10.10.17.1 на 77, 10.10.20.1 на 78).
# Раньше был зашит 10.10.19.1 — на других стендах маршруты не добавлялись.
eth0_gateway() {
    ip -4 -o addr show eth0 2>/dev/null | awk '{ split($4, a, "/"); split(a[1], o, "."); print o[1] "." o[2] "." o[3] ".1"; exit }'
}
GATEWAY=${1:-${CFK_GATEWAY:-$(eth0_gateway)}}

LOG_FILE=/var/log/monitorRoutes.log
# Лог: одинаковое сообщение — не чаще раза в LOG_REPEAT_SEC (по умолчанию
# 10 мин), новое/изменившееся — сразу; файл не больше LOG_MAX_BYTES (5 МБ,
# одна старая копия .1). Раньше каждые 5–10 с писалось одно и то же — десятки
# МБ в слое контейнера.
LOG_REPEAT_SEC=${LOG_REPEAT_SEC:-600}
LOG_MAX_BYTES=${LOG_MAX_BYTES:-5242880}
declare -A _LOG_SEEN
log() {
    local msg="$1" now last size
    now=$(date +%s)
    last=${_LOG_SEEN["$msg"]:-0}
    if [ $((now - last)) -lt "$LOG_REPEAT_SEC" ]; then return 0; fi
    [ "${#_LOG_SEEN[@]}" -gt 500 ] && _LOG_SEEN=()
    _LOG_SEEN["$msg"]=$now
    size=$(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0)
    [ "$size" -gt "$LOG_MAX_BYTES" ] && mv -f "$LOG_FILE" "$LOG_FILE.1"
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $msg" | tee -a "$LOG_FILE"
    return 0
}

log "Запуск скрипта monitorRoutes.sh"
log "Используемый шлюз: $GATEWAY"

IP_NETWORKS=(10.10.18.0/24 192.168.20.0/24 10.150.18.0/24 10.150.17.0/24 172.16.77.0/24 10.150.19.0/24 172.16.80.0/24 172.16.78.0/24 10.8.1.0/24)

routes_adding() {
    if [[ $# -eq 0 ]]; then
        log "Ошибка: не указаны аргументы для routes_adding"
        return 1
    fi
    
    if [ -z "$GATEWAY" ]; then
        log "Шлюз не указан, пропускаем добавление маршрутов"
        return 1
    fi
    
    log "Используем интерфейс: eth0, шлюз: $GATEWAY"
    
    for argument in "$@"; do
        if ip route add "$argument" via "$GATEWAY" dev eth0 2>/dev/null; then
            log "Добавлен маршрут: $argument via $GATEWAY dev eth0"
        else
            log "Не удалось добавить маршрут: $argument (возможно уже существует)"
        fi
    done
}

log "Мониторинг маршрутов для сетей: ${IP_NETWORKS[*]}"

while true; do
    # Отсутствующие маршруты. Раньше наличие искалось по неполному списку
    # (без 172.16.80/78 и 10.150.19) — эти сети каждые 10 с «отсутствовали»,
    # добавление падало «уже существует», лог рос. Теперь — каждая сеть из
    # IP_NETWORKS через ip route show.
    MISSING_ROUTES=()
    
    for ip in "${IP_NETWORKS[@]}"; do
        if [ -z "$(ip route show "$ip" 2>/dev/null)" ]; then
            MISSING_ROUTES+=("$ip")
            log "Отсутствует маршрут: $ip"
        fi
    done
    
    # Добавляем отсутствующие маршруты
    if [ ${#MISSING_ROUTES[@]} -ne 0 ]; then
        log "Добавляем отсутствующие маршруты: ${MISSING_ROUTES[*]}"
        routes_adding "${MISSING_ROUTES[@]}"
    else
        log "Все маршруты присутствуют"
    fi
    
    sleep 10
done
