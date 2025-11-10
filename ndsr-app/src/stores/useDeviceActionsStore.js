import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { socket } from '@/socket'
import { useToast } from 'primevue/usetoast'
import { useClipboardStore } from './useClipboardStore'
import { useDeviceStore } from './useDeviceStore'
import { useModeStore } from './useModeStore' 

export const useDeviceActionsStore = defineStore('deviceActions', () => {
  const clipboardStore = useClipboardStore()
  const deviceStore = useDeviceStore()
  const modeStore = useModeStore()
  const toast = useToast()

  // ✅ States
  const activeOperations = ref(new Map())
  const previousOperations = ref(new Map())

  // ✅ Computed Getters
  const isAnyOperationActive = computed(() => activeOperations.value.size > 0)
  
  const operationChanges = computed(() => {
    const changes = {
      started: [],
      finished: []
    }
    
    deviceStore.bookedDevices.forEach(device => {
      const currentOp = getDeviceOperation(device.id)
      const previousOp = previousOperations.value.get(device.id)
      
      if (currentOp && currentOp !== previousOp) {
        changes.started.push({
          deviceId: device.id,
          hwId: device.hwId,
          operation: currentOp,
          device
        })
      }
      
      if (previousOp && !currentOp) {
        changes.finished.push({
          deviceId: device.id,
          hwId: device.hwId,
          operation: previousOp,
          device
        })
      }
    })
    
    return changes
  })

  const safeClearOperation = (deviceId) => {
    setTimeout(() => {
        const newOperations = new Map(activeOperations.value)
        if (newOperations.has(deviceId)) {
            newOperations.delete(deviceId)
            activeOperations.value = newOperations
            // console.log(`🧹 Safely cleared operation for device ${deviceId}`)
        }
    }, 1000)
}
  // ✅ УЛУЧШЕННЫЙ МЕТОД ДЛЯ ЗАВЕРШЕНИЯ ОПЕРАЦИЙ С ОБНОВЛЕНИЕМ РЕЖИМА
  const finishOperationWithModeRefresh = async (deviceId) => {
    // console.log(`🎯 Finishing operation for device ${deviceId} with mode refresh`)
    
    // ✅ НЕМЕДЛЕННО ОБНОВЛЯЕМ ПРОГРЕСС ДО 100%
    updateOperationProgress(deviceId, 100)
    
    // ✅ ЗАДЕРЖКА ПЕРЕД ОБНОВЛЕНИЕМ РЕЖИМА
    setTimeout(async () => {
        try {
            const device = deviceStore.devices.find(d => d.id === deviceId)
            if (device && device.booking?.accessPassword) {
                // console.log(`🔄 Refreshing mode for ${device.hwId} after operation`)
                await modeStore.forceModeCheck(deviceId, device.booking.accessPassword)
                // console.log(`✅ Mode refreshed after operation for ${device.hwId}`)
            }
        } catch (error) {
            // console.log(`⚠️ Mode refresh after operation failed:`, error.message)
        } finally {
            // ✅ ВСЕГДА ОЧИЩАЕМ ОПЕРАЦИЮ
            const newOperations = new Map(activeOperations.value)
            newOperations.delete(deviceId)
            activeOperations.value = newOperations
            // console.log(`🧹 Cleared operation for device ${deviceId}`)
        }
    }, 2000)
}

  // ✅ Methods
  const isDeviceBusy = (deviceId) => activeOperations.value.has(deviceId)
  
  const getDeviceOperation = (deviceId) => {
    const operation = activeOperations.value.get(deviceId)
    return operation?.type || null
  }
  
  const getDeviceProgress = (deviceId) => {
    const operation = activeOperations.value.get(deviceId)
    return operation?.progress || 0
  }

  const startOperation = (deviceId, operationType) => {
    // console.log('🚀 Starting operation:', { deviceId, operationType, timestamp: Date.now() })
    
    activeOperations.value.set(deviceId, {
        type: operationType,
        progress: 0,
        startedAt: Date.now()
    })
    activeOperations.value = new Map(activeOperations.value) 
}

  const updateOperationProgress = (deviceId, progress) => {
    const operation = activeOperations.value.get(deviceId)
    if (operation) {
        const newOperations = new Map(activeOperations.value)
        newOperations.set(deviceId, {
            ...operation,
            progress: Math.min(100, Math.max(0, progress))
        })
        activeOperations.value = newOperations
    }
  }

  const finishOperation = (deviceId) => {
    updateOperationProgress(deviceId, 100)
    setTimeout(() => {
      const newOperations = new Map(activeOperations.value)
      newOperations.delete(deviceId)
      activeOperations.value = newOperations
    }, 1000)
  }

  // ✅ Основной метод для обработки изменений операций
  const processOperationChanges = () => {
    operationChanges.value.started.forEach(change => {
      showOperationNotification(change.hwId, change.operation, 'started')
    })
    
    operationChanges.value.finished.forEach(change => {
      showOperationNotification(change.hwId, change.operation, 'finished')
    })
    
    updatePreviousOperations()
  }

  const updatePreviousOperations = () => {
    const newPreviousOps = new Map()
    deviceStore.bookedDevices.forEach(device => {
      const currentOp = getDeviceOperation(device.id)
      if (currentOp) {
        newPreviousOps.set(device.id, currentOp)
      }
    })
    previousOperations.value = newPreviousOps
  }

  const showOperationNotification = (hwId, operation, status) => {
    const messages = {
      rebooting: {
        started: { 
          severity: 'warn', 
          summary: 'Device Rebooting', 
          detail: `${hwId} is restarting...`,
          life: 4000
        }
        // finished: {
        //   severity: 'success',
        //   summary: 'Reboot Complete', 
        //   detail: `${hwId} is back online`,
        //   life: 3000
        // }
      },
      resetting: {
        started: {
          severity: 'warn',
          summary: 'Resetting Configuration',
          detail: `${hwId} configuration is being reset...`,
          life: 5000
        }
        // finished: {
        //   severity: 'success',
        //   summary: 'Reset Complete',
        //   detail: `${hwId} configuration has been reset`,
        //   life: 3000
        // }
      },
      resettingDsl: {
        started: {
          severity: 'info',
          summary: 'Resetting DSL Line',
          detail: `${hwId} DSL line is being reset...`,
          life: 4000
        },
        finished: {
          severity: 'success',
          summary: 'DSL Reset Complete',
          detail: `${hwId} DSL line has been reset`,
          life: 3000
        }
      },
      initializing: {
        started: {
          severity: 'info',
          summary: 'Initializing Device',
          detail: `${hwId} is being initialized...`,
          life: 4000
        },
        // finished: {
        //   severity: 'success',
        //   summary: 'Initialization Complete',
        //   detail: `${hwId} has been initialized successfully`,
        //   life: 3000
        // }
      }
    }

    const messageConfig = messages[operation]?.[status]
    if (messageConfig) {
      toast.add(messageConfig)
    }
  }


// В useDeviceActionsStore.js - ДОБАВИТЬ ПАРАМЕТР data
const executeDeviceAction = async (device, operationType, socketEvent, data = null, timeout = 130000) => {
  if (isDeviceBusy(device.id)) {
    toast.add({
      severity: 'warn',
      summary: 'Operation In Progress',
      detail: `Operation already in progress for ${device.hwId}`,
      life: 3000
    })
    return
  }

  startOperation(device.id, operationType)

  try {
    const progressInterval = setInterval(() => {
      const currentProgress = getDeviceProgress(device.id)
      if (currentProgress < 80) {
        updateOperationProgress(device.id, currentProgress + 5)
      }
    }, 3000)

    const result = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        clearInterval(progressInterval)
        reject(new Error('Operation timeout'))
      }, timeout)

      const socketCallback = (error, response) => {
        clearTimeout(timeoutId)
        clearInterval(progressInterval)
        
        if (error) {
          reject(error)
        } else {
          updateOperationProgress(device.id, 100)
          resolve(response)
        }
      }

      // ✅ ИСПРАВЛЕНИЕ: Передаем device.id если data не указан
      if (data !== null) {
        socket.timeout(timeout).emit(socketEvent, data, socketCallback)
      } else {
        socket.timeout(timeout).emit(socketEvent, device.id, socketCallback)
      }
    })

    await finishOperationWithModeRefresh(device.id)
    return result

  } catch (error) {
    console.error(`❌ ${operationType} failed for ${device.hwId}:`, error)
    const newOperations = new Map(activeOperations.value)
    newOperations.delete(device.id)
    activeOperations.value = newOperations
    throw error
  }
}



