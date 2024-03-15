#!/usr/bin/env bash
BRIDGE=(kn2610 kn3710 kn2410 kn1011 kn2910 kn2311 kn3510 kn1713 kn1912 kn1811)
IP_ADDRESS=10.10.19.
PORT_SSH=1926
PORT_WEB=
for br in "${BRIDGE[@]}"; do
  sudo iptables -I FORWARD 1 -i $br -j ACCEPT
        echo "$br"
done

for i in {4..13}; do
echo "10.19.1.$i"
done

i=10.10.19.
f=1926
for ip  in "$i"{4..13}
do
  echo "sudo iptables -t nat -A PREROUTING -i internet -d 172.16.78.254 -p tcp --dport $((f++)) -j DNAT --to-destination $ip:22"
done
exit 0