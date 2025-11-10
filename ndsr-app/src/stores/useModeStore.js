import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { socket } from '@/socket'
import { useToast } from 'primevue/usetoast'
import { useDeviceStore } from './usedeviceStore'

export const useModeStore = defineStore('mode', () => {
  const toast = useToast()
  const isLoading = ref(false)
  const deviceStore = useDeviceStore()
  
  const getInitialMode = () => {
    try {
        const saved = localStorage.getItem('deviceCurrentMode');
        if (!saved) return {};
        
        const parsed = JSON.parse(saved);
        // console.log('📖 Reading modes from localStorage:', Object.keys(parsed).length);
        
        // ✅ ВАЛИДИРУЕМ СТРУКТУРУ ДАННЫХ
        Object.keys(parsed).forEach(deviceId => {
            const modeInfo = parsed[deviceId];
            if (!modeInfo.mode) {
                // console.warn(`⚠️ Invalid mode data for ${deviceId}, removing`);
                delete parsed[deviceId];
            }
        });
        
        return parsed;
    } catch (error) {
        // console.error('❌ Error reading modes from localStorage:', error);
        return {};
    }
};

  const currentMode = ref(getInitialMode())
  const error = ref(null)
  const mwsStatus = ref(null)
  const mwsRouter = ref(null)

  // ✅ WATCHER для резервного копирования
  watch(currentMode, (newMode) => {
    try {
      localStorage.setItem('deviceCurrentMode', JSON.stringify(newMode))
    } catch (error) {
      // console.warn('⚠️ Failed to save modes to localStorage:', error)
    }
  }, { deep: true })


  
let modeUpdateInProgress = new Set();

const updateDeviceMode = (deviceId, modeData) => {
    if (!deviceId) return;
    
    // ✅ ЗАЩИТА ОТ ДУБЛИРУЮЩИХ ОБНОВЛЕНИЙ
    if (modeUpdateInProgress.has(deviceId)) {
        // console.log(`⏳ Mode update already in progress for ${deviceId}, skipping`);
        return;
    }
    
    modeUpdateInProgress.add(deviceId);
    
    // console.log('💾 BEFORE Mode update:', deviceId, currentMode.value[deviceId]);
    
    // ✅ СОХРАНЯЕМ ВСЕ ДАННЫЕ С ПРАВИЛЬНОЙ СТРУКТУРОЙ
    currentMode.value[deviceId] = {
        mode: modeData.mode || 'unknown',
        routerId: modeData.routerId !== undefined ? modeData.routerId : null,
        timestamp: modeData.timestamp || Date.now()
    };
    
    // console.log('💾 AFTER Mode updated:', deviceId, currentMode.value[deviceId]);
    
    // ✅ НЕМЕДЛЕННОЕ СОХРАНЕНИЕ В LOCALSTORAGE
    try {
        localStorage.setItem('deviceCurrentMode', JSON.stringify(currentMode.value));
        // console.log('💾 Saved to localStorage');
    } catch (error) {
        // console.warn('⚠️ Failed to save modes to localStorage:', error);
    } finally {
        // ✅ ОЧИЩАЕМ ФЛАГ ЧЕРЕЗ НЕБОЛЬШУЮ ЗАДЕРЖКУ
        setTimeout(() => {
            modeUpdateInProgress.delete(deviceId);
        }, 100);
    }
};


const updateModeFromDetection = async (deviceId, password) => {
  try {
      // console.log(`🔄 Starting mode detection for ${deviceId}`);
      
      const currentModeInfo = currentMode.value[deviceId];
      const currentModeType = currentModeInfo?.mode;
      const currentRouterId = currentModeInfo?.routerId;
      
      const detectedMode = await getCurrentMode(deviceId, password);
      // console.log(`✅ Mode detected for ${deviceId}: ${detectedMode}, current mode: ${currentModeType}`);
      
      // ✅ УМНАЯ ЛОГИКА: СОХРАНЯЕМ РЕЖИМ ПОДКЛЮЧЕНИЯ
      let finalMode = detectedMode;
      let finalRouterId = currentRouterId;
      
      // Если был режим подключения, сохраняем его
      if (currentModeType === 'extender_connect' && detectedMode === 'extender') {
          finalMode = 'extender_connect';
          // console.log(`🔗 Preserving connection mode for ${deviceId}`);
      }
      // Если подключение подтверждено сервером
      else if (detectedMode === 'extender_connect') {
          finalMode = 'extender_connect';
      }
      // Если переключились в роутер, очищаем подключение
      else if (detectedMode === 'router') {
          finalRouterId = null;
      }
      
      updateDeviceMode(deviceId, {
          mode: finalMode,
          routerId: finalRouterId,
          timestamp: Date.now()
      });
      
      return finalMode;
  } catch (error) {
      // console.error(`❌ Mode detection failed for ${deviceId}:`, error);
      throw error;
  }
};
  const preloadDeviceMode = (deviceId) => {
    if (!deviceId) return null;
    
    const savedMode = currentMode.value[deviceId];
    if (savedMode && savedMode.mode) {
      // console.log(`🔍 Preloaded mode for ${deviceId}:`, savedMode);
      return savedMode;
    }
    
    return null;
  };

  // ✅ УМНАЯ ПРОВЕРКА АКТУАЛЬНОСТИ (2 минуты для свежих данных)
  const validateModeData = (deviceId) => {
    const modeInfo = currentMode.value[deviceId]
    if (!modeInfo) return false
    
    // Данные считаются свежими 2 минуты
    const maxAge = 2 * 60 * 1000
    return (Date.now() - modeInfo.timestamp) < maxAge
  }

  const restoreModeConnections = async () => {
    // console.log('🔧 Restoring mode connections from localStorage...')
    
    try {
      const savedModes = getInitialMode()
      let restoredCount = 0
      
      Object.entries(savedModes).forEach(([deviceId, modeInfo]) => {
        if (modeInfo.routerId) {
          if (!currentMode.value[deviceId] || currentMode.value[deviceId].routerId !== modeInfo.routerId) {
            updateDeviceMode(deviceId, {
              mode: modeInfo.mode,
              routerId: modeInfo.routerId,
              timestamp: modeInfo.timestamp
            })
            restoredCount++
            // console.log(`✅ Restored connection for ${deviceId} -> router ${modeInfo.routerId}`)
          }
        }
      })
      
      // console.log(`🔧 Restored ${restoredCount} mode connections`)
      
    } catch (error) {
      // console.error('❌ Failed to restore mode connections:', error)
    }
  }

  const initializeModes = async () => {
    // console.log('🔄 Initializing device modes...');
    
    try {
      // ✅ ИСПОЛЬЗУЕМ УЖЕ ЗАГРУЖЕННЫЕ ДАННЫЕ ИЗ currentMode
      const savedModes = { ...currentMode.value };
      // console.log('📦 Using pre-loaded modes:', Object.keys(savedModes).length, 'modes');
      
      const deviceStore = useDeviceStore();
      const apDevices = deviceStore.devices.filter(dev => 
        dev.type === 'AP' && dev.hWtype === 'true'
      );
      
      // console.log(`🔧 Found ${apDevices.length} AP devices for mode validation`);
      
      let hasChanges = false;
      
      Object.keys(savedModes).forEach(deviceId => {
        const modeInfo = savedModes[deviceId];
        const device = deviceStore.devices.find(d => d.id === deviceId);
        
        if (device && device.type === 'AP' && device.hWtype === 'true') {
          if (modeInfo.mode === 'router') {
            // console.log(`🔧 Исправляем AP устройство ${deviceId}: router -> extender`);
            savedModes[deviceId] = {
              mode: 'extender',
              routerId: null,
              timestamp: modeInfo.timestamp
            };
            hasChanges = true;
          }
        }
      });
  
      for (const device of apDevices) {
        const savedMode = savedModes[device.id];
        
        if (savedMode) {
          // console.log(`🔍 Validating AP device ${device.hwId}:`, savedMode);
          
          if (savedMode.mode === 'router' && savedMode.routerId) {
            // console.log(`⚠️ AP device ${device.id} has router mode but also routerId, fixing to extender_connect`);
            savedModes[device.id] = {
              mode: 'extender_connect',
              routerId: savedMode.routerId,
              timestamp: savedMode.timestamp
            };
            hasChanges = true;
          } else if (savedMode.mode === 'router' && !savedMode.routerId) {
            // console.log(`🔧 AP device ${device.id} in router mode - fixing to extender`);
            savedModes[device.id] = {
              mode: 'extender',
              routerId: null,
              timestamp: savedMode.timestamp
            };
            hasChanges = true;
          } else if (savedMode.mode === 'extender_connect' && !savedMode.routerId) {
            // console.log(`⚠️ AP device ${device.id} has extender_connect mode without routerId, fixing to extender`);
            savedModes[device.id] = {
              mode: 'extender',
              routerId: null,
              timestamp: savedMode.timestamp
            };
            hasChanges = true;
          }
        } else {
          // console.log(`🔧 New AP device ${device.id}, setting default mode: extender`);
          savedModes[device.id] = {
            mode: 'extender',
            routerId: null,
            timestamp: Date.now()
          };
          hasChanges = true;
        }
      }
      
      // Очищаем слишком старые данные (больше 4 часов)
      const now = Date.now();
      const maxAge = 4 * 60 * 60 * 1000;
      
      Object.keys(savedModes).forEach(deviceId => {
        const modeInfo = savedModes[deviceId];
        if (now - modeInfo.timestamp > maxAge) {
          // console.log(`🕒 Mode data for ${deviceId} is too old, clearing`);
          delete savedModes[deviceId];
          hasChanges = true;
        }
      });
      
      // ✅ ОБНОВЛЯЕМ ТОЛЬКО ЕСЛИ ЕСТЬ ИЗМЕНЕНИЯ
      if (hasChanges) {
        currentMode.value = savedModes;
        // console.log('✅ Modes updated with fixes:', Object.keys(currentMode.value).length);
      } else {
        // console.log('✅ Modes already valid, no changes needed');
      }
      
      await restoreModeConnections();
      
    } catch (error) {
      // console.error('❌ Failed to initialize modes:', error);
    }
  };




  
const validateAPDeviceModes = () => {
  // console.log('🔧 Validating AP device modes...');
  
  try {
    const deviceStore = useDeviceStore();
    const apDevices = deviceStore.devices.filter(dev => 
      dev.type === 'AP' && dev.hWtype === 'true'
    );
    
    let fixedCount = 0;
    
    apDevices.forEach(device => {
      const modeInfo = currentMode.value[device.id];
      
      if (!modeInfo) {
        // console.log(`🔧 New AP device ${device.id}, setting default mode: extender`);
        currentMode.value[device.id] = {
          mode: 'extender',
          routerId: null,
          timestamp: Date.now()
        };
        fixedCount++;
      } else if (modeInfo.mode === 'router' && modeInfo.routerId) {
        // ✅ ИСПРАВЛЯЕМ НЕСООТВЕТСТВИЕ
        // console.log(`🔧 Fixing AP device ${device.id}: router mode with routerId -> extender_connect`);
        currentMode.value[device.id] = {
          mode: 'extender_connect',
          routerId: modeInfo.routerId,
          timestamp: modeInfo.timestamp
        };
        fixedCount++;
      } else if (modeInfo.mode === 'extender_connect' && !modeInfo.routerId) {
        // ✅ ИСПРАВЛЯЕМ НЕСООТВЕТСТВИЕ
        // console.log(`🔧 Fixing AP device ${device.id}: extender_connect without routerId -> extender`);
        currentMode.value[device.id] = {
          mode: 'extender',
          routerId: null,
          timestamp: modeInfo.timestamp
        };
        fixedCount++;
      }
    });
    
    if (fixedCount > 0) {
      localStorage.setItem('deviceCurrentMode', JSON.stringify(currentMode.value));
      // console.log(`✅ Fixed ${fixedCount} AP device mode entries`);
    }
    
  } catch (error) {
    // console.error('❌ Error validating AP device modes:', error);
  }
};

  // Toast функции
  const toastConfig = {
    life: 4000,
    closable: true,
    group: 'tr',
    position: 'top-right'
  }

  const showSuccessWithIcon = (message, summary = 'Success') => {
    toast.add({
      ...toastConfig,
      severity: 'success',
      summary: summary,
      detail: message,
      life: 4000
    })
  }

  const showWarningToast = (message, summary = 'Warning') => {
    toast.add({
      ...toastConfig,
      severity: 'warn',
      summary: summary,
      detail: message,
      life: 4500
    })
  }

  const showErrorToast = (message, summary = 'Error') => {
    toast.add({
      ...toastConfig,
      severity: 'error',
      summary: summary,
      detail: message,
      life: 5000
    })
  }

  const showInfoToast = (message, summary = 'Info') => {
    toast.add({
      ...toastConfig,
      severity: 'info',
      summary: summary,
      detail: message,
      life: 3000
    })
  }

  const handleModeError = (error, context = 'change mode') => {
    // console.error(`❌ ${context} error:`, error)
    
    let userMessage = error.message
    let toastType = 'error'

    if (error.message.includes('Authentication')) {
      userMessage = 'Wrong password - please check credentials'
      toastType = 'warn'
    } else if (error.message.includes('timeout')) {
      userMessage = 'Device is slow to respond - try again'
      toastType = 'warn'
    } else if (error.message.includes('connect')) {
      userMessage = 'Cannot connect to device - check if device is online'
    } else if (error.message.includes('MWS')) {
      userMessage = 'MWS connection issue - ' + error.message
      toastType = 'warn'
    }

    const fullMessage = `${context.charAt(0).toUpperCase() + context.slice(1)} failed: ${userMessage}`
    
    if (toastType === 'warn') {
      showWarningToast(fullMessage, 'Warning')
    } else {
      showErrorToast(fullMessage, 'Error')
    }
    
    return userMessage
  }

  const changeMode = async (deviceId, mode, routerId = null, password = null, routerPassword = null) => {
    // console.log(`РЕЖИМ РАБОТЫ ИЗМЕНЯЕТСЯ НА ${mode}`)
    isLoading.value = true
    error.value = null
    
    try {
      return await new Promise((resolve, reject) => {
        // console.log('🔄 Changing mode:', { deviceId, mode, routerId })

        const timeout = setTimeout(() => {
          showErrorToast('Operation timeout - device is not responding', 'Timeout')
          reject(new Error('Request timeout (180s)'))
        }, 180000)

        socket.emit('device:changeMode', { 
          deviceId: String(deviceId),
          mode: String(mode),
          routerId: routerId ? String(routerId) : null,
          password: password ? String(password) : null,
          routerPassword: routerPassword ? String(routerPassword) : null
        }, (response) => {
          clearTimeout(timeout)
          
          if (response?.success) {
            let finalMode = mode
            let finalRouterId = routerId
            
            updateDeviceMode(deviceId, {
              mode: finalMode,
              routerId: finalRouterId
            })
            
            showSuccessWithIcon(`Mode changed to ${mode}`, 'Success')
            resolve(response)
          } else {
            const errorMessage = response?.error || 'Failed to change mode'
            const userMessage = handleModeError(new Error(errorMessage), 'change mode')
            reject(new Error(userMessage))
          }
        })
      })
    } catch (error) {
      const userMessage = handleModeError(error, 'change mode')
      error.value = userMessage
      throw new Error(userMessage)
    } finally {
      isLoading.value = false
    }
  }

const getCurrentMode = async (deviceId, password) => {
  isLoading.value = true
  error.value = null

  try {
      return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
              showErrorToast('Device is slow to respond', 'Detection Timeout')
              reject(new Error('Device timeout (15s)'))
          }, 15000)

          socket.emit('device:getCurrentMode', {
              deviceId: String(deviceId),
              login: 'admin',
              password: String(password)
          }, (response) => {
              clearTimeout(timeout)
              
              if (response?.success) {
                  // console.log('📡 Mode detection response:', response.mode, 'MWS:', response.hasMwsConnections)
                  
                  let finalMode = response.mode;
                  if (response.mode === 'extender' && response.hasMwsConnections) {
                      finalMode = 'extender_connect';
                      // console.log(`🔄 Upgrading mode from extender to extender_connect (has MWS connections)`);
                  }
                  
                  showSuccessWithIcon(`Current mode: ${finalMode}`, 'Mode Detected')
                  resolve(finalMode)
              } else {
                  const errorMessage = response?.error || 'Failed to get current mode'
                  const userMessage = handleModeError(new Error(errorMessage), 'get current mode')
                  reject(new Error(userMessage))
              }
          })
      })
  } catch (error) {
      const userMessage = handleModeError(error, 'get current mode')
      error.value = userMessage
      throw new Error(userMessage)
  } finally {
      isLoading.value = false
  }
}

  const getDeviceMode = (deviceId) => {
    return currentMode.value[deviceId]?.mode || null
  }

  const getDeviceModeInfo = (deviceId) => {
    return currentMode.value[deviceId] || null
  }

