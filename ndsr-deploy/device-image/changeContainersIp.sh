#!/bin/bash
set -e

# Конфигурация резервных шлюзов
BACKUP_GATEWAYS=("192.168.1.3" "192.168.1.1")
# Уменьшенный интервал проверки для быстрой реакции
CHECK_INTERVAL=5  # Уменьшили с 10 до 5 секунд
# Еще более короткий таймаут для ping
PING_TIMEOUT=0.5  # Уменьшили с 1 до 0.5 секунды
# Максимальное количество попыток рестарта DHCP подряд
MAX_DHCP_RESTARTS=2

# ДОБАВЛЕНО: Статический адрес на случай если DHCP не сработает
STATIC_IP="192.168.1.254"
STATIC_NETMASK="24"
STATIC_CIDR="192.168.1.254/24"
PRIMARY_GATEWAY="192.168.1.3"

# ДОБАВЛЕНО: Флаг быстрой проверки 192.168.1.3
FAST_CHECK_INTERVAL=2  # Отдельный интервал для проверки 192.168.1.3
LAST_FAST_CHECK=0

LOG_FILE=/var/log/changeContainersIp.log
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

# Счетчик последовательных рестартов DHCP
DHCP_RESTART_COUNT=0
LAST_DHCP_RESTART_TIME=0
# Для отслеживания состояния
NO_GATEWAY_COUNT=0
GATEWAY_DOWN_COUNT=0

# LAN роутера: интерфейс kn…/nc… (имя сети docker-net-dhcp). Если задан
# WEB_PORT (compose), имя моста может быть любым (kmb420, kn1011gp) — тогда
# берём первый интерфейс, кроме lo и eth0.
detect_interface() {
    local names=$(ip -o link show | awk -F': ' '{print $2}' | cut -d@ -f1)
    local preferred_interface
    if [ -n "$WEB_PORT" ]; then
        preferred_interface=$(echo "$names" | grep -vxE "lo|eth0" | head -1)
    else
        preferred_interface=$(echo "$names" | grep -oE "^(kn|nc)([0-9]+|[0-9]+_[0-9]+)" | head -1)
    fi
    
    if [ -n "$preferred_interface" ]; then
        echo "$preferred_interface"
        return 0
    fi
    
    return 1
}

# Ускоренная проверка шлюза
check_gateway() {
    local gw=$1
    if [ -n "$gw" ]; then
        # Сверхбыстрая проверка - только 1 пинг с очень коротким таймаутом
        ping -c 1 -W $PING_TIMEOUT "$gw" >/dev/null 2>&1
        return $?
    fi
    return 1
}

# УЛЬТРА-быстрая проверка 192.168.1.3 (отдельная функция)
check_primary_gateway_fast() {
    # Проверяем только 192.168.1.3 с минимальным таймаутом
    ping -c 1 -W 0.3 "192.168.1.3" >/dev/null 2>&1
    return $?
}

# НОВАЯ ФУНКЦИЯ: Назначение статического IP адреса
assign_static_ip() {
    log "НАЗНАЧЕНИЕ СТАТИЧЕСКОГО IP: $STATIC_CIDR на интерфейс $MODEL_NAME"
    
    # Сначала удаляем все существующие адреса
    ip addr flush dev "$MODEL_NAME" 2>/dev/null
    
    # Добавляем статический адрес
    if ip addr add "$STATIC_CIDR" dev "$MODEL_NAME"; then
        log "Статический IP $STATIC_CIDR успешно назначен"
        
        # Поднимаем интерфейс
        ip link set "$MODEL_NAME" up
        
        # Даем время интерфейсу подняться
        sleep 1
        
        # Проверяем доступность 192.168.1.3
        if check_primary_gateway_fast; then
            log "Основной шлюз $PRIMARY_GATEWAY доступен"
            
            # Добавляем маршрут по умолчанию
            if ip route add default via "$PRIMARY_GATEWAY" dev "$MODEL_NAME" 2>/dev/null; then
                log "Маршрут по умолчанию через $PRIMARY_GATEWAY добавлен"
                return 0
            else
                log "ОШИБКА: Не удалось добавить маршрут через $PRIMARY_GATEWAY"
                return 1
            fi
        else
            log "Основной шлюз $PRIMARY_GATEWAY недоступен"
            
            # Проверяем резервные шлюзы
            for backup_gw in "${BACKUP_GATEWAYS[@]}"; do
                if [ "$backup_gw" != "$PRIMARY_GATEWAY" ] && check_gateway "$backup_gw"; then
                    log "Используем резервный шлюз: $backup_gw"
                    if ip route add default via "$backup_gw" dev "$MODEL_NAME" 2>/dev/null; then
                        log "Маршрут по умолчанию через $backup_gw добавлен"
                        return 0
                    fi
                fi
            done
            
            log "НИ ОДИН шлюз не доступен"
            return 1
        fi
    else
        log "ОШИБКА: Не удалось назначить статический IP $STATIC_CIDR"
        return 1
    fi
}

