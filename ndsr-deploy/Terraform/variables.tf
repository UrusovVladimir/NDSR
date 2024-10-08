variable "esxi_hostname" {
  default = "192.168.77.132"
}

variable "esxi_hostport" {
  default = "22"
}

variable "esxi_hostssl" {
  default = "443"
}

variable "admin" {
  description = "NDSR's Project Administrator"
}

###Varibles Networks
variable "esxi_trunk" {
  default = "Trunk"
}
variable "ovf_file" {
  #default = "jammy-server-cloudimg-amd64.ova"
  default = "https://cloud-images.ubuntu.com/releases/jammy/release/ubuntu-22.04-server-cloudimg-amd64.ova"
}

variable "vm_hostname" {
  default = "US07_DockerHost02"
}

variable "vm_hostname_dhcp" {
  default = "US08_DHCP"
}

variable "disk_store" {
  default = "VM"
}

variable "boot_disk_type" {
  default = "thin"
}

variable "virthwver" {
  default = "14"
}

variable "boot_disk_size" {
  type =list(string) 
  default = [
    "250",
    "10"
  ]
}


variable "power" {
  default = "on"
}

variable "memsize" {
  default = "10240"
}

variable "memsize_dhcp" {
  default = "256"
}

variable "numvcpus" {
  default = "6"
}

variable "numvcpus_dhcp" {
  default = "1"
}

variable "guestos" {
  default = "ubuntu-64"
}

variable "switch" {
  default = "Public_int"
}

variable "network_adapter" {
  default = "vmnic1"
}

variable "vlan1604" {
  default = "1604"
}

variable "vlan4095" {
  default = "4095"
}

variable "esxi_username" {
  description = "Enter username to connect to ESXI."
}

variable "esxi_password" {
  description = "Enter password to connect to ESXI."

}

variable "password" {
  description = "Password for NDSR(DockerHost) administrator's account"
}

variable "ssh" {
  description = "Public Key for connect to Docker host"
}

variable "ip_docker_host" {
  default = "172.16.78.254"
}
