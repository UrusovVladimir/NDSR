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
    return device?.currentWanType || device?.wanType || null
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
const reloadConfigs = () => {
  return new Promise((resolve, reject) => {
    socket.emit('device:reloadConfigs', (response) => {
      if (response?.success) {
        // ✅ После успешной перезагрузки конфигов на сервере,
        // запрашиваем свежий список устройств
        socket.emit('device:getInitData', (initResponse) => {
          if (initResponse?.success) {
            // Список устройств придет через событие 'device:list'
            // Но мы также можем сразу запросить его
            console.log('✅ Configs reloaded, waiting for device list update...');
            
            // Дополнительно запрашиваем обновление статусов
            socket.emit('device:forceStatusCheckAll', {}, (statusResponse) => {
              console.log('📊 Status check completed after config reload');
            });
            
            resolve({
              ...response,
              message: 'Configuration reloaded and device list updated'
            });
          } else {
            // Даже если initData не удался, резолвим, т.к. конфиги перезагружены
            resolve(response);
          }
        });
      } else {
        reject(new Error(response?.error || 'Failed to reload configs'));
      }
    });
  });
};

// Добавьте эти методы в store:

// ==================== МЕТОДЫ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ ====================

// Получение всех пользователей (из существующего события device:users)
const fetchUsers = () => {
  return new Promise((resolve) => {
    // Пользователи уже должны быть в store после sendInitData
    // Но можно запросить принудительно
    socket.emit('device:getInitData', (response) => {
      if (response?.success) {
        // После этого придет событие device:users
        resolve({ success: true, users: users.value });
      } else {
        resolve({ success: true, users: users.value });
      }
    });
  });
};

// Добавление пользователя (используем существующее событие user:add)
const addNewUser = (userData) => {
  return new Promise((resolve, reject) => {
    socket.emit('user:add', userData, (response) => {
      if (response?.success) {
        // Обновляем список пользователей в store
        if (response.user) {
          const newUsers = [...users.value, response.user];
          setUsers(newUsers);
        }
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Failed to add user'));
      }
    });
  });
};

// Удаление пользователя (используем существующее событие user:remove)
const deleteUser = (ip) => {
  return new Promise((resolve, reject) => {
    socket.emit('user:remove', ip, (response) => {
      if (response?.success) {
        // Удаляем пользователя из локального состояния
        const newUsers = users.value.filter(u => u.ip !== ip);
        setUsers(newUsers);
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Failed to remove user'));
      }
    });
  });
};

// Обновление имени пользователя
const editUserName = (ip, newName) => {
  return new Promise((resolve, reject) => {
    socket.emit('user:updateName', { ip, newName }, (response) => {
      if (response?.success) {
        // Обновляем имя в локальном состоянии
        const userIndex = users.value.findIndex(u => u.ip === ip);
        if (userIndex !== -1) {
          users.value[userIndex].name = newName;
        }
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Failed to update user name'));
      }
    });
  });
};

// Получение пользователя по IP
const getUserByIpAddress = (ip) => {
  return new Promise((resolve) => {
    socket.emit('user:getByIp', ip, (response) => {
      if (response?.success) {
        resolve(response.user);
      } else {
        resolve(null);
      }
    });
  });
};

// Перезагрузка конфигурации пользователей
const reloadUsersConfig = () => {
  return new Promise((resolve, reject) => {
    socket.emit('user:reload', (response) => {
      if (response?.success) {
        resolve({
          ...response,
          usersCount: users.value.length
        });
      } else {
        reject(new Error(response?.error || 'Failed to reload users'));
      }
    });
  });
};

// ==================== МЕТОДЫ ДЛЯ УСТРОЙСТВ ====================

// Добавление устройства
const addDevice = (deviceData) => {
  return new Promise((resolve, reject) => {
    socket.emit('device:add', deviceData, (response) => {
      if (response?.success) {
        // Добавляем устройство в локальный массив
        devices.value.push(response.device || deviceData);
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Failed to add device'));
      }
    });
  });
};

// Удаление устройства
const removeDevice = (deviceId) => {
  return new Promise((resolve, reject) => {
    socket.emit('device:remove', String(deviceId), (response) => {
      if (response?.success) {
        // Удаляем устройство из локального массива
        const index = devices.value.findIndex(d => String(d.id) === String(deviceId));
        if (index !== -1) {
          devices.value.splice(index, 1);
        }
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Failed to remove device'));
      }
    });
  });
};

// Обновление имени устройства
const updateDeviceName = (deviceId, newShortName) => {
  return new Promise((resolve, reject) => {
    socket.emit('device:updateShortName', { 
      deviceId: String(deviceId), 
      newShortName 
    }, (response) => {
      if (response?.success) {
        // Обновляем имя в локальном массиве
        const device = devices.value.find(d => String(d.id) === String(deviceId));
        if (device) {
          device.shortName = newShortName;
        }
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Failed to update device name'));
      }
    });
  });
};

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

      socket.on('device:wanTypeUpdated', (data) => {
        const device = devices.value.find(d => d.id === data.deviceId)
        if (device) {
          device.currentWanType = data.type
        }
    })
      
  } 

  const cleanupSocketListeners = () => {
    // console.log('🧹 STORE: Cleaning up socket listeners')
    socket.off('device:bookingUpdated')
    socket.off('device:list')
    socket.off('device:status')
    socket.off('device:statuses:initial')
    socket.off('device:batchBookingUpdated')
    socket.off('device:wanTypeUpdated')
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
    getDeviceWanType,
    reloadConfigs,
    fetchUsers,
    addNewUser,
    deleteUser,
    getUserByIpAddress,
    reloadUsersConfig,
    editUserName,
    addDevice,
    removeDevice,
    updateDeviceName, 
  }
})