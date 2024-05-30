#!/usr/bin/env bash

# Проверяем наличие правила в цепочке FORWARD
current=$(sudo iptables -L FORWARD -nv | sudo iptables -L FORWARD -nv | grep 'TCPMSS clamp to PMTU')

# Если правило на forward уже существует, продолжаем выполнение без изменений
if [[ ! $current ]]; then
sudo iptables -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
# Сохраняем изменения в таблице правил
sudo netfilter-persistent save
fi

# Проверяем наличие правила в цепочке INPUT
current=$(sudo iptables -L INPUT -nv | sudo iptables -L FORWARD -nv | grep 'TCPMSS clamp to PMTU')

if [[ ! $current ]]; then
# Если правило на input уже существует, продолжаем выполнение без изменений
sudo iptables -A INPUT -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
# Сохраняем изменения в таблице правил
sudo netfilter-persistent save
exit0
fi