const listenForModeUpdates = (callback) => {
  socket.on('device:modeUpdated', (data) => {
    // console.log('📡 Mode Update received from server:', data)
    
    if (data.deviceId) {
      updateDeviceMode(data.deviceId, {
        mode: data.mode,
        routerId: data.routerId || null,
        timestamp: Date.now()
      })
    }
    
    callback?.(data)
  })
  
  return () => socket.off('device:modeUpdated')
}
  
  const listenForMwsUpdates = (callback) => {
    socket.on('device:mwsStatusUpdated', (data) => {
      // console.log('📡 MWS Status Update received:', data)
      mwsStatus.value = data
      
      if (data.status === 'connected') {
        showSuccessWithIcon('Device connected to router via MWS', 'MWS Connected')
        
        if (data.deviceId && data.routerId) {
          updateDeviceMode(data.deviceId, {
            mode: 'extender_connect',
            routerId: data.routerId
          })
        }
      } else if (data.status === 'disconnected') {
        if (data.deviceId) {
          updateDeviceMode(data.deviceId, {
            mode: 'router',
            routerId: null
          })
        }
      }
      
      callback?.(data)
    })
    
    return () => socket.off('device:mwsStatusUpdated')
  }

  const disconnectExtender = async (deviceId, routerId, password) => {
    isLoading.value = true
    error.value = null
    
    showInfoToast('Disconnecting extender from router...', 'Disconnection Started')

    try {
        return await new Promise((resolve, reject) => {
            // console.log('🔧 Отключение extender\'а:', { deviceId, routerId })

            const timeout = setTimeout(() => {
                showErrorToast('Disconnection timeout', 'Timeout')
                reject(new Error('Request timeout (120s)'))
            }, 120000)

            socket.emit('device:disconnectExtender', { 
                deviceId: String(deviceId),
                routerId: String(routerId),
                password: password ? String(password) : null
            }, (response) => {
                clearTimeout(timeout)
                // console.log('📡 Disconnect response:', response)
                
                if (response?.success) {
                    updateDeviceMode(deviceId, {
                      mode: 'Extender',
                      routerId: null
                    })
                    
                    showSuccessWithIcon('Extender disconnected and switched to router mode', 'Disconnected')
                    resolve(response)
                } else {
                    const errorMessage = response?.error || 'Failed to disconnect extender'
                    const userMessage = handleModeError(new Error(errorMessage), 'disconnect extender')
                    reject(new Error(userMessage))
                }
            })
        })
    } catch (error) {
        const userMessage = handleModeError(error, 'disconnect extender')
        error.value = userMessage
        throw new Error(userMessage)
    } finally {
        isLoading.value = false
    }
  }

  const resetMode = () => {
    currentMode.value = {}
    error.value = null
    mwsStatus.value = null
    try {
      localStorage.removeItem('deviceCurrentMode')
    } catch (error) {
      // console.warn('⚠️ Failed to clear localStorage:', error)
    }
  }

  const resetDeviceMode = (deviceId) => {
    if (currentMode.value[deviceId]) {
      delete currentMode.value[deviceId]
    }
  }

  const resetMwsStatus = () => {
    mwsStatus.value = null
  }

  const forceModeCheck = async (deviceId, password) => {
    // console.log(`🔄 Force mode check for device ${deviceId}`);
    
    const existingModeInfo = currentMode.value[deviceId];
    const existingRouterId = existingModeInfo?.routerId;
    const existingMode = existingModeInfo?.mode;
    
    try {
        const detectedMode = await getCurrentMode(deviceId, password);
        
        // ✅ УМНАЯ ЛОГИКА: СОХРАНЯЕМ РЕЖИМ ПОДКЛЮЧЕНИЯ ЕСЛИ ОН БЫЛ УСТАНОВЛЕН
        let finalMode = detectedMode;
        let finalRouterId = existingRouterId;
        
        // Если устройство было подключено (extender_connect) и сейчас в режиме экстендера
        if (existingMode === 'extender_connect' && detectedMode === 'extender') {
            // console.log(`🔄 Preserving connection mode: ${existingMode} instead of ${detectedMode}`);
            finalMode = 'extender_connect'; // Сохраняем режим подключения
            // routerId уже сохранен в finalRouterId
        }
        // Если устройство подключено и сервер подтвердил это
        else if (detectedMode === 'extender_connect') {
            finalMode = 'extender_connect';
            // routerId будет установлен сервером или сохраняем существующий
        }
        // Если устройство не подключено, очищаем routerId
        else if (detectedMode === 'router') {
            finalRouterId = null;
        }
        
        // console.log(`📊 Mode resolution:`, {
        //     deviceId,
        //     existingMode,
        //     detectedMode, 
        //     finalMode,
        //     existingRouterId,
        //     finalRouterId
        // });
        
        updateDeviceMode(deviceId, {
            mode: finalMode,
            routerId: finalRouterId,
            timestamp: Date.now()
        });
        
        // console.log(`✅ Force mode check completed: ${finalMode}, routerId: ${finalRouterId}`);
        return finalMode;
        
    } catch (error) {
        // console.log(`❌ Force mode check failed:`, error.message);
        
        // ✅ ПРИ ОШИБКЕ СОХРАНЯЕМ СУЩЕСТВУЮЩИЕ ДАННЫЕ
        if (existingModeInfo) {
            // console.log('⚠️ Keeping existing mode data due to error:', existingModeInfo);
            // Не обновляем данные, оставляем как есть
            return existingMode;
        } else {
            // Только если данных нет, устанавливаем по умолчанию
            updateDeviceMode(deviceId, {
                mode: 'router',
                routerId: null,
                timestamp: Date.now()
            });
            return 'router';
        }
    }
  };
  
  const syncDeviceModes = async () => {
    // console.log('🔄 Starting aggressive device modes synchronization...')
    
    try {
      const bookedDevices = deviceStore.bookedDevices
      
      if (!bookedDevices || bookedDevices.length === 0) {
        // console.log('📭 No booked devices to sync modes')
        return
      }
      
      // console.log(`🔍 Aggressive syncing modes for ${bookedDevices.length} booked devices`)
      
      for (const device of bookedDevices) {
        try {
          if (device.statusCode !== 200) {
            // console.log(`⏭️ Skipping offline device: ${device.hwId}`)
            continue
          }
          
          const existingMode = currentMode.value[device.id]
          const existingRouterId = existingMode?.routerId
          
          // console.log(`🔄 Force detecting mode for: ${device.hwId}`, {
            // existingMode: existingMode?.mode,
            // existingRouterId
          // })
          
          if (device.booking?.accessPassword) {
            const newMode = await getCurrentMode(device.id, device.booking.accessPassword)
            // console.log(`✅ Mode detected for ${device.hwId}: ${newMode}`, {
            //   preservedRouterId: existingRouterId
            // })
          } else {
            // console.log(`🔐 No password for: ${device.hwId}`)
          }
          
          await new Promise(resolve => setTimeout(resolve, 2000))
          
        } catch (error) {
          // console.log(`❌ Failed to sync mode for ${device.hwId}:`, error.message)
        }
      }
      
      // console.log('✅ Aggressive device modes synchronization completed')
      
    } catch (error) {
      // console.error('❌ Device modes synchronization failed:', error)
    }
  }

  const removeDeviceMode = (deviceId) => {
    if (!deviceId) return
    
    if (currentMode.value[deviceId]) {
      delete currentMode.value[deviceId]
      // console.log(`🗑️ Removed device ${deviceId} from mode store`)
    }
    
    try {
      const saved = localStorage.getItem('deviceCurrentMode')
      if (saved) {
        const savedModes = JSON.parse(saved)
        if (savedModes[deviceId]) {
          delete savedModes[deviceId]
          localStorage.setItem('deviceCurrentMode', JSON.stringify(savedModes))
          // console.log(`🗑️ Removed device ${deviceId} from localStorage`)
        }
      }
    } catch (error) {
      // console.warn('⚠️ Failed to remove device from localStorage:', error)
    }
  }

  const preserveModeConnections = () => {
    // console.log('💾 Preserving mode connections...')
    
    try {
      const modesToPreserve = { ...currentMode.value }
      localStorage.setItem('deviceCurrentMode', JSON.stringify(modesToPreserve))
      // console.log('✅ Mode connections preserved to localStorage')
    } catch (error) {
      // console.error('❌ Failed to preserve mode connections:', error)
    }
  }

  const preserveCurrentMode = (deviceId) => {
    if (!deviceId || !currentMode.value[deviceId]) return
    
    const currentModeData = currentMode.value[deviceId]
    // console.log(`💾 Preserving mode for ${deviceId}:`, currentModeData)
    
    try {
      const savedModes = getInitialMode()
      savedModes[deviceId] = currentModeData
      localStorage.setItem('deviceCurrentMode', JSON.stringify(savedModes))
      // console.log(`✅ Mode preserved for ${deviceId}`)
    } catch (error) {
      // console.error(`❌ Failed to preserve mode for ${deviceId}:`, error)
    }
  }

