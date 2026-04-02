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
  const powerStatusVersion = ref(0)

  // ✅ States
  const activeOperations = ref(new Map())
  const previousOperations = ref(new Map())
  
  // ✅ Состояние для статуса питания (только реальные значения с сервера)
  const powerStatuses = ref(new Map())

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

  // ✅ Геттеры для статуса питания (без значений по умолчанию)
  const getPowerStatus = (deviceId) => {
    return powerStatuses.value.get(deviceId) // Вернет undefined если статуса нет
  }

  const isPoweredOn = (deviceId) => {
    const status = getPowerStatus(deviceId)
    return status === 'on' // только true если точно 'on'
  }

  const isPoweredOff = (deviceId) => {
    const status = getPowerStatus(deviceId)
    return status === 'off' // только true если точно 'off'
  }

  const hasPowerStatus = (deviceId) => {
    return powerStatuses.value.has(deviceId) // проверяем, есть ли статус
  }

  const initializePowerListeners = () => {
    socket.on('device:powerStatus', (data) => {
      const oldStatus = powerStatuses.value.get(data.deviceId)
      const statusChanged = oldStatus !== data.status
      
      // Обновляем статус
      powerStatuses.value.set(data.deviceId, data.status)
      
      // ✅ Увеличиваем счетчик ТОЛЬКО при реальном изменении
      if (statusChanged || data.isInitial) {
        powerStatusVersion.value++
        // console.log(`🔄 Power status version: ${powerStatusVersion.value} (${data.deviceId}: ${data.status})`)
      }
      
      // Обновляем в deviceStore
      const device = deviceStore.devices?.find(d => d.id === data.deviceId)
      if (device) device.powerStatus = data.status
    })
  }
  initializePowerListeners()
  const getPowerStatusVersion = () => powerStatusVersion.value
  // ✅ Очистка слушателей (важно для предотвращения утечек памяти)
  const cleanupPowerListeners = () => {
    socket.off('device:powerStatus');
  };

  const safeClearOperation = (deviceId) => {
    setTimeout(() => {
        const newOperations = new Map(activeOperations.value)
        if (newOperations.has(deviceId)) {
            newOperations.delete(deviceId)
            activeOperations.value = newOperations
        }
    }, 1000)
  }

  const finishOperationWithModeRefresh = async (deviceId) => {
    updateOperationProgress(deviceId, 100)
    
    setTimeout(async () => {
        try {
            const device = deviceStore.devices.find(d => d.id === deviceId)
            if (device && device.booking?.accessPassword) {
                await modeStore.forceModeCheck(deviceId, device.booking.accessPassword)
            }
        } catch (error) {
            // console.log(`⚠️ Mode refresh after operation failed:`, error.message)
        } finally {
            const newOperations = new Map(activeOperations.value)
            newOperations.delete(deviceId)
            activeOperations.value = newOperations
        }
    }, 2000)
  }

  // ✅ Методы
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
      },
      resetting: {
        started: {
          severity: 'warn',
          summary: 'Resetting Configuration',
          detail: `${hwId} configuration is being reset...`,
          life: 5000
        }
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
        }
      }
    }

    const messageConfig = messages[operation]?.[status]
    if (messageConfig) {
      toast.add(messageConfig)
    }
  }

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

