import { defineStore } from 'pinia'
import { ref, computed, inject } from 'vue'
import { socket } from '@/socket'

export const useDeviceStore = defineStore('devices', () => {
  // State
  const devices = ref([])
  const loading = ref(false)
  const isBookedSectionCollapsed = ref(false)
  const currentUserId = ref(null)
  const allDevices = ref([])
  const users = ref([])

  // Getters
  const bookedDevices = computed(() => {
    return devices.value.filter(device => 
      device.booking?.isBooked && 
      device.booking?.bookedBy === currentUserId.value
    )
  })

  const bookedDevicesCount = computed(() => bookedDevices.value.length)
  
  const availableDevices = computed(() => {
    return devices.value.filter(device => 
      !device.booking?.isBooked || 
      device.booking?.bookedBy !== currentUserId.value
    )
  })

  const bookedByOtherDevices = computed(() => {
    return devices.value.filter(device => 
      device.booking?.isBooked && 
      device.booking?.bookedBy !== currentUserId.value
    )
  })

  // ✅ ИСПРАВЛЕННЫЙ userMap - используем ip как идентификатор
  const userMap = computed(() => {
    if (!users.value || !Array.isArray(users.value) || users.value.length === 0) {
      return new Map()
    }
    
    // Используем ip как идентификатор (как в getUserByIp)
    return new Map(users.value.map(user => [user.ip, user]))
  })

  // ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ - переименована в getUserByIp для ясности
  const getUserByIp = (userIp) => {
    if (!userIp || !userMap.value.size) return null
    return userMap.value.get(userIp)
  }
  
  // ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ - использует getUserByIp
  const getUserName = (userIp) => {
    if (!userIp) return 'Unknown User'
    
    const user = getUserByIp(userIp)
    return user?.name || `User ${userIp}`
  }
  
    const getDeviceWanType = (deviceId) => {
      const device = devices.value.find(d => d.id === deviceId)
      return device?.wanType || null
    }
  // ✅ ДОБАВЛЕНА ФУНКЦИЯ для получения по ID (если нужно)
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
  // const macAddresses = computed(() => {
  //   console.log('Devices array:', devices.value); // посмотрите в консоли
  //   console.log('First device:', devices.value[0]); // первое устройство
    
  //   return devices.value
  //     .map(device => {
  //       console.log('Processing device:', device);
  //       return device.macAddress;
  //     })
  //     .filter(mac => {
  //       console.log('MAC address:', mac);
  //       return mac;
  //     });
  // });
  const totalDevices = computed(() => devices.value.length)

  const routerDevices = computed(() => 
    devices.value.filter(device => device.type === 'router')
  )

  // Actions
  const setDevices = (newDevices) => {
    devices.value = newDevices
  }

  const setUsers = (usersData) => {
    users.value = usersData || []
    // console.log('👥 STORE: Users set:', users.value.length)
  }

  const setCurrentUserId = (userId) => {
    currentUserId.value = userId
  }

  const updateDeviceStatus = (deviceId, statusCode) => {
    const deviceIndex = devices.value.findIndex(d => String(d.id) === String(deviceId))
    if (deviceIndex !== -1) {
      const oldStatus = devices.value[deviceIndex].statusCode
      devices.value[deviceIndex].statusCode = statusCode
    }
  }

  const updateDeviceBooking = (deviceId, bookingData) => {
    const deviceIndex = devices.value.findIndex(d => String(d.id) === String(deviceId))
    if (deviceIndex !== -1) {
      devices.value[deviceIndex] = {
        ...devices.value[deviceIndex],
        booking: bookingData
      }
    }
  }

  const bookDevice = (deviceId, durationSeconds) => {
    return new Promise((resolve, reject) => {
        socket.emit('device:book', { 
            deviceId: String(deviceId), 
            duration: durationSeconds 
        }, (response) => {
            if (response?.success) {
                if (response.accessPassword) {
                    // console.log(`🔄 Auto-loading mode for newly booked device ${deviceId}`)
                    
                    window.dispatchEvent(new CustomEvent('device-booked', {
                        detail: {
                            deviceId,
                            password: response.accessPassword
                        }
                    }))
                }
                
                resolve(response)
            } else {
                reject(new Error(response?.message || 'Booking failed'))
            }
        })
    })
  }

  const releaseDevice = (deviceId) => {
    return new Promise((resolve, reject) => {
      socket.emit('device:release', { 
        deviceId: String(deviceId)
      }, (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.message || 'Release failed'))
        }
      })
    })
  }

  const releaseMultipleDevices = async (deviceIds) => {
    return new Promise((resolve, reject) => {
      // console.log(`🔄 Batch releasing ${deviceIds.length} devices:`, deviceIds);
      
      socket.emit('device:releaseMultiple', { 
        deviceIds: deviceIds.map(id => String(id))
      }, (response) => {
        if (response?.success) {
          // console.log(`✅ Batch release successful: ${response.released} devices`);
          resolve(response);
        } else {
          // console.error('❌ Batch release failed:', response?.message);
          reject(new Error(response?.message || 'Batch release failed'));
        }
      });
    });
  }

  const extendBooking = (deviceId, additionalDuration) => {
    return new Promise((resolve, reject) => {
      socket.emit('device:extend', { 
        deviceId: String(deviceId), 
        additionalDuration: additionalDuration 
      }, (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.message || 'Extension failed'))
        }
      })
    })
  }

  // Socket listeners
  const initializeSocketListeners = () => {
    // console.log('🔌 STORE: Initializing socket listeners')
    
    socket.on('device:statuses:initial', (statuses) => {
      // console.log('📊 STORE: Received initial device statuses:', statuses.length);
      
      statuses.forEach(({ deviceId, status }) => {
        updateDeviceStatus(deviceId, status);
      });
    });
  

    socket.on('device:bookingUpdated', (data) => {
      // console.log('🎯 STORE: Booking updated:', data)
      updateDeviceBooking(data.deviceId, data.booking)
    })

    socket.on('device:list', (newDevices) => {
      // console.log('📋 STORE: Device list received:', newDevices.length)
      setDevices(newDevices)
      loading.value = false
    })

    socket.on('device:status', (data) => {
      // console.log('📊 STORE: Device status update received:', data);
      
      if (data && data.deviceId !== undefined && data.status !== undefined) {
        updateDeviceStatus(data.deviceId, data.status);
      } else {
        // console.warn('⚠️ STORE: Invalid device status format:', data);
      }
    });

    socket.on('device:batchBookingUpdated', (data) => {
      // console.log('🔄 Received batch booking update:', data);
      
      if (data.action === 'release' && data.successful && Array.isArray(data.successful)) {
        data.successful.forEach(deviceId => {
          updateDeviceBooking(deviceId, null);
        });
        
        // console.log(`✅ Updated ${data.successful.length} devices in store`);
      }
    });
  } 

  const cleanupSocketListeners = () => {
    // console.log('🧹 STORE: Cleaning up socket listeners')
    socket.off('device:bookingUpdated')
    socket.off('device:list')
    socket.off('device:status')
    socket.off('device:statuses:initial')
    socket.off('device:batchBookingUpdated')
  }

  // UI actions
  const expandBookedSection = () => {
    isBookedSectionCollapsed.value = false
    localStorage.setItem('bookedDevicesSectionCollapsed', 'false')
  }

  const collapseBookedSection = () => {
    isBookedSectionCollapsed.value = true
    localStorage.setItem('bookedDevicesSectionCollapsed', 'true')
  }

  const loadCollapsedState = () => {
    const savedState = localStorage.getItem('bookedDevicesSectionCollapsed')
    if (savedState !== null) {
      isBookedSectionCollapsed.value = JSON.parse(savedState)
    }
  }

  return {
    // State
    devices,
    loading,
    isBookedSectionCollapsed,
    currentUserId,
    allDevices,
    users,

    // Getters
    bookedDevices,
    bookedDevicesCount,
    availableDevices,
    bookedByOtherDevices,
    onlineCount,
    offlineCount,
    totalDevices,
    routerDevices,

    // Methods
    getUserName,
    getUserByIp,
    getUserById,
    setUsers,
    setDevices,
    setCurrentUserId,
    updateDeviceStatus,
    updateDeviceBooking,
    bookDevice,
    releaseDevice,
    extendBooking,
    expandBookedSection,
    collapseBookedSection,
    loadCollapsedState,
    releaseMultipleDevices,
    initializeSocketListeners,
    cleanupSocketListeners,
    getDeviceWanType
  }
})