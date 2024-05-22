#!/usr/bin/env bash

model=$(docker ps -a --format '{{json .}}' |  jq -r .Names)


for models in $model; do
port=${models:3:4}
current=$(docker exec $models iptables -t nat -S | grep 'to-destination 192.168.1.1:80')
if [[ ! $current ]]; then
 docker exec $models iptables -t nat -A PREROUTING -p tcp --dport $port -j DNAT --to-destination 192.168.1.1:80
 echo "$models Правило iptables -t nat -A PREROUTING -p tcp --dport $port -j DNAT --to-destination 192.168.1.1:80 добавлено." > /dev/tty11
fi

current=$(docker exec $models iptables -L FORWARD -nv | sudo iptables -L FORWARD -nv | grep 'TCPMSS clamp to PMTU')
if [[ ! $current ]]; then
 docker exec $models iptables -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS  --clamp-mss-to-pmtu
 echo "$models Правило iptables -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS  --clamp-mss-to-pmtu добавлено." > /dev/tty11
fi

current=$(docker exec $models iptables -t nat -S POSTROUTING | grep 'eth0 -j MASQUERADE')
if [[ ! $current ]]; then
 docker exec $models iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
 echo "$models Правило iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE добавлено." > /dev/tty11
fi

current=$(docker exec $models iptables -S -v | grep 'FORWARD -m conntrack --ctstate RELATED,ESTABLISHED')
if [[ ! $current ]]; then
 docker exec $models iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
 echo "$models Правило iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT добавлено." > /dev/tty11
fi
done



MODELS=$(docker ps -a --format '{{json .}}' |  jq -r .Names)
IFS=$'\n' readarray -t MODELS <<< "$MODELS"

for ifconfig in ${MODELS[@]}; do
IP_INTERFACE+=( $(docker exec -it "$ifconfig" ifconfig | grep -P "kn[\d]+" | grep -Po "kn[\d]+") )
done

if [ ! -z ${IP_INTERFACE} ]; then
for rule in ${!MODELS[@]}; do
docker exec -it ${MODELS[$rule]} iptables -t nat -S POSTROUTING -v | grep -P "POSTROUTING -o ${IP_INTERFACE[$rule]}" > /dev/null
RET=$?

if [ ! $RET -eq 0 ]; then
docker exec -it ${MODELS[$rule]} iptables -t nat -A POSTROUTING -o ${IP_INTERFACE[$rule]} -j MASQUERADE
fi
done
fi