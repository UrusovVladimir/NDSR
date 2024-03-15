#!/usr/bin/env bash

IMAGE=$(docker image ls --format '{{json .}}' | jq 'select(.Repository == "ssh_team1")' | jq .ID -r)
echo "$IMAGE" > $(pwd)/IMAGE