# Функция для проверки и добавления default route если нужно
ensure_default_route() {
    local primary_gw=$1
    local current_gw=$2
    
    # Проверяем доступность шлюза
    if ! check_gateway "$primary_gw"; then
        return 1
    fi
    
    # Проверяем наличие default route
    if ip route | grep -q "^default via "; then
        # Проверяем, ведет ли текущий default route к нужному шлюзу
        if [ -n "$current_gw" ] && [ "$current_gw" = "$primary_gw" ]; then
            # Маршрут есть и правильный
            return 0
        else
            log "ИСПРАВЛЕНИЕ МАРШРУТА: ${current_gw:-нет} → $primary_gw"
            ip route del default 2>/dev/null || true
            ip route add default via "$primary_gw" 2>/dev/null
            if [ $? -eq 0 ]; then
                log "Маршрут исправлен: default via $primary_gw"
                return 0
            else
                return 1
            fi
        fi
    else
        # Добавляем default route
        log "ДОБАВЛЕНИЕ МАРШРУТА: через $primary_gw"
        ip route add default via "$primary_gw" 2>/dev/null
        if [ $? -eq 0 ]; then
            log "Маршрут добавлен: default via $primary_gw"
            return 0
        else
            return 1
        fi
    fi
}

# Функция для выбора доступного шлюза (БЕЗ ЛОГИРОВАНИЯ!)
find_available_gateway() {
    local primary_gw=$1
    shift
    local backup_gws=("$@")
    
    # Сначала проверяем основной шлюз
    if check_gateway "$primary_gw"; then
        echo "$primary_gw"
        return 0
    fi
    
    # Проверяем резервные шлюзы в порядке приоритета
    for backup_gw in "${backup_gws[@]}"; do
        if check_gateway "$backup_gw"; then
            echo "$backup_gw"
            return 0
        fi
    done
    
    return 1
}

