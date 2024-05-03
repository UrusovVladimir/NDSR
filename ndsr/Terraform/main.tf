#########################################
#  ESXI Provider host/login details     #
#########################################
provider "esxi" {
  esxi_hostname = var.esxi_hostname
  esxi_hostport = var.esxi_hostport
  esxi_hostssl  = var.esxi_hostssl
  esxi_username = var.esxi_username
  esxi_password = var.esxi_password
}
resource "esxi_portgroup" "Trunk" {
  name = var.esxi_trunk
  vswitch = var.switch
  vlan = var.vlan4095
  forged_transmits = false
  promiscuous_mode = false
}
#########################################
#  ESXI Guest resource                  #
#########################################
data "template_file" "cloud-metadata" {
  template = file("metadata.tpl")
  
}

data "template_file" "cloud-userdata" {
  template       = file("userdata.tpl")
  vars           = {
    user         = var.admin
    password     = var.password
  }
}

resource "esxi_guest" "US07_Docker02" {
  guest_name     = var.vm_hostname
  disk_store     = var.disk_store
  guestos        = var.guestos
  virthwver      = var.virthwver
  ovf_source     = var.ovf_file
  power          = var.power
  memsize        = var.memsize
  numvcpus       = var.numvcpus
  boot_disk_type = var.boot_disk_type
  boot_disk_size = var.boot_disk_size

  # connection {
  #   host = "172.16.77.249"
  #   user = "v.urusov"
  #   password = var.esxi_password
  # }
  # provisioner "file" {
  #   source = "./jammy-server-cloudimg-amd64.ova"
  #   destination = "~/jammy-server-cloudimg-amd64.ova"
  # }
    guestinfo           = {
    "metadata.encoding" = "base64"
    "metadata"          = base64encode(data.template_file.cloud-metadata.rendered)
    "userdata.encoding" = "base64"
    "userdata"          = base64encode(data.template_file.cloud-userdata.rendered)
  }
  ovf_properties {
    key   = "username"
    value = "ubuntu"
  }
  ovf_properties {
    key   = "password"
    value = "ubuntu"
  }
  ovf_properties {
    key   = "hostname"
    value = "US07_Docker02"
  }

  network_interfaces {
    virtual_network = var.esxi_trunk
    mac_address     = "00:0e:29:c1:ff:ff"
  }
lifecycle {
  create_before_destroy = true
}
}
resource "null_resource" "cloud"{
  provisioner "remote-exec" {
  connection {
      type = "ssh"
      user = "v.urusov"
      private_key = "~/.ssh/${var.admin}"
      host = "${ip}"
      port = "22"
    }
  inline = ["cloud-init status --wait"]
  }
}
