#!/usr/bin/env bash
#так как в docker на данный момент так и не реализоваали приоритеты в сетях: https://github.com/moby/moby/issues/20179 приходится обходиться через
#скрипт изменение маршрута по умолчанию.
model=$(docker ps -a --format '{{json .}}' |  jq -r .Names | grep -E "KN-[0-9]{4}")

for models in $model; do
current=$(docker exec $models ip r | grep 'default via 192.168.1.1')
if [[ $current ]]; then
  docker exec $models sudo ip r del default
  docker exec $models sudo ip r add default via 10.10.19.1 dev eth0
  echo "$models default route $current has been changed to via 10.10.19.1 dev eth0"
fi
done