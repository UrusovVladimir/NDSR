network:
    version: 2
    ethernets:
        int:
            dhcp4: false
            dhcp6: false
        match:
          macaddress: 00:0e:29:c1:ff:ff
    bridges:
        internet:
            dhcp4: true
            dhcp6: false
            interfaces: [vlan1604]
        match:    
            macaddress: 00:0e:29:c1:ff:ff
        kn1011:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1907]
            match:
              macaddress: 00:0e:29:c1:10:11
        kn1713:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1911]
            match:
              macaddress: 00:0e:29:c1:17:13
        kn1811:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1913]
            match:
              macaddress: 00:0e:29:c1:18:11
        kn1912:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1912]
            match:  
              macaddress: 00:0e:29:c1:19:12
        kn2311:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1909]
            match:
              macaddress: 00:0e:29:c1:23:11
        kn2410:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1906]
            match:
              macaddress: 00:0e:29:c1:24:10
        kn2610:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1904]
            match:  
              macaddress: 00:0e:29:c1:26:10
        kn2910:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1908]
            match:  
              macaddress: 00:0e:29:c1:29:10
        kn3510:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1910]
            match:  
              macaddress: 00:0e:29:c1:35:10
        kn3710:
            dhcp4: false
            dhcp6: false
            dhcp4-overrides:
              use-dns: false
            nameservers:
              addresses: [8.8.8.8, 8.8.4.4]
            interfaces: [vlan1905]
            match:  
              macaddress: 00:0e:29:c1:37:10

    vlans:
        vlan1604:
            dhcp4: false
            dhcp6: false
            id: 1604
            link: int
        vlan1904:
            dhcp4: false
            dhcp6: false
            id: 1904
            link: int
        vlan1905:
            dhcp4: false
            dhcp6: false
            id: 1905
            link: int
        vlan1906:
            dhcp4: false
            dhcp6: false
            id: 1906
            link: int
        vlan1907:
            dhcp4: false
            dhcp6: false
            id: 1907
            link: int
        vlan1908:
            dhcp4: false
            dhcp6: false
            id: 1908
            link: int
        vlan1909:
            dhcp4: false
            dhcp6: false
            id: 1909
            link: int
        vlan1910:
            dhcp4: false
            dhcp6: false
            id: 1910
            link: int
        vlan1911:
            dhcp4: false
            dhcp6: false
            id: 1911
            link: int
        vlan1912:
            dhcp4: false
            dhcp6: false
            id: 1912
            link: int
        vlan1913:
            dhcp4: false
            dhcp6: false
            id: 1913
            link: int