const powerDevice = async (device, action) => {
  try {
      if (!['on', 'off'].includes(action)) {
          throw new Error(`Invalid action: ${action}. Must be 'on' or 'off'`);
      }
      
      // Проверка наличия rebootPort
      if (!device || !device.rebootPort) {
          console.error('❌ Invalid device for power operation:', device);
          throw new Error(`Device not found or reboot port not configured`);
      }

      console.log('🔌 Power device:', { 
          deviceId: device.id, 
          hwId: device.hwId, 
          action,
          rebootPort: device.rebootPort 
      });

      // Выполняем действие
      const response = await executeDeviceAction(
          device, 
          `power_${action}`,
          'device:power',
          { 
              deviceId: device.id,
              action: action
          },
          30000
      );
      
      // Проверяем ответ - сервер возвращает { status: 'ok' } а не { success: true }
      if (response?.status === 'ok') {
          const actionText = action === 'on' ? 'powered on' : 'powered off';
          toast.add({
              severity: 'success',
              summary: 'Power Operation Complete',
              detail: `${device.shortName} ${device.hwId} was successfully ${actionText}`,
              life: 4000
          });
          
          // Обновляем статус питания в store
          // Статус обновится автоматически через socket.on('device:powerStatus')
          
          return response;
      } else {
          throw new Error(response?.error || `Power ${action} failed`);
      }
      
  } catch (error) {
      console.error(`❌ Power ${action} failed for ${device?.hwId}:`, error);
      
      // Улучшенная обработка ошибок
      if (error.message.includes('timeout')) {
          toast.add({
              severity: 'warn',
              summary: 'Power Operation Taking Longer',
              detail: `${device.shortName} power ${action} initiated but taking longer to complete.`,
              life: 5000
          });
      } else if (error.message.includes('port not configured')) {
          toast.add({
              severity: 'error',
              summary: 'Configuration Error',
              detail: `Reboot port not configured for ${device.shortName}`,
              life: 5000
          });
      } else {
          toast.add({
              severity: 'error',
              summary: `Power ${action} Failed`,
              detail: `Failed to power ${action} ${device.shortName}: ${error.message}`,
              life: 5000
          });
      }
      throw error;
  }
};
  const silentRebootDevice = async (device) => {
    try {
      console.log(`[SILENT_REBOOT] Sending reboot command to ${device.hwId}`);
      
      // Отправляем команду без отслеживания прогресса
      const result = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Reboot command timeout'));
        }, 30000);

        const socketCallback = (error, response) => {
          clearTimeout(timeoutId);
          
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        };

        socket.timeout(30000).emit('device:reboot', device.id, socketCallback);
      });

      if (result?.status === 'ok') {
        console.log(`[SILENT_REBOOT] Command sent successfully to ${device.hwId}`);
        return result;
      } else {
        throw new Error(result?.error || 'Reboot failed');
      }
    } catch (error) {
      console.error(`[SILENT_REBOOT] Failed for ${device.hwId}:`, error);
      throw error;
    }
  };
  const silentPowerDevice = async (device, action) => {
    try {
      console.log(`[SILENT_POWER] Sending power ${action} command to ${device.hwId}`);
      
      const result = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`Power ${action} command timeout`));
        }, 30000);
  
        const socketCallback = (error, response) => {
          clearTimeout(timeoutId);
          
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        };
  
        socket.timeout(30000).emit('device:power', {
          deviceId: device.id,
          action: action
        }, socketCallback);
      });
  
      if (result?.status === 'ok') {
        console.log(`[SILENT_POWER] Power ${action} command sent successfully to ${device.hwId}`);
        return result;
      } else {
        throw new Error(result?.error || `Power ${action} failed`);
      }
    } catch (error) {
      console.error(`[SILENT_POWER] Failed for ${device.hwId}:`, error);
      throw error;
    }
  };
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
        await clipboardStore.copyToClipboard(password, `${device.hwId} initialized! Password copied to clipboard.`)
      } else {
        throw new Error(response?.error || response?.message || 'Unknown error during initialization')
      }
    } catch (error) {
      console.error(`❌ Initialization failed for ${device.hwId}:`, error)
      
      safeClearOperation(device.id)
      
      toast.add({
        severity: 'error',
        summary: 'Initialization Failed',
        detail: `Failed to initialize ${device.shortName}: ${error.message}`,
        life: 5000
      })
    }
  }

  // ✅ ЭКСПОРТ
  return {
    // States
    activeOperations,
    powerStatuses,
    
    // Getters
    isAnyOperationActive,
    operationChanges,
    isDeviceBusy,
    getDeviceOperation,
    getDeviceProgress,
    getPowerStatus,
    isPoweredOn,
    isPoweredOff,
    hasPowerStatus,
    
    // Actions
    processOperationChanges,
    resetConfig,
    rebootDevice,
    resetDslLine,
    initializationDevice,
    powerDevice,
    cleanupPowerListeners,
    silentRebootDevice,
    silentPowerDevice,
    powerStatusVersion,
    getPowerStatusVersion,
    initializePowerListeners
  }
})