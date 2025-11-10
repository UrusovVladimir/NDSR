// stores/useConsoleStore.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useToast } from 'primevue/usetoast'
import { socket } from '@/socket'
import { useDeviceStore } from './useDeviceStore'

export const useConsoleStore = defineStore('console', () => {
  const toast = useToast()
  
  // ✅ ИСПОЛЬЗУЕМ ОБЫЧНЫЕ Map ДЛЯ ИЗОЛЯЦИИ ОТ VUE РЕАКТИВНОСТИ
  let consoleTimers = new Map()
  let consoleWindows = new Map()
  let consoleCooldowns = new Map()
  
  // ✅ РЕАКТИВНЫЕ ДАННЫЕ ТОЛЬКО ДЛЯ СТАТУСОВ (без ссылок на окна)
  const cooldownEndTimes = ref(new Map())
  const consoleOpenStates = ref(new Map())

  // ✅ БЕЗОПАСНЫЕ ГЕТТЕРЫ
  const getRemainingCooldown = computed(() => (deviceId) => {
    const cooldownEnd = cooldownEndTimes.value.get(deviceId)
    if (!cooldownEnd) return 0

    const remainingTime = cooldownEnd - Date.now()
    return Math.max(0, Math.ceil(remainingTime / 1000))
  })

  const isConsoleOnCooldown = computed(() => (deviceId) => {
    return getRemainingCooldown.value(deviceId) > 0
  })

  // ✅ БЕЗОПАСНАЯ ПРОВЕРКА ОТКРЫТИЯ КОНСОЛИ
  const isConsoleOpen = (deviceId) => {
    return consoleOpenStates.value.get(deviceId) === true
  }

  const handleOpenConsole = async (device) => {
    try {
      // ✅ ПРОВЕРЯЕМ БЛОКИРОВКУ
      if (isConsoleOnCooldown.value(device.id)) {
        const remainingTime = getRemainingCooldown.value(device.id)
        toast.add({ 
          severity: 'warn', 
          summary: 'Console Cooldown', 
          detail: `Please wait ${remainingTime}s before opening console again`, 
          life: 3000 
        })
        return
      }

      const deviceStore = useDeviceStore()
      if (!device.booking?.isBooked || device.booking?.bookedBy !== deviceStore.currentUserId) {
        toast.add({ 
          severity: 'error', 
          summary: 'Access Denied', 
          detail: 'You can only open console for your booked devices', 
          life: 4000 
        })
        return
      }

      // ✅ БЕЗОПАСНАЯ ПРОВЕРКА ОТКРЫТОЙ КОНСОЛИ
      if (isConsoleOpen(device.id)) {
        focusConsole(device.id)
        return
      }

      const response = await new Promise((resolve, reject) => {
        socket.emit('device:getConsoleUrl', device.id, (response) => {
          if (response?.success) {
            resolve(response)
          } else {
            reject(new Error(response?.error || 'Failed to get console URL'))
          }
        })
        
        setTimeout(() => reject(new Error('Request timeout')), 5000)
      })

      const params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`
      const openWindow = window.open(response.url, `console_${device.id}`, params)
      
      if (!openWindow) {
        throw new Error('Popup blocked. Please allow popups for this site.')
      }

      // ✅ СОХРАНЯЕМ В ОБЫЧНЫЕ Map (НЕ РЕАКТИВНЫЕ)
      consoleWindows.set(device.id, openWindow)
      consoleOpenStates.value.set(device.id, true)
      
      // Сохраняем в localStorage
      localStorage.setItem(`consoleOpen_${device.id}`, 'true')

      // ✅ ЗАПУСКАЕМ БЛОКИРОВКУ НА 1 МИНУТУ
      startConsoleCooldown(device.id)

      toast.add({
        severity: 'success',
        summary: 'Console Opened',
        detail: `Console for ${device.hwId} opened in new window`,
        life: 3000
      })

      // ✅ БЕЗОПАСНЫЙ ТАЙМЕР ДЛЯ ОТСЛЕЖИВАНИЯ ОКНА
      startConsoleTimer(device.id, openWindow)

    } catch (error) {
      console.error('Failed to open console:', error)
      toast.add({
        severity: 'error',
        summary: 'Console Error',
        detail: `Cannot open console: ${error.message}`,
        life: 4000
      })
    }
  }

  // ✅ БЕЗОПАСНЫЙ ТАЙМЕР ОТСЛЕЖИВАНИЯ ОКНА
  const startConsoleTimer = (deviceId, openWindow) => {
    if (consoleTimers.has(deviceId)) {
      clearInterval(consoleTimers.get(deviceId))
    }

    const timer = setInterval(() => {
      try {
        // ✅ ПРОСТАЯ ПРОВЕРКА БЕЗ ДОСТУПА К СВОЙСТВАМ ОКНА
        if (!openWindow || openWindow.closed) {
          safeCloseConsole(deviceId)
          clearInterval(timer)
        }
      } catch (error) {
        // Если возникает ошибка CORS, считаем окно закрытым
        console.warn(`Console window check failed for device ${deviceId}, assuming closed`)
        safeCloseConsole(deviceId)
        clearInterval(timer)
      }
    }, 1000)

    consoleTimers.set(deviceId, timer)
  }

  // ✅ УПРОЩЕННОЕ БЕЗОПАСНОЕ ЗАКРЫТИЕ КОНСОЛИ
  const safeCloseConsole = (deviceId) => {
    try {
      const windowRef = consoleWindows.get(deviceId)
      if (windowRef) {
        // ✅ ПРОСТО ЗАКРЫВАЕМ ОКНО БЕЗ ЛЮБЫХ ОПЕРАЦИЙ С НИМ
        windowRef.close()
      }
    } catch (error) {
      // Игнорируем все ошибки при закрытии
      console.log(`Console window for device ${deviceId} closed with possible CORS restrictions`)
    } finally {
      // ✅ ВСЕГДА ОЧИЩАЕМ СОСТОЯНИЕ
      consoleWindows.delete(deviceId)
      consoleOpenStates.value.set(deviceId, false)
      
      if (consoleTimers.has(deviceId)) {
        clearInterval(consoleTimers.get(deviceId))
        consoleTimers.delete(deviceId)
      }
      
      localStorage.setItem(`consoleOpen_${deviceId}`, 'false')
    }
  }

  // ✅ УПРОЩЕННЫЙ ФОКУС НА КОНСОЛИ
  const focusConsole = (deviceId) => {
    if (isConsoleOpen(deviceId)) {
      try {
        const windowRef = consoleWindows.get(deviceId)
        if (windowRef) {
          windowRef.focus()
          toast.add({
            severity: 'info',
            summary: 'Console Focused',
            detail: 'Console window brought to front',
            life: 2000
          })
        }
      } catch (error) {
        console.log(`Cannot focus console for device ${deviceId} (CORS restricted)`)
        // Если не удалось сфокусироваться, считаем окно недоступным
        safeCloseConsole(deviceId)
      }
    }
  }

  // ✅ ФУНКЦИЯ ДЛЯ ПРИНУДИТЕЛЬНОГО ЗАКРЫТИЯ КОНСОЛИ
  const closeConsole = (deviceId) => {
    safeCloseConsole(deviceId)
    toast.add({
      severity: 'success',
      summary: 'Console Closed',
      detail: 'Console window has been closed',
      life: 3000
    })
  }

  // ✅ ФУНКЦИЯ БЛОКИРОВКИ
  const startConsoleCooldown = (deviceId) => {
    if (consoleCooldowns.has(deviceId)) {
      clearTimeout(consoleCooldowns.get(deviceId))
    }

    const cooldownTime = 60 * 1000
    const cooldownEnd = Date.now() + cooldownTime
    
    cooldownEndTimes.value.set(deviceId, cooldownEnd)
    sessionStorage.setItem(`consoleCooldown_${deviceId}`, cooldownEnd.toString())

    const timer = setTimeout(() => {
      consoleCooldowns.delete(deviceId)
      cooldownEndTimes.value.delete(deviceId)
      sessionStorage.removeItem(`consoleCooldown_${deviceId}`)
    }, cooldownTime)

    consoleCooldowns.set(deviceId, timer)
  }

  // ✅ ВОССТАНОВЛЕНИЕ БЛОКИРОВОК
  const restoreCooldowns = () => {
    const deviceStore = useDeviceStore()
    deviceStore.bookedDevices.forEach(device => {
      const cooldownEnd = sessionStorage.getItem(`consoleCooldown_${device.id}`)
      if (cooldownEnd) {
        const remainingTime = parseInt(cooldownEnd) - Date.now()
        if (remainingTime > 0) {
          cooldownEndTimes.value.set(device.id, parseInt(cooldownEnd))
          
          const timer = setTimeout(() => {
            consoleCooldowns.delete(device.id)
            cooldownEndTimes.value.delete(device.id)
            sessionStorage.removeItem(`consoleCooldown_${device.id}`)
          }, remainingTime)

          consoleCooldowns.set(device.id, timer)
        } else {
          sessionStorage.removeItem(`consoleCooldown_${device.id}`)
        }
      }
    })
  }

  // ✅ ВОССТАНОВЛЕНИЕ СОСТОЯНИЯ КОНСОЛЕЙ
  const restoreConsoleState = () => {
    const deviceStore = useDeviceStore()
    deviceStore.bookedDevices.forEach(device => {
      const isOpen = localStorage.getItem(`consoleOpen_${device.id}`) === 'true'
      consoleOpenStates.value.set(device.id, isOpen)
      
      // ✅ ЕСЛИ КОНСОЛЬ БЫЛА ОТКРЫТА, НО ОКНО УТЕРЯНО - СЧИТАЕМ ЗАКРЫТОЙ
      if (isOpen && !consoleWindows.has(device.id)) {
        consoleOpenStates.value.set(device.id, false)
        localStorage.setItem(`consoleOpen_${device.id}`, 'false')
      }
    })
    
    restoreCooldowns()
  }

  // ✅ ОЧИСТКА
  const cleanup = () => {
    // Очищаем таймеры
    consoleTimers.forEach((timer, deviceId) => {
      clearInterval(timer)
    })
    consoleTimers.clear()
    
    // Очищаем блокировки
    consoleCooldowns.forEach((timer, deviceId) => {
      clearTimeout(timer)
    })
    consoleCooldowns.clear()
    
    // Закрываем все окна
    consoleWindows.forEach((windowRef, deviceId) => {
      try {
        windowRef.close()
      } catch (error) {
        // Игнорируем ошибки при закрытии
      }
    })
    consoleWindows.clear()
    
    // Очищаем состояния
    consoleOpenStates.value.clear()
  }

  return {
    // State (только реактивные данные)
    cooldownEndTimes,
    consoleOpenStates,
    
    // Getters
    isConsoleOpen,
    isConsoleOnCooldown,
    getRemainingCooldown,
    
    // Actions
    handleOpenConsole,
    closeConsole,
    focusConsole,
    restoreConsoleState,
    cleanup
  }
})