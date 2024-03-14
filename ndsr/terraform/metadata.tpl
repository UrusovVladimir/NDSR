network:
  version: 2
  ethernets:
    int:
      match:
        macaddress: 00:0e:29:c1:ff:ff
      dhcp4: no
      dhcp6: no
  vlans:
    vlan1604:
      id: 1604
      link: int
      dhcp4: no
    vlan1904:
      id: 1904
      link: int
      dhcp4: no
    vlan1905:
      id: 1905
      link: int
      dhcp4: no
    vlan1906:
      id: 1906
      link: int
      dhcp4: no
    vlan1907:
      id: 1907
      link: int
      dhcp4: no
    vlan1908:
      id: 1908
      link: int
      dhcp4: no
    vlan1909:
      id: 1909
      link: int
      dhcp4: no
    vlan1910:
      id: 1910
      link: int
      dhcp4: no
    vlan1911:
      id: 1911
      link: int
      dhcp4: no
    vlan1912:
      id: 1912
      link: int
      dhcp4: no
    vlan1913:
      id: 1913
      link: int
      dhcp4: no

  bridges:
    internet:
      macaddress: 00:0e:29:c1:ff:ff
      dhcp4: yes
      dhcp6: no
      interfaces: [vlan1604]
    kn2610:
      macaddress: 00:0e:29:c1:26:10
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1904 ]
    kn3710:
      macaddress: 00:0e:29:c1:37:10
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1905 ]
    kn2410:
      macaddress: 00:0e:29:c1:24:10
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1906 ]
    kn1011:
      macaddress: 00:0e:29:c1:10:11
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1907 ]
    kn2910:
      macaddress: 00:0e:29:c1:29:10
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1908 ]
    kn2311:
      macaddress: 00:0e:29:c1:23:11
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1909 ]
    kn3510:
      macaddress: 00:0e:29:c1:35:10
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1910 ]
    kn1713:
      macaddress: 00:0e:29:c1:17:13
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1911 ]
    kn1912:
      macaddress: 00:0e:29:c1:19:12
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1912 ]
    kn1811:
      macaddress: 00:0e:29:c1:18:11
      dhcp4: no
      dhcp6: no
      interfaces: [ vlan1913 ]