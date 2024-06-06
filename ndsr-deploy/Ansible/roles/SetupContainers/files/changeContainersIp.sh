#!/bin/bash
set -x
MODEL_NAME=$1
PORT=$2

while true; do
  arp -e -v >/dev/null 2>&1
  sleep 3
  NEW_ARP_ADDR=$(arp -n | grep "50:ff:20" | awk '{print $1}')
  OLD_ARP_ADDR=$(arp -n | grep "50:ff:20" | awk '{print $1}')
  CURRENT_GW=$(ip r | grep -Po "default via \K[\d.]+")

  if ([ -z "$NEW_ARP_ADDR" ] || [ "$OLD_ARP_ADDR" != "$NEW_ARP_ADDR" ] || [ "$NEW_ARP_ADDR" != "$CURRENT_GW" ]); then
    dhclient $MODEL_NAME -r
    ip link set arp off dev $MODEL_NAME
    ip link set arp on dev $MODEL_NAME
    dhclient $MODEL_NAME >/dev/null 2>&1
    NEW_GW=$(ip r | grep -Po "default via \K[\d.]+")
    iptables -t nat -D PREROUTING -i eth0 -p tcp --dport ${PORT} -j DNAT --to-destination ${OLD_ARP_ADDR}:80
    iptables -t nat -I PREROUTING 1 -i eth0 -p tcp --dport ${PORT} -j DNAT --to-destination ${NEW_ARP_ADDR}:80
    netfilter-persistent save
  else
    :
  fi
  CURRENT_GW=$NEW_GW

VAR=$(iptables -t nat -S | grep -P "eth0 -p tcp -m tcp --dport ${PORT}" | grep -Po "(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?=[\s|:])")
if [ -z ${VAR} ];then
iptables -t nat -F PREROUTING
iptables -t nat -A PREROUTING -i eth0 -p tcp --dport ${PORT} -j DNAT --to-destination ${NEW_ARP_ADDR}:80
netfilter-persistent save
else
:
fi

done