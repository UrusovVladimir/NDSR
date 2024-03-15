#cloud-config
chpasswd:
  list: |
    v.urusov:${password}
    root:${password}
  expire: false
users:
  - name: v.urusov
    shell: /bin/bash
    sudo: [ "ALL=(ALL) NOPASSWD:ALL" ]
    groups: docker, sudo
    ssh-authorized-keys:
      - ${sshKey}
disable_root: true
write_files:
  - path: /etc/sysctl.d/enabled_ipv4_forwarding.conf 
    content: |
      net.ipv4.conf.all.forwarding=1
    # Add default auto created user to docker group
apt:
  sources:
    docker.list:
      keyid: 9DC858229FC7DD38854AE2D88D81803C0EBFCD88
      source: deb [arch=amd64] https://download.docker.com/linux/ubuntu $RELEASE stable
groups:
  - docker
package_update: true
package_upgrade: true
packages:
  - speedtest-cli
  - bridge-utils
  - python3-pip
  - git
  - curl
  - wget
  - jq
  - iproute2
  - traceroute
  - net-tools
  - sshpass

runcmd:
  - userdel -r -f ubuntu
  - mkdir /home/${user}/docker_deb
  - wget ${dockerCe} -O /home/${user}/docker_deb/docker-ce_24.0.7-1~ubuntu.22.04~jammy_amd64.deb 
  - wget ${dockerCompose} -O /home/${user}/docker_deb/docker-compose-plugin_2.21.0-1~ubuntu.22.04~jammy_amd64.deb
  - wget ${dockerCli} -O /home/${user}/docker_deb/docker-ce-cli_24.0.7-1~ubuntu.22.04~jammy_amd64.deb
  - wget ${containerD} -O /home/${user}/docker_deb/containerd.io_1.6.25-1_amd64.deb
  - wget ${dockerBuild} -O /home/${user}/docker_deb/docker-buildx-plugin_0.11.2-1~ubuntu.22.04~jammy_amd64.deb
  - dpkg -i --force-all /home/${user}/docker_deb/*.deb