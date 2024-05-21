#!/usr/bin/env bash
SSH_PORTS_DEFAULT=22
VNC_PORTS_DEFAULT=6080
MODELS=$(docker ps -a --format '{{json .}}' |  jq -r .Names)
IFS=$'\n' readarray -t MODELS <<< "$MODELS"
if [ -z "$MODELS" ];then
exit 1
fi
#echo "${MODELS[@]}"

IPv4_ADDRESS=$(docker inspect --format='{{.NetworkSettings.Networks.ndsr_default.IPAddress}}' $(docker ps -a --format '{{json .}}' |  jq -r .Names))
IFS=$'\n' readarray -t IPv4_ADDRESS <<< "$IPv4_ADDRESS"

WEB_PORTS=$(docker ps -a --format '{{json .}}' |  jq -r .Names | sed 's/KN-//g')
IFS=$'\n' readarray -t WEB_PORTS <<< "$WEB_PORTS"

for PORT_SSH in "${MODELS[@]}";do
SSH_PORTS+=( $(docker inspect  "$PORT_SSH" | jq -r '.[0].HostConfig.PortBindings."22/tcp"[0].HostPort') )
done
#echo ${SSH_PORTS[@]}


for PORT_VNC in "${MODELS[@]}";do
VNC_PORTS+=( $(docker inspect  "$PORT_VNC" | jq -r '.[0].HostConfig.PortBindings."6080/tcp"[0].HostPort') )
done
#echo ${VNC_PORTS[@]}


for MODEL in "${!MODELS[@]}"; do
if  sudo iptables -t nat -S -v | grep -E -q  "to-destination ${IPv4_ADDRESS[$MODEL]}:${WEB_PORTS[$MODEL]}"; then
:
else
        sudo iptables -t nat -A PREROUTING -i internet -p tcp --dport ${WEB_PORTS[$MODEL]} -j DNAT --to-destination ${IPv4_ADDRESS[$MODEL]}:${WEB_PORTS[$MOEL]}
fi

if  sudo iptables -t nat -S -v | grep -E -q  "to-destination ${IPv4_ADDRESS[$MODEL]}:${SSH_PORTS[$MODEL]}"; then
:
else
         sudo iptables -t nat -A PREROUTING -i internet -p tcp --dport ${SSH_PORTS[$MODEL]} -j DNAT --to-destination ${IPv4_ADDRESS[$MODEL]}:${SSH_PORTS_DEFAULT}
fi

if  sudo iptables -t nat -S -v | grep -E -q  "to-destination ${IPv4_ADDRESS[$MODEL]}:${VNC_PORTS[$MODEL]}"; then
:
else
        sudo iptables -t nat -A PREROUTING -i internet -p tcp --dport ${VNC_PORTS[$MODEL]} -j DNAT --to-destination ${IPv4_ADDRESS[$MODEL]}:${VNC_PORTS_DEFAULT}
fi

done

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