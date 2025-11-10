#!/bin/bash
set -x
MODEL_NAME=$1
PORT=$2

while true; do
arp -e -v >/dev/null 2>&1
sleep 2
NEW_ARP_ADDR=$(arp -n | grep "50:ff:20" | awk '{print $1}')
echo "--------------------NEW_ARP_ADDR-------------------------"
echo $NEW_ARP_ADDR
echo "---------------------------------------------------------"
OLD_ARP_ADDR=$(arp -n | grep "50:ff:20" | awk '{print $1}')
echo "-------------------OLD_ARP_ADDR--------------------------"
echo $OLD_ARP_ADDR
echo "---------------------------------------------------------"

CURRENT_GW=$(ip r | grep -Po "default via \K[\d.]+")
echo "------------------CURRENT_GW-----------------------------"
echo $CURRENT_GW
echo "---------------------------------------------------------"

INT_KEEN=$(ip r | grep -P "default" | grep -Po "${MODEL_NAME}")

echo "-----------------INT_KEEN--------------------------------"
echo $INT_KEEN
echo "---------------------------------------------------------"

if [ ! -z "$OLD_ARP_ADDR" ];then
ping -c 2 -i 0 "$OLD_ARP_ADDR" > /dev/null
RET=$?
fi
if [ $RET == "1" ];then
ip neigh flush all
else
:
fi

  if ([ -z "$NEW_ARP_ADDR" ] || [ "$OLD_ARP_ADDR" != "$NEW_ARP_ADDR" ]) || ([ "$NEW_ARP_ADDR" != "$CURRENT_GW" ] && [ ! -z "$INT_KEEN"  ]); then
    dhclient $MODEL_NAME -r
    ip link set arp off dev $MODEL_NAME
    ip link set arp on dev $MODEL_NAME
    dhclient $MODEL_NAME >/dev/null 2>&1
    sleep 3
    NEW_GW=$(ip r | grep -Po "default via \K[\d.]+")
    sleep 3
    iptables -t nat -D PREROUTING -i eth0 -p tcp --dport ${PORT} -j DNAT --to-destination ${OLD_ARP_ADDR}:80
    NEW_ARP_ADDR=$(arp -n | grep "50:ff:20" | awk '{print $1}')
    iptables -t nat -I PREROUTING 1 -i eth0 -p tcp --dport ${PORT} -j DNAT --to-destination ${NEW_ARP_ADDR}:80
    netfilter-persistent save
  else
    :
  fi
  CURRENT_GW=$NEW_GW

VAR=$(iptables -t nat -S | grep -P "eth0 -p tcp -m tcp --dport ${PORT}" | grep -Po "(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?=[\s|:])")
INT_KEEN=$(ip r | grep -P "default" | grep -Po "${MODEL_NAME}")
if [ -z ${VAR} ] && [ -z ${INT_KEEN} ];then
iptables -t nat -F PREROUTING
iptables -t nat -A PREROUTING -i eth0 -p tcp --dport ${PORT} -j DNAT --to-destination ${NEW_ARP_ADDR}:80
netfilter-persistent save
else
:
fi

done





















# ------------------ НОВАЯ ВРЕСИЯ ------------------------//
#!/bin/bash
set -e
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a /var/log/changeContainersIp.log
}
detect_interface() {
    local preferred_interface=$(ip link show | grep -E "^[0-9]+:" | awk -F: '{print $2}' | tr -d ' ' | grep -oE "^(kn|nc)([0-9]+|[0-9]+_[0-9]+)")
    
    if [ -n "$preferred_interface" ]; then
        echo "$preferred_interface"
        return 0
    fi
    
    return 1
}

MODEL_NAME=$(detect_interface)

if [ -z "$MODEL_NAME" ]; then
    echo "Не удалось определить интерфейс с префиксом kn или nc"
    exit 1
fi

# ИЗВЛЕКАЕМ ПОРТ: убираем kn/nc, берем цифры до _
PORT=$(echo "$MODEL_NAME" | sed 's/^kn//;s/^nc//' | cut -d_ -f1)

# Сохраняем оригинальный порт для логирования
ORIGINAL_PORT="$PORT"

# Удаляем только один последний ноль, если в интерфейсе НЕТ символа _
if [[ "$MODEL_NAME" != *_* ]]; then
    if [[ "$PORT" =~ 0$ ]]; then
        PORT="${PORT%0}"  # Удаляем только один последний ноль
        log "Удален один последний ноль: $ORIGINAL_PORT → $PORT (интерфейс без _)"
    fi
else
    log "Сохранен порт: $PORT (интерфейс содержит _)"
fi

if [ -z "$PORT" ]; then
    echo "Не удалось извлечь порт из интерфейса $MODEL_NAME"
    exit 1
fi

echo "INTERFACE: $MODEL_NAME"
echo "PORT: $PORT"


log "=== Запуск скрипта ==="
log "Автоопределенный интерфейс: $MODEL_NAME"
log "Оригинальный порт: $ORIGINAL_PORT"
log "Финальный порт: $PORT"

if ! ip link show "$MODEL_NAME" >/dev/null 2>&1; then
    log "ОШИБКА: Интерфейс $MODEL_NAME не существует"
    log "Доступные интерфейсы:"
    ip link show | grep -E "^[0-9]+:" | awk -F: '{print $2}' | tee -a /var/log/changeContainersIp.log
    exit 1
fi

clean_iptables_rules() {
    local port=$1
    log "Очистка старых правил для порта $port"
    
    while iptables -t nat -L PREROUTING -n --line-numbers 2>/dev/null | grep -q "dpt:$port"; do
        iptables -t nat -D PREROUTING 1 2>/dev/null || break
    done
}

get_gateway() {
    ip route | grep "default via" | awk '{print $3}' | head -1
}

check_gateway() {
    local gw=$1
    if [ -n "$gw" ]; then
        ping -c 1 -W 2 "$gw" >/dev/null 2>&1
        return $?
    fi
    return 1
}

get_interface_ip() {
    ip addr show "$MODEL_NAME" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1
}

clean_iptables_rules "$PORT"

log "Начальная конфигурация:"
log "Интерфейс: $MODEL_NAME, IP: $(get_interface_ip)"
log "Шлюз по умолчанию: $(get_gateway)"

while true; do
    log "--- Проверка сети ---"
    
    CURRENT_GW=$(get_gateway)
    
    if [ -z "$CURRENT_GW" ]; then
        log "Шлюз не найден"
        clean_iptables_rules "$PORT"
        sleep 30
        continue
    fi
    
    log "Текущий шлюз: $CURRENT_GW"
    log "IP интерфейса $MODEL_NAME: $(get_interface_ip)"
    
    if check_gateway "$CURRENT_GW"; then
        log "Шлюз $CURRENT_GW доступен"
        
        if ! iptables -t nat -L PREROUTING -n 2>/dev/null | grep -q "to:$CURRENT_GW:80"; then
            log "Добавляем правило DNAT для $CURRENT_GW:$PORT"
            clean_iptables_rules "$PORT"
            iptables -t nat -I PREROUTING 1 -i eth0 -p tcp --dport "$PORT" \
                     -j DNAT --to-destination "${CURRENT_GW}:80"
            log "Правило добавлено"
        else
            log "Правило для $CURRENT_GW уже существует"
        fi
        
    else
        log "Шлюз $CURRENT_GW недоступен"
        clean_iptables_rules "$PORT"
    fi
    
    log "Текущие правила DNAT:"
    iptables -t nat -L PREROUTING -n 2>/dev/null | grep -E "dpt:$PORT" | head -3 || log "Правил нет"
    
    sleep 30
done