const validateAndFixModes = () => {
  // console.log('🔧 Validating and fixing mode data...');
  
  try {
      const savedModes = getInitialMode();
      let fixedCount = 0;
      
      Object.entries(savedModes).forEach(([deviceId, modeInfo]) => {
          if (!modeInfo || typeof modeInfo !== 'object') {
              delete savedModes[deviceId];
              fixedCount++;
              return;
          }
          
          if (modeInfo.mode === 'extender_connect' && !modeInfo.routerId) {
              // Если режим extender_connect, но нет routerId - исправляем на extender
              modeInfo.mode = 'extender';
              fixedCount++;
              // console.log(`🔧 Fixed mode for ${deviceId}: extender_connect -> extender (no routerId)`);
          } else if (modeInfo.mode === 'extender' && modeInfo.routerId) {
              // Если режим extender, но есть routerId - исправляем на extender_connect
              modeInfo.mode = 'extender_connect';
              fixedCount++;
              // console.log(`🔧 Fixed mode for ${deviceId}: extender -> extender_connect (has routerId)`);
          } else if (modeInfo.mode === 'extender_disconnect') {
            // ✅ ПРАВИЛЬНО: оставляем как есть или меняем на AP
            modeInfo.mode = 'AP';  // или оставить 'extender_disconnect'
            modeInfo.routerId = null;
            fixedCount++;
            // console.log(`🔧 Fixed mode for ${deviceId}: extender_disconnect -> AP`);
          } else if (modeInfo.mode === 'router' && modeInfo.routerId) {
              // Если режим router, но есть routerId - очищаем routerId
              modeInfo.routerId = null;
              fixedCount++;
              // console.log(`🔧 Fixed mode for ${deviceId}: cleared routerId for router mode`);
          }
          
          // Удаляем устаревшие данные (старше 4 часов)
          if (Date.now() - modeInfo.timestamp > 14400000) {
              delete savedModes[deviceId];
              fixedCount++;
              // console.log(`🔧 Removed stale mode data for ${deviceId}`);
          }
      });
      
      if (fixedCount > 0) {
          currentMode.value = savedModes;
          localStorage.setItem('deviceCurrentMode', JSON.stringify(savedModes));
          // console.log(`✅ Fixed ${fixedCount} mode entries`);
      }
      
      // console.log(`📊 Mode validation completed: ${Object.keys(savedModes).length} valid entries`);
      
  } catch (error) {
      // console.error('❌ Error validating modes:', error);
  }
};