const resetConfig = async (device) => {
  try {
    // console.log('🔄 Starting reset for device:', device.hwId);
    
    // ✅ ПЕРЕДАЕМ device.id ВМЕСТО device
    const response = await executeDeviceAction(device, 'resetting', 'device:resetConfig', device.id);
    
    if (response?.status === 'ok') {
      toast.add({
        severity: 'success',
        summary: 'Configuration Reset',
        detail: `Configuration successfully reset for ${device.shortName} (${device.hwId})`,
        life: 4000
      });
    } else {
      throw new Error(response?.error || 'Reset failed');
    }
  } catch (error) {
    console.error(`❌ Reset config failed for ${device.hwId}:`, error);
    
    if (error.message.includes('timeout') || error.message.includes('Status update timeout')) {
      toast.add({
        severity: 'warn',
        summary: 'Reset Taking Longer',
        detail: `${device.shortName} reset initiated but taking longer to complete. Device may still reset successfully.`,
        life: 5000
      });
    } else {
      toast.add({
        severity: 'error',
        summary: 'Reset Failed',
        detail: `Failed to reset ${device.shortName}: ${error.message}`,
        life: 5000
      });
    }
    throw error;
  }
}

// ✅ ИСПРАВЛЕННЫЙ rebootDevice
const rebootDevice = async (device) => {
  try {
      const response = await executeDeviceAction(device, 'rebooting', 'device:reboot')
      
      if (response?.status === 'ok') {
          
          toast.add({
              severity: 'success',
              summary: 'Reboot Complete',
              detail: `${device.shortName} ${device.hwId} was successfully rebooted`,
              life: 4000
          })
      } else {
          throw new Error(response?.error || 'Reboot failed')
      }
  } catch (error) {
      console.error(`❌ Reboot failed for ${device.hwId}:`, error)
      
      // ✅ УЛУЧШЕННАЯ ОБРАБОТКА ОШИБОК ТАЙМАУТА
      if (error.message.includes('timeout') || error.message.includes('Status update timeout')) {
          toast.add({
              severity: 'warn',
              summary: 'Reboot Taking Longer',
              detail: `${device.shortName} reboot initiated but taking longer to complete. Device may still reboot successfully.`,
              life: 5000
          })
      } else {
          toast.add({
              severity: 'error',
              summary: 'Reboot Failed',
              detail: `Failed to reboot ${device.shortName}: ${error.message}`,
              life: 5000
          })
      }
      throw error
  }
}

  const resetDslLine = async (device) => {
    try {
      const response = await executeDeviceAction(device, 'resettingDsl', 'device:resetDslLine', null, 60000)
      
      if (response?.status === 'ok') {
        toast.add({
          severity: 'success',
          summary: 'DSL Reset Complete',
          detail: `${device.shortName} ${device.hwId} successful reset DSL line!`,
          life: 3000
        })
      } else {
        throw new Error(response?.error || 'DSL reset failed')
      }
    } catch (error) {
      toast.add({
        severity: 'error',
        summary: 'DSL Reset Failed',
        detail: `Failed to reset DSL line ${device.shortName}: ${error.message}`,
        life: 4000
      })
    }
  }

  const initializationDevice = async (device, password) => {
    if (device.statusCode !== 200) {
      toast.add({
          severity: 'error',
          summary: 'Device Offline',
          detail: `Device ${device.hwId} is offline. Cannot initialize.`,
          life: 4000
      })
      return
  }
  
    if (!device.checkUrl) {
      toast.add({
        severity: 'error',
        summary: 'Missing Check URL',
        detail: `Device ${device.hwId} has no checkUrl. Cannot initialize.`,
        life: 4000
      })
      return
    }
  
    if (!password) {
      toast.add({
        severity: 'error',
        summary: 'Password Required',
        detail: `No password provided for ${device.hwId}`,
        life: 4000
      })
      return
    }
  
    const host = device.checkUrl
    const url = `${host}/rci/`
    
    try {
      const requestData = {
          deviceId: device.id,
          url: url,
          body: [
              { "eula": { "accept": {} }},
              {"dpn": {"accept": {}}},
              {"easyconfig": {"disable": true}},
              {"user":{"password":{"plain":{"name":"admin","password": password}}}},
              {"user":{"password":{"name":"admin","password": password}}},
              {"system": {"configuration": {"save": true}}}
          ]
      }

        const response = await executeDeviceAction(
          device, 
          'initializing', 
          'device:init', 
          requestData,
          40000
      )

      if (response?.success || response?.status === 'ok') {
        // ✅ ОБНОВЛЯЕМ РЕЖИМ ПОСЛЕ ИНИЦИАЛИЗАЦИИ
        
        await clipboardStore.copyToClipboard(password, `${device.hwId} initialized! Password copied to clipboard.`)
        // toast.add({
        //     severity: 'success',
        //     summary: 'Initialization Complete',
        //     detail: `Device ${device.hwId} successfully initialized!`,
        //     life: 4000
        // })
    } else {
        throw new Error(response?.error || response?.message || 'Unknown error during initialization')
    }
} catch (error) {
    console.error(`❌ Initialization failed for ${device.hwId}:`, error)
    
    // ✅ БЕЗОПАСНО ОЧИЩАЕМ ОПЕРАЦИЮ ПРИ ОШИБКЕ
    safeClearOperation(device.id)
    
    toast.add({
        severity: 'error',
        summary: 'Initialization Failed',
        detail: `Failed to initialize ${device.shortName}: ${error.message}`,
        life: 5000
    })
}
}

  // ✅ ЭКСПОРТИРУЕМ ФУНКЦИЮ ДЛЯ РУЧНОГО ВЫЗОВА
  return {
    // States
    activeOperations,
    
    // Getters
    isAnyOperationActive,
    operationChanges,
    isDeviceBusy,
    getDeviceOperation,
    getDeviceProgress,
    
    // Actions
    processOperationChanges,
    resetConfig,
    rebootDevice,
    resetDslLine,
    initializationDevice,
  }
})