# МОДИФИЦИРОВАННАЯ: Быстрый рестарт DHCP клиента с fallback на статический IP
restart_dhcp_client() {
    local current_time=$(date +%s)
    local time_since_last_restart=$((current_time - LAST_DHCP_RESTART_TIME))
    
    # Защита от частых рестартов (15 секунд вместо 30)
    if [ $time_since_last_restart -lt 15 ]; then
        log "Слишком рано для рестарта DHCP ($time_since_last_restart сек)"
        return 1
    fi
    
    # Проверяем лимит последовательных рестартов
    if [ $DHCP_RESTART_COUNT -ge $MAX_DHCP_RESTARTS ]; then
        log "Достигнут лимит рестартов DHCP ($MAX_DHCP_RESTARTS)"
        DHCP_RESTART_COUNT=0
        return 1
    fi
    
    log "БЫСТРЫЙ рестарт DHCP клиента (попытка $((DHCP_RESTART_COUNT + 1))/$MAX_DHCP_RESTARTS)"
    
    # СНАЧАЛА проверяем 192.168.1.3 - если доступен, НЕ перезапускаем DHCP!
    if check_primary_gateway_fast; then
        log "192.168.1.3 доступен, отмена рестарта DHCP"
        return 1
    fi
    
    # Освобождаем текущий адрес быстро
    dhclient -r "$MODEL_NAME" 2>/dev/null &
    local release_pid=$!
    
    # Ждем завершения освобождения максимум 1 секунду
    for i in {1..2}; do
        if ! kill -0 $release_pid 2>/dev/null; then
            break
        fi
        sleep 0.5
    done
    
    # Если процесс еще жив, убиваем его
    if kill -0 $release_pid 2>/dev/null; then
        kill -9 $release_pid 2>/dev/null
    fi
    
    # Убедимся что интерфейс down/up для очистки
    ip link set "$MODEL_NAME" down
    sleep 0.5  # Уменьшили с 1 до 0.5
    ip link set "$MODEL_NAME" up
    sleep 0.5  # Уменьшили с 1 до 0.5
    
    # Запрашиваем новый адрес с таймаутом
    timeout 5 dhclient "$MODEL_NAME" 2>/dev/null &  # Уменьшили таймаут с 10 до 5
    local acquire_pid=$!
    
    # Ждем получения адреса (укороченное ожидание)
    local wait_count=0
    while [ $wait_count -lt 5 ]; do  # Уменьшили с 10 до 5
        if get_interface_ip >/dev/null; then
            break
        fi
        sleep 1
        ((wait_count++))
    done
    
    # Если процесс еще жив, ждем его завершения
    if kill -0 $acquire_pid 2>/dev/null 2>/dev/null; then
        wait $acquire_pid 2>/dev/null
    fi
    
    # Проверяем результат
    local new_ip=$(get_interface_ip)
    local new_gw=$(get_gateway)
    
    if [ -n "$new_ip" ] && [ -n "$new_gw" ]; then
        DHCP_RESTART_COUNT=$((DHCP_RESTART_COUNT + 1))
        LAST_DHCP_RESTART_TIME=$current_time
        log "УСПЕХ: DHCP за ${wait_count}с. IP: $new_ip, шлюз: $new_gw"
        return 0
    else
        log "DHCP НЕ ДАЛ РЕЗУЛЬТАТА - назначаем статический IP $STATIC_CIDR"
        
        # Назначаем статический IP
        if assign_static_ip; then
            DHCP_RESTART_COUNT=$((DHCP_RESTART_COUNT + 1))
            LAST_DHCP_RESTART_TIME=$current_time
            
            # Обновляем переменные
            new_ip=$(get_interface_ip)
            new_gw=$(get_gateway)
            
            log "Статический IP назначен: IP: $new_ip, шлюз: $new_gw"
            
            # Возвращаем успех, так как статический IP назначен
            return 0
        else
            log "ОШИБКА: Не удалось назначить статический IP"
            return 1
        fi
    fi
}

# НОВАЯ: Быстрая проверка и восстановление маршрута
quick_route_recovery() {
    local current_gw=$1
    local interface_ip=$2
    
    # Если есть IP но нет шлюза в таблице маршрутизации
    if [ -n "$interface_ip" ] && [ -z "$current_gw" ]; then
        # СНАЧАЛА проверяем 192.168.1.3
        if check_primary_gateway_fast; then
            log "БЫСТРОЕ ВОССТАНОВЛЕНИЕ: 192.168.1.3 доступен, настраиваем маршрут"
            if ensure_default_route "192.168.1.3" "$current_gw"; then
                return 0  # Успешно восстановили
            fi
        fi
    fi
    
    return 1
}

# ИЗМЕНЕННАЯ ФУНКЦИЯ: Удаление только правил для текущего порта
clean_iptables_rules() {
    local port="$1"
    
    if [ -z "$port" ]; then
        log "ОШИБКА: Порт не указан для очистки правил iptables"
        return 1
    fi
    
    log "Очистка правил iptables для порта $port"
    
    # Удаляем правила только для указанного порта из цепочки PREROUTING
    local rule_num
    local rules_removed=0
    
    # Получаем список правил для порта и удаляем их
    while true; do
        # Находим правило для данного порта
        rule_num=$(iptables -t nat -L PREROUTING -n --line-numbers 2>/dev/null | \
                   grep "dpt:$port " | head -1 | awk '{print $1}')
        
        if [ -n "$rule_num" ]; then
            log "Удаление правила #$rule_num для порта $port"
            iptables -t nat -D PREROUTING "$rule_num" 2>/dev/null
            rules_removed=$((rules_removed + 1))
        else
            break
        fi
    done
    
    log "Удалено $rules_removed правил для порта $port"
}

