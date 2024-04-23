DNS_NAME=$(cat /etc/hosts | grep "127.0.1.1 US07Docker02 US07Docker02")
STATIC_NAME="127.0.1.1 US07Docker02 US07Docker02"
if [ "$DNS_NAME" != "$STATIC_NAME" ]; then
        echo "127.0.1.1 US07Docker02 US07Docker02" | sudo tee -a /etc/hosts > /dev/null 2>&1
fi
sudo rm /etc/resolv.conf > /dev/null 2>&1
sudo touch /etc/resolv.conf.manually-configured > /dev/null 2>&1

DNS_SERVER=$(cat /etc/resolv.conf.manually-configured | grep "nameserver 1.1.1.1")
RET=$?
if [ $RET != 0 ]; then
sudo cat << EOF > /etc/resolv.conf.manually-configured
Настройка DNS резолвера.
nameserver 1.1.1.1
nameserver 8.8.8.8
EOF
fi
if readlink /etc/resolv.conf; then
        sudo systemctl restart systemd-resolved.service
        exit 1
else
        sudo ln -s /etc/resolv.conf.manually-configured /etc/resolv.conf > /dev/null 2>&1
        sudo systemctl restart systemd-resolved.service
fi