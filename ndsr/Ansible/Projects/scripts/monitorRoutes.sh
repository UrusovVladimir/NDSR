#!/usr/bin/env bash
CHECK_ROUTE=($(ip route | awk '{print $1}' | grep -Eo "(10.10.18.0/24|192.168.20.0/24|10.150.18.0/24)"))
IP_NETWORKS=(10.10.18.0/24 192.168.20.0/24 10.150.18.0/24)                                                                                                                                                                                                                        

routes_adding() {
    if [[ $# -eq 0 ]]; then
        echo "Specify more one argument"
        exit 1
    fi
    for argument in $*; do
        ip route add $argument via 10.10.19.1 dev eth0
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