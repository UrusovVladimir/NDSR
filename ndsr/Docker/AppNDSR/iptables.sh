#!/usr/bin/env bash
BRIDGE=(kn2610 kn3710 kn2410 kn1011 kn2910 kn2311 kn3510 kn1713 kn1912 kn1811)
IP_ADDRESS_CONTAINER=10.10.19.
IP_ADDRESS_HOST=172.16.78.254
PORT_SSH=1926
PORT_WEB=(2610 3710 2410 1011 2910 2311 3510 1713 1912 1811)
###Создаем правила для форварда
for br in "${BRIDGE[@]}"; do
  echo "sudo iptables -I FORWARD -i $br -j ACCEPT"
done
###проброс ssh
for ip  in "$IP_ADDRESS"{4..13}
do
  echo "sudo iptables -t nat -A PREROUTING -i internet -d $IP_ADDRESS_HOST -p tcp --dport $((PORT_SSH++)) -j DNAT --to-destination $ip:22"
done
###проброс web порта на кинетики
i=4
for web in "${PORT_WEB[@]}"; do
  echo "sudo iptables -t nat -A PREROUTING -i internet -d $IP_ADDRESS_HOST -p tcp --dport $web -j DNAT --to-destination $IP_ADDRESS""$((i++))":"$web"
done
exit 0
