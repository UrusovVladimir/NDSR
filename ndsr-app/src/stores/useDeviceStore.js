import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { socket } from '@/socket'

export const useDeviceStore = defineStore('devices', () => {
  // State
  const devices = ref([])
  const loading = ref(false)
  const currentUserId = ref(null)
  const allDevices = ref([])
  const users = ref([])

  // ========== COMPUTED ==========
  const userMap = computed(() => {
    if (!users.value || !Array.isArray(users.value) || users.value.length === 0) {
      return new Map()
    }
    return new Map(users.value.map(user => [user.ip, user]))
  })

  const getDeviceSite = (deviceId) => {
    const device = devices.value.find(d => d.id === deviceId)
    return device?.site || null
  }

  const getUserByIp = (userIp) => {
    if (!userIp || !userMap.value.size) return null
    return userMap.value.get(userIp)
  }
  
  const getUserName = (userIp) => {
    if (!userIp) return 'Unknown User'
    const user = getUserByIp(userIp)
    return user?.name || `User ${userIp}`
  }
  
  const getDeviceWanType = (deviceId) => {
    const device = devices.value.find(d => d.id === deviceId)
    return device?.wanType || null
  }

  const getUserById = (userId) => {
    if (!userId || !users.value.length) return null
    return users.value.find(user => user.id === userId)
  }

  const onlineCount = computed(() => 
    devices.value.filter(device => device.statusCode === 200).length
  )
  
  const offlineCount = computed(() => 
    devices.value.filter(device => device.statusCode !== 200).length
  )

  const totalDevices = computed(() => devices.value.length)

  const routerDevices = computed(() => 
    devices.value.filter(device => device.type === 'router')
  )

  const availableDevices = computed(() => {
    return devices.value || []
  })

  // ========== METHODS: DEVICES ==========
  const setDevices = (newDevices) => {
    devices.value = newDevices
  }

  const setUsers = (usersData) => {
    users.value = usersData || []
  }

  const setCurrentUserId = (userId) => {
    currentUserId.value = userId
  }

  const updateDeviceStatus = (deviceId, statusCode) => {
    const deviceIndex = devices.value.findIndex(d => String(d.id) === String(deviceId))
    if (deviceIndex !== -1) {
      devices.value[deviceIndex].statusCode = statusCode
    }
  }
  
  const addDevice = (device) => {
    return new Promise((resolve, reject) => {
      socket.emit('device:add', device, (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.error || 'Failed to add device'))
        }
      })
    })
  }
  
  const removeDevice = (deviceId) => {
    return new Promise((resolve, reject) => {
      socket.emit('device:remove', String(deviceId), (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.error || 'Failed to remove device'))
        }
      })
    })
  }

  const reloadConfigs = () => {
    return new Promise((resolve, reject) => {
      socket.emit('device:reloadConfigs', (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.error || 'Failed to reload configs'))
        }
      })
    })
  }

  const updateDeviceShortName = (deviceId, newShortName) => {
    return new Promise((resolve, reject) => {
      socket.emit('device:updateShortName', {
        deviceId: String(deviceId),
        shortName: newShortName.trim()
      }, (response) => {
        if (response?.success) {
          const device = devices.value.find(d => String(d.id) === String(deviceId))
          if (device) {
            device.shortName = newShortName.trim() 
          }
          resolve(response)
        } else {
          reject(new Error(response?.error || 'Failed to update device name'))
        }
      })
    })
  }

  // ========== METHODS: USERS ==========
  const addUser = (userData) => {
    return new Promise((resolve, reject) => {
      socket.emit('users:add', userData, (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.error || 'Failed to add user'))
        }
      })
    })
  }

  const removeUser = (ip) => {
    return new Promise((resolve, reject) => {
      socket.emit('users:remove', ip, (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.error || 'Failed to remove user'))
        }
      })
    })
  }

  const updateUserName = (ip, newName) => {
    return new Promise((resolve, reject) => {
      socket.emit('users:updateName', { ip, name: newName.trim() }, (response) => {
        if (response?.success) {
          const user = users.value.find(u => String(u.ip).trim() === String(ip).trim())
          if (user) {
            user.name = newName.trim()
          }
          resolve(response)
        } else {
          reject(new Error(response?.error || 'Failed to update user name'))
        }
      })
    })
  }

  const reloadUsers = () => {
    return new Promise((resolve, reject) => {
      socket.emit('users:reload', (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.error || 'Failed to reload users'))
        }
      })
    })
  }

  // ========== SOCKET LISTENERS ==========
  const initializeSocketListeners = () => {
    socket.on('device:statuses:initial', (statuses) => {
      statuses.forEach(({ deviceId, status }) => {
        updateDeviceStatus(deviceId, status)
      })
    })
    
    socket.on('device:powerStatus', (data) => {
      if (data && data.deviceId) {
        const device = devices.value.find(d => String(d.id) === String(data.deviceId));
        if (device) {
          device.powerStatus = data.status;
        }
      }
    })
    
    socket.on('device:configUpdated', (data) => {
      console.log('🔄 Config updated event received:', data);
      if (data.deviceId && data.status !== undefined) {
        updateDeviceStatus(data.deviceId, data.status);
      }
    })

    socket.on('device:list', (newDevices) => {
      setDevices(newDevices.map(device => {
        if (device.powerStatus) {
          return { ...device, powerStatus: device.powerStatus };
        }
        return device;
      }));
      loading.value = false;
    })
    
    socket.on('device:removed', (deviceId) => {
      devices.value = devices.value.filter(d => String(d.id) !== String(deviceId))
    })

    socket.on('device:status', (data) => {
      if (data && data.deviceId !== undefined && data.status !== undefined) {
        updateDeviceStatus(data.deviceId, data.status)
      }
    })

    socket.on('device:siteUpdated', (data) => {
      const device = devices.value.find(d => d.id === data.deviceId)
      if (device) {
        device.site = data.site
      }
    })

    socket.on('device:sites', (sitesData) => {
      Object.entries(sitesData).forEach(([deviceId, site]) => {
        const device = devices.value.find(d => d.id === deviceId)
        if (device) {
          device.site = site
        }
      })
    })

    socket.on('device:nameUpdated', (data) => {
      const device = devices.value.find(d => String(d.id) === String(data.deviceId))
      if (device) {
        device.shortName = data.shortName
      }
    })

    // ✅ Слушатель обновления списка пользователей
    socket.on('device:users', (usersData) => {
      setUsers(usersData)
    })
  }

  const cleanupSocketListeners = () => {
    socket.off('device:list')
    socket.off('device:status')
    socket.off('device:statuses:initial')
    socket.off('device:siteUpdated')
    socket.off('device:sites')
    socket.off('device:removed')
    socket.off('device:nameUpdated')
    socket.off('device:configUpdated')
    socket.off('device:powerStatus')
    socket.off('device:users')
  }

  // ========== RETURN ==========
  return {
    // State
    devices,
    loading,
    currentUserId,
    allDevices,
    users,

    // Computed
    onlineCount,
    offlineCount,
    totalDevices,
    routerDevices,
    availableDevices,
    getDeviceSite,

    // Methods: General
    getUserName,
    getUserByIp,
    getUserById,
    setUsers,
    setDevices,
    setCurrentUserId,
    updateDeviceStatus,
    initializeSocketListeners,
    cleanupSocketListeners,
    getDeviceWanType,

    // Methods: Devices
    removeDevice,
    reloadConfigs,
    addDevice,
    updateDeviceShortName,

    // ✅ Methods: Users
    addUser,
    removeUser,
    updateUserName,
    reloadUsers
  }
})