import { defineStore } from 'pinia'
import { ref, onUnmounted } from 'vue'
import { socket } from '@/socket'

export const useFirmwareStore = defineStore('firmware', () => {
  const isLoadingFirmware = ref(false)
  const firmwareCache = ref(new Map())
  
  // ✅ Защита от повторных обработок
  const lastAutoCheckTime = ref(new Map())
  const pendingAutoChecks = ref(new Set())

  // ✅ Socket слушатели ТОЛЬКО в store
  const setupSocketListeners = () => {
    socket.on('device:checkFirmware', handleAutoFirmwareCheck)
    socket.on('device:bookingUpdated', handleBookingUpdate)
    socket.on('device:resetConfig', handleDeviceAction)
    socket.on('device:reboot', handleDeviceAction)
    socket.on('device:resetDslLine', handleDeviceAction)
    socket.on('device:batchFirmwareUpdated', (data) => {
      // console.log('🔄 Received batch firmware update:', data)
      
      if (data.successful && Array.isArray(data.successful)) {
        data.successful.forEach(({ deviceId, version }) => {
          firmwareCache.value.set(deviceId, {
            version: version,
            timestamp: Date.now(),
            error: null,
            errorType: null
          })
        })
        // console.log(`✅ Updated ${data.successful.length} firmware versions in store`)
      
        // Триггерим событие для компонентов
        window.dispatchEvent(new CustomEvent('firmware:batchUpdated', {
          detail: data
        }))
      }
    })
  }
  const cleanupSocketListeners = () => {
    socket.off('device:checkFirmware', handleAutoFirmwareCheck)
    socket.off('device:bookingUpdated', handleBookingUpdate)
    socket.off('device:resetConfig', handleDeviceAction)
    socket.off('device:reboot', handleDeviceAction)
    socket.off('device:resetDslLine', handleDeviceAction)
  }

  // ✅ Обработчик автоматической проверки прошивки
  const handleAutoFirmwareCheck = (data) => {
    if (data.reason === 'status_change') {
      const now = Date.now()
      const lastCheck = lastAutoCheckTime.value.get(data.deviceId) || 0
      
      // ❌ Защита от слишком частых проверок (30 секунд)
      if (now - lastCheck < 30000) {
        // console.log(`⏳ Store: Skipping frequent auto check for device ${data.deviceId}`)
        return
      }
      
      lastAutoCheckTime.value.set(data.deviceId, now)
      pendingAutoChecks.value.add(data.deviceId)
      
      // console.log(`🔄 Store: Auto firmware check for device ${data.deviceId}`)
      
      // Триггерим событие для компонентов
      window.dispatchEvent(new CustomEvent('firmware:autoCheck', {
        detail: { deviceId: data.deviceId }
      }))
    }
  }

  // ✅ Обработчик обновлений бронирований
  const handleBookingUpdate = (data) => {
    if (!data.booking.isBooked) {
      // Очищаем кэш при освобождении устройства
      clearFirmwareCache(data.deviceId)
      // console.log(`🧹 Store: Cleared cache for released device ${data.deviceId}`)
    }
    
    // Триггерим событие для компонентов
    window.dispatchEvent(new CustomEvent('firmware:bookingUpdated', {
      detail: data
    }))
  }

  const checkMultipleFirmwares = async (deviceIds, passwords = {}) => {
    return new Promise((resolve, reject) => {
      // console.log(`🔄 Batch firmware check for ${deviceIds.length} devices`)
      
      socket.emit('device:checkMultipleFirmwares', { 
        deviceIds: deviceIds.map(id => String(id)),
        passwords: passwords // Опционально: разные пароли для устройств
      }, (response) => {
        if (response?.success) {
          // console.log(`✅ Batch firmware check completed: ${response.checked} devices`)
          
          // Обновляем кэш для успешных проверок
          response.details.successful.forEach(({ deviceId, version }) => {
            firmwareCache.value.set(deviceId, {
              version: version,
              timestamp: Date.now(),
              error: null,
              errorType: null
            })
          })
          
          resolve(response)
        } else {
          console.error('❌ Batch firmware check failed:', response?.message)
          reject(new Error(response?.message || 'Batch firmware check failed'))
        }
      })
    })
  }
  // ✅ Обработчик действий с устройством
  const handleDeviceAction = (data) => {
    clearFirmwareCache(data.deviceId)
    // console.log(`🔧 Store: Cleared cache after device action ${data.deviceId}`)
    
    // Триггерим событие для компонентов
    window.dispatchEvent(new CustomEvent('firmware:deviceAction', {
      detail: data
    }))
  }

  const getFirmwareVersion = async (device, password = null, forceRefresh = false) => {
    const deviceId = device.id
    
    if (device.statusCode !== 200) {
      firmwareCache.value.set(deviceId, {
        version: null,
        timestamp: Date.now(),
        error: 'Device is offline',
        errorType: 'offline'
      })
      return null
    }
    
    if (!forceRefresh && firmwareCache.value.has(deviceId)) {
      const cached = firmwareCache.value.get(deviceId)
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        if (cached.error) {
          throw new Error(cached.error)
        }
        return cached.version
      }
    }

    if (!password) {
      const errorMsg = 'No password available'
      firmwareCache.value.set(deviceId, {
        version: null,
        timestamp: Date.now(),
        error: errorMsg,
        errorType: 'no_password'
      })
      throw new Error(errorMsg)
    }

    isLoadingFirmware.value = true

    try {
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const errorMsg = 'Request timeout'
          firmwareCache.value.set(deviceId, {
            version: null,
            timestamp: Date.now(),
            error: errorMsg,
            errorType: 'timeout'
          })
          reject(new Error(errorMsg))
        }, 15000)

        socket.emit(
          'device:getCurrentFW', 
          { 
            deviceId: deviceId,
            login: 'admin',
            password: password 
          }, 
          (response) => {
            clearTimeout(timeout)
            
            if (response?.success) {
              const version = response.sessionCookie?.release || 'Unknown'
              
              firmwareCache.value.set(deviceId, {
                version: version,
                timestamp: Date.now(),
                error: null,
                errorType: null
              })
              resolve(version)
            } else {
              const errorMessage = response?.error || 'Failed to get firmware version'
              const errorType = response?.errorType || 'unknown'
              
              firmwareCache.value.set(deviceId, {
                version: null,
                timestamp: Date.now(),
                error: errorMessage,
                errorType: errorType
              })
              
              reject(new Error(errorMessage))
            }
          }
        )
      })
    } catch (error) {
      if (forceRefresh) {
        // console.error(`Error getting firmware for ${device.hwId}:`, error.message)  
      }
      throw error
    } finally {
      isLoadingFirmware.value = false
      pendingAutoChecks.value.delete(deviceId)
    }
  }

  const clearFirmwareCache = (deviceId = null) => {
    return new Promise((resolve) => {
      if (deviceId) {
        if (firmwareCache.value.has(deviceId)) {
          firmwareCache.value.delete(deviceId)
        }
        
        socket.emit('device:clearFirmwareCache', deviceId, (response) => {
          resolve(response)
        })
      } else {
        firmwareCache.value.clear()
        resolve({ success: true })
      }
    })
  }

  const refreshFirmwareForDevice = async (device, currentUserId, todayPassword) => {
    let password = todayPassword
    
    if (device.booking?.isBooked && 
        device.booking?.bookedBy === currentUserId && 
        device.booking?.accessPassword) {
      password = device.booking.accessPassword
    }

    if (!password) {
      console.warn(`No password available for device ${device.hwId}`)
      return null
    }

    return await getFirmwareVersion(device, password, true)
  }

  // Инициализация store
  setupSocketListeners()
  
  // Очистка при уничтожении store
  onUnmounted(() => {
    cleanupSocketListeners()
  })

  return {
    isLoadingFirmware,
    getFirmwareVersion,
    clearFirmwareCache,
    refreshFirmwareForDevice,
    firmwareCache,
    pendingAutoChecks
  }
})