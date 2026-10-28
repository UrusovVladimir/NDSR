#!/bin/bash
# ssh-keys.sh — ключи SSH root из файла стенда (монтируется в compose на
# /etc/ndsr/ssh/authorized_keys). sshd не принимает authorized_keys чужого
# владельца (на хосте файл принадлежит пользователю), поэтому копия с
# владельцем root. Файла нет — ключей нет, вход по SSH закрыт.
SRC=/etc/ndsr/ssh/authorized_keys
DST=/root/.ssh/authorized_keys
mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [ -s "$SRC" ]; then
    install -o root -g root -m 600 "$SRC" "$DST"
    echo "ssh-keys: $(grep -c . "$DST") key(s) from $SRC"
else
    rm -f "$DST"
    echo "ssh-keys: no $SRC — SSH login disabled"
fi
