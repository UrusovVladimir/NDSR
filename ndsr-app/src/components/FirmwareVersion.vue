<template>
  <div class="firmware-version" :class="{ 'mobile-layout': isMobileLayout }">
    <div class="version-display">
      <Chip 
        v-if="displayVersion && !isError"
        :label="`v${displayVersion}`"
        icon="pi pi-code"
        class="firmware-chip"
        :severity="versionSeverity"
      />
      <Tag 
        v-else-if="isLoading"
        value="Loading..."
        severity="info"
        class="status-tag"
      />
      <Tag 
        v-else-if="device.statusCode !== 200"
        value="Offline"
        severity="secondary"
        class="status-tag"
      />
      <Tag 
        v-else-if="isError"
        :value="errorDisplayText"
        severity="danger"
        class="status-tag"
        v-tooltip="lastError"
      />
      <Tag 
        v-else
        value="Unknown"
        severity="warning"
        class="status-tag"
      />
      
      <i 
        v-if="device.statusCode === 200"
        class="pi pi-refresh details-inline refresh-small"
        @click="refreshFirmware"
        v-tooltip.bottom="getRefreshTooltip"
      />
    </div>

    <!-- Диалог подтверждения -->
    <Dialog 
      v-model:visible="showConfirmDialog" 
      modal 
      header="Check Firmware Version"
      :style="{ width: '450px' }"
    >
      <div class="confirmation-content">
        <i class="pi pi-info-circle mr-3" style="font-size: 2rem; color: #3b82f6;" />
        <div>
          <p>Check firmware version for <strong>{{ device.hwId }}</strong>?</p>
          <p class="text-color-secondary text-sm mt-2">
            This will authenticate with the device using the current password and retrieve the firmware version.
          </p>
        </div>
      </div>
      <template #footer>
        <Button 
          label="Cancel" 
          icon="pi pi-times" 
          class="p-button-text" 
          @click="showConfirmDialog = false"
        />
        <Button 
          label="Check Firmware" 
          icon="pi pi-check" 
          class="p-button-primary" 
          @click="confirmCheckFirmware"
          :loading="isLoading"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Chip from 'primevue/chip'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { useFirmwareStore } from '@/stores/useFirmwareStore'

const toast = useToast()
const firmwareStore = useFirmwareStore()