# НОВАЯ ФУНКЦИЯ: Удаление правил для конкретного шлюза и порта
clean_iptables_rules_for_gateway() {
    local gateway="$1"
    local port="$2"
    
    if [ -z "$gateway" ] || [ -z "$port" ]; then
        log "ОШИБКА: Не указан шлюз или порт для удаления правил"
        return 1
    fi
    
    log "Очистка правил iptables для шлюза $gateway и порта $port"
    
    local rules_removed=0
    local rule_num
    
    # Поиск и удаление правил для конкретного шлюза и порта
    while true; do
        # Ищем правила с указанным шлюзом и портом
        rule_num=$(iptables -t nat -L PREROUTING -n --line-numbers 2>/dev/null | \
                   grep "dpt:$port to:$gateway:80" | head -1 | awk '{print $1}')
        
        if [ -n "$rule_num" ]; then
            log "Удаление правила #$rule_num для порта $port → $gateway:80"
            iptables -t nat -D PREROUTING "$rule_num" 2>/dev/null
            rules_removed=$((rules_removed + 1))
        else
            break
        fi
    done
    
    log "Удалено $rules_removed правил для порта $port и шлюза $gateway"
}

# НОВАЯ ФУНКЦИЯ: Полная очистка всех правил (использовать только при необходимости)
clean_all_iptables_rules() {
    log "ПОЛНАЯ очистка ВСЕХ правил iptables"
    iptables -t nat -F PREROUTING 2>/dev/null || true
    log "Все правила PREROUTING очищены"
}

# ИЗМЕНЕННАЯ ФУНКЦИЯ: Конфигурация iptables для статического IP
configure_iptables_for_static() {
    local active_gw=$1
    local port=$2
    
    if [ -z "$active_gw" ] || [ -z "$port" ]; then
        log "ОШИБКА: Не указан шлюз или порт для настройки iptables"
        return 1
    fi
    
    # ПРОВЕРЯЕМ, существует ли уже такое правило
    if iptables_rule_exists "$active_gw" "$port"; then
        # Правило уже существует, ничего не делаем
        log "Правило iptables для порта $port → $active_gw:80 уже существует"
        return 0
    fi
    
    # Очищаем ТОЛЬКО правила для текущего порта
    if ! clean_iptables_rules "$port"; then
        log "ОШИБКА: Не удалось очистить правила для порта $port"
        return 1
    fi
    
    # Добавляем правило проброса порта
    if iptables -t nat -I PREROUTING 1 -i eth0 -p tcp --dport "$port" \
                -j DNAT --to-destination "${active_gw}:80"; then
        log "Правило iptables добавлено: $port → $active_gw:80"
        return 0
    else
        log "ОШИБКА: Не удалось добавить правило iptables"
        return 1
    fi
}

# НОВАЯ ФУНКЦИЯ: Проверка существования правила iptables
iptables_rule_exists() {
    local active_gw=$1
    local port=$2
    
    if [ -z "$active_gw" ]; then
        return 1
    fi
    
    # Проверяем существование правила
    if iptables -t nat -L PREROUTING -n --line-numbers 2>/dev/null | grep -q "dpt:$port to:$active_gw:80"; then
        return 0  # Правило существует
    else
        return 1  # Правило не существует
    fi
}

# УПРОЩЕННАЯ проверка необходимости рестарта DHCP
check_dhcp_restart_needed() {
    local current_gw=$1
    local interface_ip=$2
    
    # СНАЧАЛА пробуем быстро восстановить маршрут
    if quick_route_recovery "$current_gw" "$interface_ip"; then
        log "Маршрут восстановлен, рестарт DHCP не требуется"
        NO_GATEWAY_COUNT=0
        GATEWAY_DOWN_COUNT=0
        return 1  # НЕ перезапускаем DHCP
    fi
    
    # ТОЛЬКО если 192.168.1.3 недоступен, проверяем другие условия
    
    # Если нет шлюза И нет IP - немедленный рестарт
    if [ -z "$current_gw" ] && [ -z "$interface_ip" ]; then
        log "КРИТИЧЕСКОЕ: Нет шлюза и нет IP. Рестарт DHCP."
        return 0
    fi
    
    # Если есть IP но нет шлюза - с задержкой
    if [ -n "$interface_ip" ] && [ -z "$current_gw" ]; then
        NO_GATEWAY_COUNT=$((NO_GATEWAY_COUNT + 1))
        # Даем время на восстановление маршрута (3 цикла = 15 секунд)
        if [ $NO_GATEWAY_COUNT -ge 3 ]; then
            log "ПРЕДУПРЕЖДЕНИЕ: Нет шлюза $NO_GATEWAY_COUNT циклов. Рестарт DHCP."
            NO_GATEWAY_COUNT=0
            return 0
        fi
        return 1  # Пока не рестартуем, ждем
    else
        NO_GATEWAY_COUNT=0
    fi
    
    # Если шлюз есть но недоступен
    if [ -n "$current_gw" ] && ! check_gateway "$current_gw"; then
        GATEWAY_DOWN_COUNT=$((GATEWAY_DOWN_COUNT + 1))
        # Быстрая реакция (2 цикла = 10 секунд)
        if [ $GATEWAY_DOWN_COUNT -ge 2 ]; then
            log "ПРЕДУПРЕЖДЕНИЕ: Шлюз $current_gw недоступен. Рестарт DHCP."
            GATEWAY_DOWN_COUNT=0
            return 0
        fi
        return 1  # Пока не рестартуем
    else
        GATEWAY_DOWN_COUNT=0
    fi
    
    return 1
}