const checkDeviceStatusImmediately = async (deviceId, maxAttempts = 10, interval = 3000) => {
  // console.log(`🔍 Starting immediate status check for ${deviceId}`);
  
  return new Promise((resolve) => {
    socket.emit('device:forceStatusCheck', deviceId, (response) => {
      if (response?.success) {
        // console.log(`✅ Immediate status check completed: ${response.status}`);
        resolve(response.status);
      } else {
        // console.log(`⚠️ Immediate status check failed: ${response?.error}`);
        resolve(0); // Возвращаем 0 при ошибке
      }
    });
    
    // Таймаут на случай если сервер не ответит
    setTimeout(() => {
      // console.log(`⚠️ Immediate status check timeout for ${deviceId}`);
      resolve(0);
    }, 10000);
  });
};



  return {
    isLoading,
    currentMode,
    error,
    mwsStatus,
    changeMode,
    getCurrentMode,
    getDeviceMode,
    getDeviceModeInfo,
    listenForModeUpdates,
    listenForMwsUpdates,
    resetMode,
    resetDeviceMode,
    resetMwsStatus,
    disconnectExtender,
    initializeModes,
    updateDeviceMode,
    validateModeData,
    syncDeviceModes,
    removeDeviceMode,
    forceModeCheck,
    restoreModeConnections,
    preserveModeConnections,
    preserveCurrentMode,
    preloadDeviceMode,
    validateAndFixModes,
    updateModeFromDetection,
    validateAPDeviceModes,
    checkDeviceStatusImmediately
  }
})