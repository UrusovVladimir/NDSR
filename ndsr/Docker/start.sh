#!/usr/bin/env bash

IMAGE=$(docker image ls --format '{{json .}}' | jq 'select(.Repository == "v.urusov/systemd:v3")' | jq .ID -r)
echo "$IMAGE" > $(pwd)/IMAGE