<template>
  <Dialog
    v-model:visible="visible"
    :modal="true"
    header="Device to update"
    :style="{ width: '500px', maxWidth: '95vw' }"
    :breakpoints="{ '960px': '85vw', '641px': '95vw' }"
    :contentStyle="{ padding: '1.5rem' }"
    :closable="!applying"
    :closeOnEscape="!applying"
  >
    <div class="device-selector-content">
      <div class="selected-file-info" v-if="selectedFile">
        <div class="info-row">
          <i class="pi pi-file"></i>
          <span class="info-label">File:</span>
          <strong>{{ selectedFile }}</strong>
        </div>
        <div class="info-row">
          <i class="pi pi-database"></i>
          <span class="info-label">Size:</span>
          <span>{{ fileSize }}</span>
        </div>
        <!-- Показываем IP выбранного устройства -->
        <div class="info-row">
          <i class="pi pi-globe"></i>
          <span class="info-label">TFTP server IP of device:</span>
          <span v-if="selectedDevice">{{ selectedDevice.ip?.split('/')[0] || selectedDevice.managementIp || 'N/A' }}</span>
          <span v-else class="text-color-secondary">Not selected</span>
        </div>
      </div>

      <div class="device-section">
        <div class="section-title">
          <i class="pi pi-desktop"></i>
          <span>Select Target Device</span>
        </div>

        <div v-if="loading" class="loading-state">
          <i class="pi pi-spin pi-spinner"></i>
          <span>Loading devices...</span>
        </div>

        <div v-else-if="availableDevices.length === 0" class="empty-state">
          <i class="pi pi-inbox"></i>
          <p>No available devices</p>
          <small class="text-color-secondary">
            Book a device first to apply firmware
          </small>
        </div>

        <div v-else class="devices-list">
          <div
            v-for="device in availableDevices"
            :key="device.id"
            class="device-item"
            :class="{ 'device-selected': selectedDeviceId === device.id }"
            @click="selectDevice(device.id)"
          >
            <div class="device-status">
              <i 
                class="pi" 
                :class="device.statusCode === 200 ? 'pi-circle-fill online' : 'pi-circle-off offline'"
              ></i>
            </div>
            <div class="device-info">
              <div class="device-name">{{ device.shortName || device.hwId }}</div>
              <div class="device-details">
                <span class="device-ip">
                  <i class="pi pi-globe"></i>
                  {{ device.ip?.split('/')[0] || device.managementIp || 'N/A' }}
                </span>
                <span class="device-type">{{ device.type === 'AP' ? 'Access Point' : 'Router' }}</span>
              </div>
            </div>
            <div class="device-select-radio">
              <RadioButton 
                v-model="selectedDeviceId" 
                :value="device.id" 
                :disabled="applying"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Информация о TFTP -->
      <Message severity="info" class="tftp-info">
        <div class="message-content">
          <div>
            <strong>TFTP Server Information</strong>
            <div>IP: {{ tftpServerIP }}</div>
            <small>Use this ip address to connect DUT to tftp server</small>
          </div>
        </div>
      </Message>

      <!-- Прогресс применения -->
      <!-- <div v-if="applying" class="apply-progress">
        <div class="progress-info">
          <i class="pi pi-spin pi-spinner"></i>
          <span>Sending command to device...</span>
          <span>{{ applyProgress }}%</span>
        </div>
        <ProgressBar :value="applyProgress" :showValue="false" />
        <div class="progress-details" v-if="applyDetails">
          <small>{{ applyDetails }}</small>
        </div>
      </div> -->

      <Message 
        v-if="error" 
        severity="error" 
        :closable="true"
        @close="error = null"
        class="mt-2"
      >
        <i class="pi pi-exclamation-circle"></i>
        {{ error }}
      </Message>
    </div>

    <template #footer>
      <div class="modal-footer">
        <Button
          label="Cancel"
          icon="pi pi-times"
          @click="closeModal"
          :disabled="applying"
          class="p-button-text"
        />
        <Button
          label="Apply to Device"
          icon="pi pi-upload"
          @click="applyToDevice"
          :loading="applying"
          :disabled="!selectedDeviceId || applying"
          class="p-button-success"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import RadioButton from 'primevue/radiobutton'
import ProgressBar from 'primevue/progressbar'
import Message from 'primevue/message'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useConsoleStore } from '@/stores/useConsoleStore'
import { useDeviceActionsStore} from '@/stores/useDeviceActionsStore'

const toast = useToast()
const deviceStore = useDeviceStore()
const consoleStore = useConsoleStore()
const deviceActionsStore = useDeviceActionsStore()
// ✅ Добавляем emit
const emit = defineEmits(['close-files'])

// Props
const props = defineProps({
  fileName: String,
  fileSize: String
})

// Состояния
const visible = ref(false)
const loading = ref(false)
const applying = ref(false)
const applyProgress = ref(0)
const applyDetails = ref('')
const selectedDeviceId = ref(null)
const error = ref(null)

// Computed для IP TFTP сервера
const tftpServerIP = computed(() => {
  if (selectedDevice.value) {
    const ip = selectedDevice.value.ip?.split('/')[0] || selectedDevice.value.managementIp
    return ip || 'Not selected'
  }
  return 'Not selected'
})

// Computed для получения выбранного устройства
const selectedDevice = computed(() => {
  if (!selectedDeviceId.value) return null
  return availableDevices.value.find(d => d.id === selectedDeviceId.value)
})