const props = defineProps({
  device: Object,
  currentUserId: [String, Number],
  todayPassword: String,
  autoCheckEnabled: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['firmwareUpdated'])

// State
const firmwareVersion = ref('')
const isLoading = ref(false)
const lastError = ref(null)
const hasLoaded = ref(false)
const initialLoadDone = ref(false)
const showConfirmDialog = ref(false)
const isMobileLayout = ref(false)

// Debounce таймеры
let loadFirmwareTimeout = null
let statusChangeTimeout = null

// Computed properties
const canCheckFirmware = computed(() => {
  return props.device.statusCode === 200
})

const displayVersion = computed(() => {
  return firmwareVersion.value
})

const isError = computed(() => {
  return lastError.value !== null
})

const errorDisplayText = computed(() => {
  if (!lastError.value) return ''
  
  const errorLower = lastError.value.toLowerCase()
  if (errorLower.includes('authentication failed') || 
      errorLower.includes('incorrect password') ||
      errorLower.includes('ошибка авторизации')) {
    return 'Wrong Password'
  } else if (errorLower.includes('timeout')) {
    return 'Timeout'
  } else if (errorLower.includes('cannot connect') || errorLower.includes('unreachable')) {
    return 'Unreachable'
  } else if (errorLower.includes('invalid response')) {
    return 'Invalid Response'
  } else if (errorLower.includes('device is offline')) {
    return 'Offline'
  } else if (errorLower.includes('no password available')) {
    return 'No Password'
  }
  return 'Error'
})

const versionSeverity = computed(() => {
  if (!displayVersion.value) return 'secondary'
  if (displayVersion.value.includes('Unknown')) return 'warning'
  return 'success'
})

const getRefreshTooltip = computed(() => {
  if (isLoading.value) return 'Checking firmware version...'
  if (firmwareVersion.value) return 'Refresh firmware version'
  return 'Check firmware version'
})

const getDevicePassword = () => {
  // 1. Сначала сохраненный пароль из конфига
  if (props.device.devicePassword) {
    return props.device.devicePassword
  }
  // 2. Пароль из бронирования
  if (props.device.booking?.isBooked && 
      props.device.booking?.bookedBy === props.currentUserId &&
      props.device.booking?.accessPassword) {
    return props.device.booking.accessPassword
  }
  // 3. Daily password
  return props.todayPassword
}

const checkMobileLayout = () => {
  const column = document.querySelector('.firmware-column')
  if (column) {
    const width = column.offsetWidth
    isMobileLayout.value = width < 160
  }
}

const loadFirmwareVersion = async (forceRefresh = false, isManualRefresh = false) => {
  if (!canCheckFirmware.value) {
    if (props.device.statusCode !== 200) {
      firmwareVersion.value = ''
      lastError.value = null
    }
    return
  }

  if (isLoading.value && !forceRefresh) return

  if (loadFirmwareTimeout) {
    clearTimeout(loadFirmwareTimeout)
    loadFirmwareTimeout = null
  }

  isLoading.value = true
  lastError.value = null

  try {
    const password = getDevicePassword()
    
    if (!password) {
      throw new Error('No password available')
    }

    const version = await firmwareStore.getFirmwareVersion(props.device, password, forceRefresh)
    
    if (version) {
      firmwareVersion.value = version
      props.device.firmwareVersion = version
      emit('firmwareUpdated', { deviceId: props.device.id, version })
      
      // ✅ ТОСТ ТОЛЬКО ПРИ РУЧНОМ ОБНОВЛЕНИИ
      if (isManualRefresh) {
        toast.add({
          severity: 'success',
          summary: 'Firmware Updated',
          detail: `Version ${version} for ${props.device.hwId}`,
          life: 3000
        })
      }
    }
  } catch (error) {
    lastError.value = error.message
    
    // ✅ ТОСТ ТОЛЬКО ПРИ РУЧНОМ ОБНОВЛЕНИИ
    if (isManualRefresh) {
      let toastMessage = `Cannot get firmware version for ${props.device.hwId}`
      let toastSeverity = 'error'
      
      const errorLower = error.message.toLowerCase()
      if (errorLower.includes('authentication failed') || 
          errorLower.includes('incorrect password')) {
        toastMessage = `Wrong password for ${props.device.hwId}`
        toastSeverity = 'warn'
      } else if (errorLower.includes('offline')) {
        toastMessage = `Device ${props.device.hwId} is offline`
        toastSeverity = 'info'
      }
      
      toast.add({
        severity: toastSeverity,
        summary: 'Firmware Check Failed',
        detail: toastMessage,
        life: 4000
      })
    }
  } finally {
    isLoading.value = false
    hasLoaded.value = true
  }
}

const refreshFirmware = () => {
  showConfirmDialog.value = true
}

const confirmCheckFirmware = async () => {
  showConfirmDialog.value = false
  await loadFirmwareVersion(true, true)
}

const resetFirmwareState = async () => {
  firmwareVersion.value = ''
  lastError.value = null
  hasLoaded.value = false
  await firmwareStore.clearFirmwareCache(props.device.id)
}

// Обработчики событий от store (без тостов)
const handleAutoCheckEvent = (event) => {
  if (event.detail.deviceId === props.device.id) {
    if (loadFirmwareTimeout) clearTimeout(loadFirmwareTimeout)
    
    loadFirmwareTimeout = setTimeout(() => {
      if (props.device.statusCode === 200) {
        loadFirmwareVersion(true, false) // isManualRefresh = false
      }
    }, 5000)
  }
}

const handleBookingUpdateEvent = (event) => {
  if (event.detail.deviceId === props.device.id) {
    if (!event.detail.booking.isBooked) {
      resetFirmwareState()
    } else if (event.detail.booking.isBooked && event.detail.booking.bookedBy === props.currentUserId) {
      if (loadFirmwareTimeout) clearTimeout(loadFirmwareTimeout)
      
      loadFirmwareTimeout = setTimeout(() => {
        loadFirmwareVersion(true, false) // isManualRefresh = false
      }, 2000)
    }
  }
}

const handleDeviceActionEvent = (event) => {
  if (event.detail.deviceId === props.device.id) {
    if (loadFirmwareTimeout) clearTimeout(loadFirmwareTimeout)
    
    loadFirmwareTimeout = setTimeout(() => {
      if (props.device.statusCode === 200) {
        loadFirmwareVersion(true, false) // isManualRefresh = false
      }
    }, 10000)
  }
}

// Автоматическая загрузка при монтировании
onMounted(() => {
  window.addEventListener('firmware:autoCheck', handleAutoCheckEvent)
  window.addEventListener('firmware:bookingUpdated', handleBookingUpdateEvent)
  window.addEventListener('firmware:deviceAction', handleDeviceActionEvent)

  checkMobileLayout()
  window.addEventListener('resize', checkMobileLayout)

  // Проверяем кэш стора при монтировании
  const cached = firmwareStore.firmwareCache.get(props.device.id)
  if (cached && !cached.error && cached.version) {
    firmwareVersion.value = cached.version
    lastError.value = null
    hasLoaded.value = true
    initialLoadDone.value = true
  } else if (props.device.firmwareVersion && props.device.firmwareVersion !== 'Unknown version') {
    firmwareVersion.value = props.device.firmwareVersion
    lastError.value = null
    hasLoaded.value = true
    initialLoadDone.value = true
  }

  // Первоначальная загрузка (без тоста)
  if (canCheckFirmware.value && !initialLoadDone.value) {
    loadFirmwareTimeout = setTimeout(() => {
      loadFirmwareVersion(false, false) // isManualRefresh = false
      initialLoadDone.value = true
    }, 1000)
  }
})

// Watch для статуса устройства (без тоста)
watch(() => props.device.statusCode, (newStatus, oldStatus) => {
  if (statusChangeTimeout) {
    clearTimeout(statusChangeTimeout)
  }
  
  if (newStatus === 200 && oldStatus !== 200) {
    statusChangeTimeout = setTimeout(() => {
      if (props.device.statusCode === 200) {
        loadFirmwareVersion(true, false) // isManualRefresh = false
      }
    }, 8000)
  } 
  else if (newStatus !== 200 && oldStatus === 200) {
    firmwareVersion.value = ''
    lastError.value = null
  }
})

// Следим за изменением пароля (без тоста)
watch(() => props.todayPassword, () => {
  if (canCheckFirmware.value && hasLoaded.value) {
    if (loadFirmwareTimeout) clearTimeout(loadFirmwareTimeout)
    
    loadFirmwareTimeout = setTimeout(() => {
      loadFirmwareVersion(true, false) // isManualRefresh = false
    }, 1000)
  }
})

onUnmounted(() => {
  if (loadFirmwareTimeout) clearTimeout(loadFirmwareTimeout)
  if (statusChangeTimeout) clearTimeout(statusChangeTimeout)
  
  window.removeEventListener('firmware:autoCheck', handleAutoCheckEvent)
  window.removeEventListener('firmware:bookingUpdated', handleBookingUpdateEvent)
  window.removeEventListener('firmware:deviceAction', handleDeviceActionEvent)
  window.removeEventListener('resize', checkMobileLayout)
})
</script>

<style scoped>
.firmware-version {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.version-display {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.firmware-chip {
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', monospace;
}

.status-tag {
  font-size: 0.75rem;
}

.refresh-small {
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--primary-color);
  transition: all 0.2s ease;
  opacity: 0.7;
}

.refresh-small:hover {
  opacity: 1;
  transform: rotate(180deg);
}

@media (max-width: 768px) {
  .firmware-version.mobile-layout {
    flex-direction: column;
    gap: 0.25rem;
  }
  
  .refresh-small {
    font-size: 0.7rem;
  }
}
</style>