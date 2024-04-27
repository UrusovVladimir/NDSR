#!/usr/bin/env bash
docker plugin ls | grep docker-net-dhcp > /dev/null 2>&1
RET=$?
if [ $RET != 0 ];then 
git clone https://github.com/Celerway/docker-net-dhcp.git ; cd ./docker-net-dhcp ; make create
else
exit 1
fi