# ---- Адрес роутера, заданный порталом ----
# /etc/ndsr/router-ip: «192.168.2.1» или «192.168.2.1/24». Пишет портал, когда
# адрес роутера знает он сам: «LAN как WAN» сменил подсеть или пользователь
# вписал адрес вручную (у роутера может быть выключен DHCP — тогда контейнер
# адрес роутера не узнает). Пока файл есть, он главнее DHCP и зашитых
# 192.168.1.1/.3; файла нет — прежняя логика.
ROUTER_IP_FILE=/etc/ndsr/router-ip
OVERRIDE_ACTIVE=false
OVERRIDE_HOST_ADDR=""   # адрес, который скрипт сам добавил в подсети роутера

read_router_override() {
    [ -s "$ROUTER_IP_FILE" ] || return 1
    local v
    v=$(tr -d ' \r\n' < "$ROUTER_IP_FILE")
    [[ "$v" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$ ]] || return 1
    echo "$v"
}

apply_router_override() {
    local spec="$1" rip prefix net
    rip=${spec%%/*}
    prefix=24
    [[ "$spec" == */* ]] && prefix=${spec##*/}
    net=${rip%.*}
    if [ "$OVERRIDE_ACTIVE" != true ] || [ "$CURRENT_ACTIVE_GW" != "$rip" ]; then
        log "Адрес роутера задан порталом: $rip/$prefix"
        OVERRIDE_ACTIVE=true
    fi
    # Адрес контейнера в подсети роутера (DHCP у роутера может быть выключен)
    if ! ip -4 -o addr show dev "$MODEL_NAME" 2>/dev/null | awk -v n="$net." '{ if (index($4, n) == 1) f = 1 } END { exit !f }'; then
        if ip addr add "${net}.254/${prefix}" dev "$MODEL_NAME" 2>/dev/null; then
            OVERRIDE_HOST_ADDR="${net}.254/${prefix}"
            log "Контейнеру назначен ${net}.254/${prefix} в подсети роутера"
        fi
    fi
    if [ "$CURRENT_ACTIVE_GW" != "$rip" ] || ! iptables_rule_exists "$rip" "$PORT"; then
        if configure_iptables_for_static "$rip" "$PORT"; then
            CURRENT_ACTIVE_GW="$rip"
            IPTABLES_CONFIGURED=true
        fi
    fi
    return 0
}

# Шлюз — роутер в LAN; default через eth0 (сеть стенда, gw_priority в
# compose) роутером не считается
get_gateway() {
    ip route | grep "^default via" | grep -v " dev eth0" | awk '{print $3}' | head -1
}

get_interface_ip() {
    ip -4 addr show "$MODEL_NAME" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1
}

# Инициализация
MODEL_NAME=$(detect_interface)

if [ -z "$MODEL_NAME" ]; then
    echo "Не удалось определить интерфейс с префиксом kn или nc"
    exit 1
fi

# ПОРТ ВЕБА: WEB_PORT из compose (…_WEB в VARS.env) главнее; без него —
# из имени интерфейса: убираем kn/nc, берем цифры до _
if [ -n "$WEB_PORT" ]; then
    PORT="$WEB_PORT"
    log "Порт из WEB_PORT: $PORT"
else
    PORT=$(echo "$MODEL_NAME" | sed 's/^kn//;s/^nc//' | cut -d_ -f1)
fi

