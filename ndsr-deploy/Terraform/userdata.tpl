#cloud-config
groups:
  - ubuntu:
      - docker
      - root

users:
  - name: v.urusov
    ssh_authorized_keys:
      - "${ssh}"
    groups: [docker,root]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    passwd: ""

chpasswd:
  list: |
    v.urusov:${password}
    root:${password}
  expire: false

disable_root: true
write_files:
  - content: |
      net.ipv4.conf.all.forwarding=1
    # Add default auto created user to docker group
    path: /etc/sysctl.d/enabled_ipv4_forwarding.conf
    owner: root:root
apt:
  sources:
    docker.list:
      keyid: 9DC858229FC7DD38854AE2D88D81803C0EBFCD88
      source: deb [arch=amd64] https://download.docker.com/linux/ubuntu $RELEASE stable
package_update: true
package_upgrade: true
packages:
  - speedtest-cli
  - sshpass
  - bridge-utils
  - python3-pip
  - python3-systemd
  - git
  - curl
  - wget
  - jq
  - iproute2
  - traceroute
  - net-tools
  - iptables-persistent
  - docker-ce 
  - docker-ce-cli 
  - containerd.io 
  - docker-buildx-plugin 
  - docker-compose-plugin

runcmd:
  - userdel -r -f ubuntu
  - sudo sed -i -e '/#Port 22/s/^.*$/Port 9678/' /etc/ssh/sshd_config
  - sudo systemctl restart sshd
