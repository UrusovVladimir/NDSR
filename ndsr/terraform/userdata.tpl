#cloud-config
groups:
  - ubuntu:
      - docker
      - root

users:
  - name: v.urusov
    ssh_authorized_keys:
      - "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFFrjRb30WqWf68AJ0lrO2E404z4JYhW9o0ZUGiMiQF5 v.urusov@ndmsystems.com"
    groups: [docker,root]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    passwd: "$y$j9T$nzw2cjjIBN1ZmVaCHCdwB.$P0v5BHMB9YFAwPoKmFxpZ7D.Y3q7azc1PLxsPUvxH6A"

chpasswd:
  list: |
    v.urusov:6Crz7QLR
    root:6Crz7QLR
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
  - git
  - curl
  - wget
  - jq
  - iproute2
  - traceroute
  - net-tools
  - iptables-persistent

runcmd:
  - userdel -r -f ubuntu
  - sudo sed -i -e '/#Port 22/s/^.*$/Port 9678/' /etc/ssh/sshd_config
  - sudo systemctl restart sshd
  - mkdir /home/${user}/docker_deb
  - wget ${dockerCompose} -O /home/${user}/docker_deb/docker-compose-plugin_2.21.0-1~ubuntu.22.04~jammy_amd64.deb
  - wget ${dockerCe} -O /home/${user}/docker_deb/docker-ce_24.0.7-1~ubuntu.22.04~jammy_amd64.deb
  - wget ${dockerCli} -O /home/${user}/docker_deb/docker-ce-cli_24.0.7-1~ubuntu.22.04~jammy_amd64.deb
  - wget ${containerD} -O /home/${user}/docker_deb/containerd.io_1.6.25-1_amd64.deb
  - wget ${dockerBuild} -O /home/${user}/docker_deb/docker-buildx-plugin_0.11.2-1~ubuntu.22.04~jammy_amd64.deb
  - dpkg -i --force-all /home/${user}/docker_deb/*.deb