# Сохраняем оригинальный порт для логирования
ORIGINAL_PORT="$PORT"

# Удаляем только один последний ноль, если в интерфейсе НЕТ символа _
if [ -z "$WEB_PORT" ] && [[ "$MODEL_NAME" != *_* ]]; then
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

log "=== Запуск скрипта (СВЕРХБЫСТРАЯ ВЕРСИЯ СО СТАТИЧЕСКИМ FALLBACK) ==="
log "Автоопределенный интерфейс: $MODEL_NAME"
log "Оригинальный порт: $ORIGINAL_PORT"
log "Финальный порт: $PORT"
log "Статический IP (fallback): $STATIC_CIDR"
log "Резервные шлюзы: ${BACKUP_GATEWAYS[*]}"
log "Интервал проверки: ${CHECK_INTERVAL}с"
log "Таймаут ping: ${PING_TIMEOUT}с"
log "Макс. рестартов DHCP: $MAX_DHCP_RESTARTS"

# Docker 28+ публикует порты только в сети со шлюзом по умолчанию — в
# compose у сети стенда gw_priority, и default приходит через eth0. Default
# здесь — роутер в LAN (как раньше); сети портала идут через eth0 явными
# маршрутами monitorRoutes.sh
if ip route | grep -q "^default via .* dev eth0"; then
    ip route del default dev eth0 2>/dev/null && log "Удален default через eth0 (шлюз — роутер в LAN)"
fi

# NAT контейнера (раньше — внешний masquerade.sh на стенде после запуска):
#   - MASQUERADE в LAN: роутер видит запрос веба от контейнера и отвечает ему,
#     а не клиенту напрямую через свой WAN (иначе веб снаружи не открывается);
#   - MASQUERADE в eth0: устройства LAN роутера ходят в сети стенда от адреса
#     контейнера;
#   - TCPMSS: MSS по MTU пути.
# -C перед -A — без дублей при перезапуске скрипта.
ensure_nat_rules() {
    local ifc
    for ifc in eth0 "$MODEL_NAME"; do
        iptables -t nat -C POSTROUTING -o "$ifc" -j MASQUERADE 2>/dev/null || \
            { iptables -t nat -A POSTROUTING -o "$ifc" -j MASQUERADE && log "NAT: MASQUERADE -o $ifc"; }
    done
    iptables -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
        { iptables -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu && log "NAT: TCPMSS clamp"; }
}

if ! ip link show "$MODEL_NAME" >/dev/null 2>&1; then
    log "ОШИБКА: Интерфейс $MODEL_NAME не существует"
    log "Доступные интерфейсы:"
    ip link show | grep -E "^[0-9]+:" | awk -F: '{print $2}' | tee -a /var/log/changeContainersIp.log
    exit 1
fi

ensure_nat_rules

# Очищаем правила при запуске (только для нашего порта)
if clean_iptables_rules "$PORT"; then
    log "Правила для порта $PORT очищены при запуске"
fi

# Проверяем, есть ли уже IP адрес на интерфейсе
INITIAL_IP=$(get_interface_ip)
if [ -z "$INITIAL_IP" ]; then
    log "На интерфейсе нет IP адреса - пробуем получить через DHCP"
    # Запускаем DHCP один раз при старте
    timeout 10 dhclient "$MODEL_NAME" 2>/dev/null || true
    sleep 2
    INITIAL_IP=$(get_interface_ip)
    
    if [ -z "$INITIAL_IP" ]; then
        log "DHCP не дал IP - назначаем статический $STATIC_CIDR"
        assign_static_ip
        INITIAL_IP=$(get_interface_ip)
    fi
fi

log "Начальный IP: ${INITIAL_IP:-нет}"

# Убираем strict mode для основного цикла
set +e

# Переменные для отслеживания изменений
LAST_IP=""
LAST_GW=""
# Флаг быстрой проверки
LAST_FAST_CHECK=$(date +%s)

# Флаг для отслеживания статического IP
STATIC_IP_ASSIGNED=false

# Флаг для отслеживания настроенных правил iptables
IPTABLES_CONFIGURED=false
CURRENT_ACTIVE_GW=""

