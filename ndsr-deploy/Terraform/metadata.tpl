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
          nameservers:
            addresses: [8.8.8.8,1.1.1.1]
          interfaces:
            - vlan1604
          macaddress: 00:0e:29:c1:ff:ff
        kn1011:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1907
          macaddress: 00:0e:29:c1:10:11
        kn1713:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1911
          macaddress: 00:0e:29:c1:17:13
        kn1811:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1913
          macaddress: 00:0e:29:c1:18:11
        kn1912:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1912
          macaddress: 00:0e:29:c1:19:12
        kn2311:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1909
          macaddress: 00:0e:29:c1:23:11
        kn2410:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1906
          macaddress: 00:0e:29:c1:24:10
        kn2610:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1904
          macaddress: 00:0e:29:c1:26:10
        kn2910:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1908
          macaddress: 00:0e:29:c1:29:10
        kn3510:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1910
          macaddress: 00:0e:29:c1:35:10
        kn3710:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1905
          macaddress: 00:0e:29:c1:37:10
        kn2110:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1914
          macaddress: 00:0e:29:c1:21:10
        kn1613:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1915
          macaddress: 00:0e:29:c1:16:13
        kn2211:
          dhcp4: false
          dhcp6: false
          nameservers:
            addresses: []
            search: []
          interfaces:
            - vlan1916
          macaddress: 00:0e:29:c1:22:11
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
        vlan1914:
          dhcp4: false
          dhcp6: false
          id: 1914
          link: int
        vlan1915:
          dhcp4: false
          dhcp6: false
          id: 1915
          link: int
        vlan1916:
          dhcp4: false
          dhcp6: false
          id: 1916
          link: int            