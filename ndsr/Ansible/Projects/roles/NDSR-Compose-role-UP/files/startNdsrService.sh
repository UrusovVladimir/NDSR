#!/usr/bin/env bash

STATUS_EXITED=$(docker ps -a --format '{{json .}}' |  jq '. | select(.State== "exited").Names' | grep -E KN-[0-9]{4} | tr -d '"')
if [[ ${#STATUS_EXITED[0]} -gt 1 ]]; then
        docker start ${STATUS_EXITED}
else
        exit 0
fi