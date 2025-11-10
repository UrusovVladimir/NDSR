#!/usr/bin/env bash
CHECK_ROUTE=($(ip route | awk '{print $1}' | grep -Eo "(10.10.18.0/24|192.168.20.0/24|10.150.18.0/24|10.150.17.0/24|172.16.77.0/24|10.150.19.0/24)"))
IP_NETWORKS=(10.10.18.0/24 192.168.20.0/24 10.150.18.0/24 10.150.17.0/24 172.16.77.0/24 10.150.19.0/24)                                                                                                                                                                                                                        
IP_GATEWAY = ""
routes_adding() {
    if [[ $# -eq 0 ]]; then
        echo "Specify more one argument"
        exit 1
    fi
    for argument in $*; do
        ip route add $argument via $IP_GATEWAY dev eth0
        continue
    done

}

while true; do
    for ip in "${IP_NETWORKS[@]}"; do
        if [[ ! "${CHECK_ROUTE[@]}" =~ "$ip" ]]; then
            routes_adding "$ip" 2>/dev/tty11
        fi
    done
    sleep 3
done














# ----------------------- НОВАЯ ВЕРСИЯ ---------------------------//
#!/bin/bash

GATEWAY=${1:-10.10.19.1}  # Берем шлюз из аргумента или используем по умолчанию

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a /var/log/monitorRoutes.log
}

log "Запуск скрипта monitorRoutes.sh"
log "Используемый шлюз: $GATEWAY"

IP_NETWORKS=(10.10.18.0/24 192.168.20.0/24 10.150.18.0/24 10.150.17.0/24 172.16.77.0/24 10.150.19.0/24)

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
    # Получаем текущие маршруты
    CHECK_ROUTE=($(ip route | awk '{print $1}' | grep -Eo "(10.10.18.0/24|192.168.20.0/24|10.150.18.0/24|10.150.17.0/24|172.16.77.0/24|10.150.19.0/24)"))
    
    # Массив для отсутствующих маршрутов
    MISSING_ROUTES=()
    
    for ip in "${IP_NETWORKS[@]}"; do
        if [[ ! " ${CHECK_ROUTE[@]} " =~ " ${ip} " ]]; then
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