while true; do
    CURRENT_TIME=$(date +%s)

    # Адрес роутера задан порталом — только он, остальная логика не спорит
    if ROUTER_OVERRIDE=$(read_router_override); then
        apply_router_override "$ROUTER_OVERRIDE"
        sleep 1
        continue
    elif [ "$OVERRIDE_ACTIVE" = true ]; then
        log "Адрес роутера, заданный порталом, снят — снова DHCP и автоопределение"
        OVERRIDE_ACTIVE=false
        if [ -n "$OVERRIDE_HOST_ADDR" ]; then
            ip addr del "$OVERRIDE_HOST_ADDR" dev "$MODEL_NAME" 2>/dev/null
            OVERRIDE_HOST_ADDR=""
        fi
        clean_iptables_rules "$PORT"
        CURRENT_ACTIVE_GW=""
        IPTABLES_CONFIGURED=false
        timeout 10 dhclient "$MODEL_NAME" 2>/dev/null || true
    fi
    
    # БЫСТРАЯ проверка 192.168.1.3 каждые 2 секунды
    if [ $((CURRENT_TIME - LAST_FAST_CHECK)) -ge 2 ]; then
        DEFAULT_GW=$(get_gateway)
        INTERFACE_IP=$(get_interface_ip)
        
        # Обновляем флаг статического IP
        if [ "$INTERFACE_IP" = "$STATIC_IP" ]; then
            STATIC_IP_ASSIGNED=true
        else
            STATIC_IP_ASSIGNED=false
        fi
        
        if check_primary_gateway_fast; then
            # Если 192.168.1.3 доступен, но не настроен как шлюз
            if [ "$DEFAULT_GW" != "192.168.1.3" ]; then
                log "БЫСТРОЕ ОБНАРУЖЕНИЕ: 192.168.1.3 доступен, настраиваем маршрут"
                ensure_default_route "192.168.1.3" "$DEFAULT_GW"
                DEFAULT_GW=$(get_gateway)  # Обновляем значение
                LAST_GW="$DEFAULT_GW"
            fi
            
            # Если у нас статический IP и доступен 192.168.1.3
            if [ "$STATIC_IP_ASSIGNED" = true ]; then
                # Проверяем, нужно ли настроить правила iptables
                if [ "$IPTABLES_CONFIGURED" = false ] || [ "$CURRENT_ACTIVE_GW" != "192.168.1.3" ]; then
                    if configure_iptables_for_static "192.168.1.3" "$PORT"; then
                        CURRENT_ACTIVE_GW="192.168.1.3"
                        IPTABLES_CONFIGURED=true
                    fi
                fi
            fi
        else
            # Если 192.168.1.3 недоступен, сбрасываем флаг конфигурации
            if [ "$CURRENT_ACTIVE_GW" = "192.168.1.3" ]; then
                log "192.168.1.3 стал недоступен"
                if clean_iptables_rules_for_gateway "192.168.1.3" "$PORT"; then
                    CURRENT_ACTIVE_GW=""
                    IPTABLES_CONFIGURED=false
                fi
            fi
        fi
        
        LAST_FAST_CHECK=$CURRENT_TIME
    fi
    
    # Основная проверка (каждые 5 секунд)
    if [ $((CURRENT_TIME % CHECK_INTERVAL)) -eq 0 ]; then
        log "--- Проверка сети ---"
        
        DEFAULT_GW=$(get_gateway)
        INTERFACE_IP=$(get_interface_ip)
        
        # Обновляем флаг статического IP
        if [ "$INTERFACE_IP" = "$STATIC_IP" ]; then
            STATIC_IP_ASSIGNED=true
        else
            STATIC_IP_ASSIGNED=false
        fi
        
        # Логируем только при изменениях
        if [ "$INTERFACE_IP" != "$LAST_IP" ] || [ "$DEFAULT_GW" != "$LAST_GW" ]; then
            log "ИЗМЕНЕНИЕ: IP: ${LAST_IP:-нет} → ${INTERFACE_IP:-нет}, Шлюз: ${LAST_GW:-нет} → ${DEFAULT_GW:-нет}"
            LAST_IP="$INTERFACE_IP"
            LAST_GW="$DEFAULT_GW"
        fi
        
        # Проверка необходимости рестарта DHCP
        if check_dhcp_restart_needed "$DEFAULT_GW" "$INTERFACE_IP"; then
            log "Рестарт DHCP клиента..."
            if restart_dhcp_client; then
                # После успешного рестарта обновляем переменные
                DEFAULT_GW=$(get_gateway)
                INTERFACE_IP=$(get_interface_ip)
                LAST_IP="$INTERFACE_IP"
                LAST_GW="$DEFAULT_GW"
                
                # Очищаем правила только для этого порта
                if clean_iptables_rules "$PORT"; then
                    log "Правила для порта $PORT очищены после рестарта DHCP"
                fi
                
                # Сбрасываем флаги
                IPTABLES_CONFIGURED=false
                CURRENT_ACTIVE_GW=""
                
                log "После рестарта DHCP: шлюз=${DEFAULT_GW:-нет}, IP=${INTERFACE_IP:-нет}"
                sleep 2
            fi
            continue
        fi
        
        # Если у нас статический IP, проверяем доступность шлюза и настраиваем правила
        if [ "$STATIC_IP_ASSIGNED" = true ]; then
            AVAILABLE_GW=$(find_available_gateway "$PRIMARY_GATEWAY" "${BACKUP_GATEWAYS[@]}")
            if [ -n "$AVAILABLE_GW" ]; then
                # Проверяем, нужно ли обновить правила
                if [ "$IPTABLES_CONFIGURED" = false ] || [ "$CURRENT_ACTIVE_GW" != "$AVAILABLE_GW" ]; then
                    log "Статический IP: настраиваем правила для шлюза $AVAILABLE_GW"
                    if configure_iptables_for_static "$AVAILABLE_GW" "$PORT"; then
                        CURRENT_ACTIVE_GW="$AVAILABLE_GW"
                        IPTABLES_CONFIGURED=true
                    fi
                fi
            else
                # Нет доступных шлюзов
                if [ "$IPTABLES_CONFIGURED" = true ]; then
                    log "Нет доступных шлюзов - очистка правил для порта $PORT"
                    if clean_iptables_rules "$PORT"; then
                        IPTABLES_CONFIGURED=false
                        CURRENT_ACTIVE_GW=""
                    fi
                fi
            fi
        else
            # Основная логика выбора шлюза (для правил iptables) - только если не статический IP
            if [ -n "$DEFAULT_GW" ]; then
                # Ищем доступный шлюз
                AVAILABLE_GW=$(find_available_gateway "$DEFAULT_GW" "${BACKUP_GATEWAYS[@]}")
                FIND_RESULT=$?
                
                if [ $FIND_RESULT -eq 0 ] && [ -n "$AVAILABLE_GW" ]; then
                    # Если шлюз изменился, обновляем правила
                    if [ "$AVAILABLE_GW" != "$CURRENT_ACTIVE_GW" ]; then
                        log "ПЕРЕКЛЮЧЕНИЕ: $AVAILABLE_GW (был: ${CURRENT_ACTIVE_GW:-не задан})"
                        CURRENT_ACTIVE_GW="$AVAILABLE_GW"
                        
                        # Очистка ТОЛЬКО для текущего порта и добавление нового правила
                        if clean_iptables_rules "$PORT"; then
                            iptables -t nat -I PREROUTING 1 -i eth0 -p tcp --dport "$PORT" \
                                     -j DNAT --to-destination "${CURRENT_ACTIVE_GW}:80"
                            log "Правило: $PORT → $CURRENT_ACTIVE_GW:80"
                        fi
                    fi
                else
                    if [ -n "$CURRENT_ACTIVE_GW" ]; then
                        log "Все шлюзы недоступны - очистка правил для порта $PORT"
                        if clean_iptables_rules "$PORT"; then
                            CURRENT_ACTIVE_GW=""
                        fi
                    fi
                fi
            else
                if [ -n "$CURRENT_ACTIVE_GW" ]; then
                    log "Шлюз пропал - очистка правил для порта $PORT"
                    if clean_iptables_rules "$PORT"; then
                        CURRENT_ACTIVE_GW=""
                    fi
                fi
            fi
        fi
        
        # Логирование состояния раз в минуту
        if [ $((CURRENT_TIME % 60)) -lt 5 ]; then
            log "Статус: IP=${INTERFACE_IP:-нет}, Шлюз=${DEFAULT_GW:-нет}, Активный=${CURRENT_ACTIVE_GW:-нет}, Статический=${STATIC_IP_ASSIGNED}, Правила=${IPTABLES_CONFIGURED}"
        fi
    fi
    
    sleep 1
done