// Computed для доступных устройств
const availableDevices = computed(() => {
  if (!deviceStore.devices || !deviceStore.currentUserId) return []
  
  return deviceStore.devices.filter(device => 
    device.booking?.isBooked && 
    device.booking?.bookedBy === deviceStore.currentUserId &&
    device.statusCode === 200
  )
})

const selectedFile = computed(() => props.fileName)

// Методы
const show = () => {
  console.log('🎯 DeviceSelector show() called')
  visible.value = true
  selectedDeviceId.value = null
  error.value = null
  applyProgress.value = 0
  applyDetails.value = ''
  
  if (availableDevices.value.length === 0) {
    toast.add({
      severity: 'warn',
      summary: 'No Devices',
      detail: 'Please book a device first to apply firmware',
      life: 5000
    })
  }
}

const closeModal = () => {
  if (!applying.value) {
    visible.value = false
    selectedDeviceId.value = null
    error.value = null
    applyProgress.value = 0
    applyDetails.value = ''
  }
}

const selectDevice = (deviceId) => {
  if (!applying.value) {
    selectedDeviceId.value = deviceId
  }
}
const applyToDevice = async () => {
  if (!selectedDeviceId.value) {
    error.value = 'Please select a device'
    return
  }

  const device = selectedDevice.value
  if (!device) {
    error.value = 'Device not found'
    return
  }

  applying.value = true

  try {
    // Проверяем статус питания
    const powerStatus = deviceActionsStore.getPowerStatus(device.id)
    console.log(`[DeviceSelector] Power status for ${device.hwId}: ${powerStatus}`)
    
    // Управление питанием (без прогресса)
    if (powerStatus === 'on') {
      // Используем тихий ребут без прогресса
      deviceActionsStore.silentRebootDevice(device).catch(err => {
        console.error('Reboot error:', err)
      })
      toast.add({
        severity: 'info',
        summary: 'Reboot Command Sent',
        detail: `Device ${device.shortName} is rebooting`,
        life: 3000
      })
    } else if (powerStatus === 'off') {
      // Используем тихое включение без прогресса
      deviceActionsStore.silentPowerDevice(device, 'on').catch(err => {
        console.error('Power on error:', err)
      })
      toast.add({
        severity: 'info',
        summary: 'Power On Command Sent',
        detail: `Device ${device.shortName} is powering on`,
        life: 3000
      })
    }
    
    // Закрываем DeviceSelector
    closeModal()
    
    // Открываем консоль
    if (consoleStore.isConsoleOpen(device.id)) {
      consoleStore.focusConsole(device.id)
    } else {
      await consoleStore.handleOpenConsole(device)
    }
    
    // Эмитим событие для закрытия FileManager
    emit('close-files')
    
    applying.value = false

  } catch (err) {
    console.error('❌ Failed:', err)
    toast.add({
      severity: 'error',
      summary: 'Failed',
      detail: err.message,
      life: 5000
    })
    applying.value = false
  }
}
defineExpose({ show })
</script>
<style scoped>
.device-selector-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.selected-file-info {
  background: var(--surface-ground);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--surface-border);
}

.info-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-row i {
  color: var(--primary-color);
  width: 1.25rem;
}

.info-label {
  font-weight: 600;
  color: var(--text-color-secondary);
  min-width: 100px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--text-color);
  font-size: 1rem;
}

.section-title i {
  color: var(--primary-color);
}

.devices-list {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.device-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.device-item:hover {
  background: var(--surface-hover);
  border-color: var(--primary-color);
}

.device-selected {
  background: var(--primary-color-light);
  border-color: var(--primary-color);
}

.device-status {
  flex-shrink: 0;
}

.device-status i {
  font-size: 0.75rem;
}

.online {
  color: var(--green-500);
}

.offline {
  color: var(--red-500);
}

.device-info {
  flex: 1;
  min-width: 0;
}

.device-name {
  font-weight: 600;
  margin-bottom: 0.25rem;
  color: var(--text-color);
}

.device-details {
  display: flex;
  gap: 1rem;
  font-size: 0.8rem;
  color: var(--text-color-secondary);
}

.device-details i {
  margin-right: 0.25rem;
  font-size: 0.7rem;
}

.device-ip,
.device-type {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.device-select-radio {
  flex-shrink: 0;
}

.tftp-info {
  margin: 0;
}

.tftp-info :deep(.p-message-content) {
  padding: 0.75rem;
}

.message-content {
  display: flex;
  gap: 0.75rem;
}

.message-content i {
  margin-top: 0.125rem;
}

.message-content code {
  background: var(--surface-ground);
  padding: 0.125rem 0.25rem;
  border-radius: 4px;
  font-family: monospace;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--text-color-secondary);
}

.loading-state i,
.empty-state i {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  display: block;
}

.apply-progress {
  padding: 1rem;
  background: var(--surface-ground);
  border-radius: 8px;
}

.progress-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
  color: var(--text-color-secondary);
}

.progress-info i {
  color: var(--primary-color);
}

.progress-info span:first-child {
  flex: 1;
}

.progress-details {
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-color-secondary);
  text-align: center;
}

.mt-2 {
  margin-top: 0.5rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (max-width: 768px) {
  .device-details {
    flex-direction: column;
    gap: 0.25rem;
  }
  
  .device-item {
    padding: 0.5rem;
  }
  
  .info-label {
    min-width: 80px;
  }
}
</style>