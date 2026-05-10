<template>
  <div class="app-container">
    <Toast position="bottom-right" style="right:15px;" />
    <GlobalProgressDialog />
    <PrimeDeviceModal 
      ref="faqModal"
      :device="null"
      :wan-types="[]"
      :filtered-devices="[]"
    />
    <Sidebar v-model:visible="isSidebarOpen" position="left" :style="{ width: '400px' }">
    <SidebarContent 
      :online-count="deviceStore.onlineCount"
      :offline-count="deviceStore.offlineCount" 
      :total-devices="deviceStore.totalDevices"
      @open-faq="openFaqModal"
      @show-remove-confirm="showRemoveDialog"
      @show-add-device="openAddDeviceDialog"
    />
    </Sidebar>

    <Dialog v-model:visible="showRemoveConfirm" modal header="Confirm Device Removal" :style="{ width: '450px' }">
      <div style="display: flex; align-items: flex-start; padding: 0.5rem 0;">
        <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #e74c3c;" />
        <div>
          <h4 class="mb-2">Remove {{ devicesToRemove.length }} device{{ devicesToRemove.length > 1 ? 's' : '' }}?</h4>
          <p class="text-color-secondary mb-0">This will permanently remove:</p>
          <ul style="max-height: 150px; overflow-y: auto; margin-top: 0.5rem;">
            <li v-for="device in devicesToRemove" :key="device.id">
              <strong>{{ device.hwId }}</strong> - {{ device.shortName }}
            </li>
          </ul>
        </div>
      </div>
      <template #footer>
        <Button label="Back to menu" icon="pi pi-times" class="p-button-text" @click="cancelRemove" />
        <Button label="Remove" icon="pi pi-trash" class="p-button-danger" @click="executeRemove" :loading="isRemoving" />
      </template>
    </Dialog>
    <Dialog v-model:visible="showAddDeviceForm" modal header="Add New Device" :style="{ width: '700px' }">
  <div class="add-device-form">
    <div class="form-grid">
      <div class="form-field"><label>ID *</label><InputText v-model="newDevice.id" class="w-full" /></div>
      <div class="form-field"><label>HW ID *</label><InputText v-model="newDevice.hwId" class="w-full" /></div>
      <div class="form-field"><label>Short Name</label><InputText v-model="newDevice.shortName" class="w-full" /></div>
      <div class="form-field"><label>Type</label><InputText v-model="newDevice.type" class="w-full" /></div>
      <div class="form-field"><label>Country</label><InputText v-model="newDevice.country" class="w-full" /></div>
      <div class="form-field"><label>IP</label><InputText v-model="newDevice.ip" class="w-full" /></div>
      <div class="form-field"><label>Check URL</label><InputText v-model="newDevice.checkUrl" class="w-full" /></div>
      <div class="form-field"><label>URL</label><InputText v-model="newDevice.URL" class="w-full" /></div>
      <div class="form-field"><label>Console Port</label><InputText v-model="newDevice.consolePort" class="w-full" /></div>
      <div class="form-field"><label>Reset Port</label><InputText v-model="newDevice.resetPort" class="w-full" /></div>
      <div class="form-field"><label>Reboot Port</label><InputText v-model="newDevice.rebootPort" class="w-full" /></div>
      <div class="form-field"><label>SSH Container</label><InputText v-model="newDevice.sshContainer" class="w-full" /></div>
      <div class="form-field"><label>VNC URL</label><InputText v-model="newDevice.vncUrl" class="w-full" /></div>
      <div class="form-field"><label>Jerome ID</label><InputText v-model="newDevice.jeromeID" class="w-full" /></div>
      <div class="form-field"><label>VLAN Local</label><InputText v-model="newDevice.vlanLocal" class="w-full" /></div>
      <div class="form-field"><label>Switch ID</label><InputText v-model="newDevice.switchID" class="w-full" /></div>
      <div class="form-field"><label>Switch Port WAN</label><InputText v-model="newDevice.switchPortWan" class="w-full" /></div>
      <div class="form-field"><label>Switch Port LAN</label><InputText v-model="newDevice.switchPortLan" class="w-full" /></div>
      <div class="form-field"><label>Console ID</label><InputText v-model="newDevice.consoleID" class="w-full" /></div>
      <div class="form-field"><label>MAC Address</label><InputText v-model="newDevice.macAddress" class="w-full" /></div>
      <div class="form-field"><label>Servicetag</label><InputText v-model="newDevice.servicetag" class="w-full" /></div>
      <div class="form-field"><label>Serial Number</label><InputText v-model="newDevice.serialNumber" class="w-full" /></div>
      <div class="form-field"><label>TFTP Interface</label><InputText v-model="newDevice.tftpInterfaceName" class="w-full" /></div>
    </div>
  </div>
  <template #footer>
    <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="cancelAddDevice" />
    <Button label="Add Device" icon="pi pi-plus" class="p-button-success" @click="addNewDevice" :loading="isAddingDevice" />
  </template>
    </Dialog>
    <div class="main-content">
      <AppHeader
        :is-sidebar-open="isSidebarOpen"
        :formatted-date-time="formattedDateTime"
        :password-of-days="passwordOfDays"
        :current-day="currentDay"
        :cron-enabled="cronStore.cronEnabled"
        :search-query="searchQuery"
        @toggle-sidebar="toggleSidebar"
        @change-password="showChangePasswordDialog = true"
        @toggle-cron="toggleCron"
        @update-search="searchQuery = $event"
        @copy-password="copyToClipboard"
      />

      <div class="content-area">
        <DeviceDataTable
          :wan-types="wanTypes"
          :users="users"
        />
      </div>
    </div>

    <ChatWidget ref="chatComponent" :users="users" />
    <Dialog v-model:visible="showChangePasswordDialog" modal header="Change Device Password" :style="{ width: '450px' }">
        <div style="display: flex; align-items: flex-start; padding: 0.5rem 0;">
          <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #f39c12;" />
          <div>
            <h4 class="mb-2">Generate new password?</h4>
            <p class="text-color-secondary mb-0">
              This will change the password for <strong>all devices</strong>.
            </p>
            <p class="text-color-secondary mt-2">
              Current password: <strong>{{ passwordOfDays[0].password }}</strong>
            </p>
            <p class="text-color-secondary mt-2">
              <i class="pi pi-info-circle mr-1"></i>
              After generating a new password, you must manually apply it to each device for access.
            </p>
          </div>
        </div>
        <template #footer>
          <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="showChangePasswordDialog = false" />
          <Button label="Generate New Password" icon="pi pi-key" class="p-button-warning" @click="changePassword" :loading="isChangingPassword" />
        </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, provide, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useCronStore } from '@/stores/useCronStore'
import { useEscapeStore } from '@/stores/useEscapeStore'
import { useClipboardStore } from '@/stores/useClipboardStore'
import { useModeStore } from '@/stores/useModeStore'
import Sidebar from 'primevue/sidebar'
import Toast from 'primevue/toast'
import AppHeader from '@/components/AppHeader.vue'
import DeviceDataTable from '@/components/DeviceDataTable.vue'
import SidebarContent from '@/components/SidebarContent.vue'
import ChatWidget from '@/components/chat/ChatWidget.vue'
import GlobalProgressDialog from '@/components/GlobalProgressDialog.vue' 
import PrimeDeviceModal from './components/PrimeDeviceModal.vue'
import InputText from 'primevue/inputtext'
// ✅ Убедитесь, что все импорты корректны
// Удаляем импорт FileManager из App.vue, так как он используется только в AppHeader
const showChangePasswordDialog = ref(false)
const isChangingPassword = ref(false)
const changePassword = () => {
  isChangingPassword.value = true
  socket.emit('password:generate', (response) => {
    isChangingPassword.value = false
    showChangePasswordDialog.value = false
    if (response?.success) {
      toast.add({ severity: 'success', summary: 'Password Changed', detail: 'New password generated', life: 3000 })
    } else {
      toast.add({ severity: 'error', summary: 'Error', detail: response?.error || 'Failed', life: 5000 })
    }
  })
}
// Socket
import { socket } from '@/socket'
// В script добавить:
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'

const showRemoveConfirm = ref(false)
const devicesToRemove = ref([])
const isRemoving = ref(false)
const showAddDeviceForm = ref(false)
const isAddingDevice = ref(false)
const newDevice = ref({
  id: '', hwId: '', type: '', country: '', ip: '',
  shortName: '', checkUrl: '', URL: '', consolePort: '',
  resetPort: '', rebootPort: '', sshContainer: '', vncUrl: '',
  jeromeID: '', vlanLocal: '', switchID: '', switchIDWan: '',
  switchPortWan: '', switchPortLan: '', consoleID: '',
  macAddress: '', servicetag: '', serialNumber: '', tftpInterfaceName: ''
})
const openAddDeviceDialog = () => {
  newDevice.value = {
    id: '',
    type: '', country: '', ip: '',
    shortName: '', checkUrl: '', URL: '', consolePort: '',
    resetPort: '', rebootPort: '', sshContainer: '', vncUrl: '',
    jeromeID: '', vlanLocal: '', switchID: '', switchIDWan: '',
    switchPortWan: '', switchPortLan: '', consoleID: '',
    macAddress: '', servicetag: '', serialNumber: '', tftpInterfaceName: '', hwId: ''
  }
  isSidebarOpen.value = false
  showAddDeviceForm.value = true
}

const cancelAddDevice = () => {
  showAddDeviceForm.value = false
  isSidebarOpen.value = true
}

const addNewDevice = async () => {
  if (!newDevice.value.id || !newDevice.value.hwId) {
    toast.add({ severity: 'warn', summary: 'Required', detail: 'ID and HW ID are required', life: 3000 })
    return
  }
  isAddingDevice.value = true
  try {
    await deviceStore.addDevice({ ...newDevice.value })
    toast.add({ severity: 'success', summary: 'Added', detail: `${newDevice.value.hwId} added`, life: 3000 })
    showAddDeviceForm.value = false
    await deviceStore.reloadConfigs()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: error.message, life: 5000 })
  } finally {
    isAddingDevice.value = false
  }
}

const showRemoveDialog = (devices) => {
  devicesToRemove.value = devices
  isSidebarOpen.value = false  // Закрываем сайдбар
  showRemoveConfirm.value = true
}
const cancelRemove = () => {
  showRemoveConfirm.value = false
  isSidebarOpen.value = true  
}
const executeRemove = async () => {
  if (devicesToRemove.value.length === 0) return
  isRemoving.value = true
  try {
    for (const device of devicesToRemove.value) {
      await deviceStore.removeDevice(device.id)
    }
    toast.add({ severity: 'success', summary: 'Devices Removed', detail: `Removed ${devicesToRemove.value.length} devices`, life: 3000 })
    showRemoveConfirm.value = false
    await deviceStore.reloadConfigs()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: error.message, life: 5000 })
  } finally {
    isRemoving.value = false
  }
}
const unsubscribeCallbacks = ref([])
const toast = useToast()

// Инициализация stores
const modeStore = useModeStore()
const deviceStore = useDeviceStore()
const cronStore = useCronStore()
const escapeStore = useEscapeStore()
const clipboardStore = useClipboardStore()
const faqModal = ref(null)  

// Реактивные данные
const isSidebarOpen = ref(false)
const searchQuery = ref('')
const wanTypes = ref([])
const users = ref([])
const chatComponent = ref(null)
const currentDay = ref(0)
const passwordOfDays = ref([
  { label: 'Today', password: '' },
  { label: 'Yesterday', password: '' }
])
const currentDateTime = ref(new Date())
const isChatOpen = ref(false)

// Provide для дочерних компонентов
provide('todayPassword', computed(() => passwordOfDays.value[0].password))
provide('chatUsers', users)

// Computed свойства
const formattedDateTime = computed(() => {
  return currentDateTime.value.toLocaleString('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
})

// Методы
const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

watch(isSidebarOpen, (newVal) => {
  if (newVal) {
    isChatOpen.value = false
  }
})

const closeSidebar = () => {
  isSidebarOpen.value = false
}
provide('closeSidebar', closeSidebar)
provide('isChatOpen', isChatOpen)
provide('isSidebarOpen', isSidebarOpen)

const toggleDay = () => {
  currentDay.value = (currentDay.value + 1) % passwordOfDays.value.length
}

const toggleCron = async () => {
  try {
    await cronStore.toggleCron(!cronStore.cronEnabled)
  } catch (error) {
    console.error('Failed to toggle cron:', error)
  }
}

const openFaqModal = () => {
  if (faqModal.value) {
    faqModal.value.show('faq')
    isSidebarOpen.value = false
  } else {
    console.error('FAQ modal ref is not available')
  }
}

const copyToClipboard = async (text) => {
  if (!text) return
  await clipboardStore.copyToClipboard(text)
}

// Обработчик бронирования устройства
const handleDeviceBooked = async (event) => {
    const { deviceId, password } = event.detail;
    
    setTimeout(async () => {
        try {
            await modeStore.updateModeFromDetection(deviceId, password);
        } catch (error) {
            // console.error(`⚠️ Mode detection failed for ${deviceId}:`, error.message);
        }
    }, 3000);
};

const initializeApp = async () => {
  console.log('🚀 Initializing application...')
  
  try {
    // Ждем инициализации deviceStore
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Инициализируем режимы устройств
    await modeStore.initializeModes()
    
    // Валидация режимов
    setTimeout(() => {
        if (modeStore.validateAndFixModes && !modeStore.validationInProgress) {
            modeStore.validateAndFixModes()
        }
    }, 2000)
    
    // Слушатели обновлений
    const modeUnsubscribe = modeStore.listenForModeUpdates((data) => {
      // Обработка обновлений режимов
    })
    
    const mwsUnsubscribe = modeStore.listenForMwsUpdates((data) => {
      // Обработка обновлений MWS
    })
    
    unsubscribeCallbacks.value.push(modeUnsubscribe, mwsUnsubscribe)
    
  } catch (error) {
    console.error('❌ Failed to initialize app:', error)
  }
}

// Watcher для отслеживания изменений режимов
watch(
  () => modeStore.currentMode,
  (newModes) => {
    const deviceCount = Object.keys(newModes).length;
    if (deviceCount > 0) {
      // Логирование
    }
  },
  { deep: true, flush: 'post' }
);

// Socket listeners
let timer

onMounted(() => {
  console.log('📱 App mounted - starting initialization');
  
  // Инициализация
  initializeApp();

  // Socket слушатели
  if (socket) {
    socket.on('DAILY_PASSWORDS', (data) => {
      if (data && data.today && data.yesterday) {
        passwordOfDays.value = [
          { label: 'Today', password: data.today.value || '' },
          { label: 'Yesterday', password: data.yesterday.value || '' }
        ]
      }
    });
    
    socket.on('CLIENT_IP', (clientIp) => {
      if (deviceStore && deviceStore.setCurrentUserId) {
        deviceStore.setCurrentUserId(clientIp);
      }
    });

    socket.on('device:wanTypes', (data) => {
      wanTypes.value = data || [];
    });

    socket.on('device:users', (data) => {
      users.value = data || [];
      if (deviceStore && deviceStore.setUsers) {
        deviceStore.setUsers(data);
      }
    });
  }

  // Слушатель событий бронирования
  window.addEventListener('device-booked', handleDeviceBooked);
  
  // Инициализация слушателей в store
  if (deviceStore && deviceStore.initializeSocketListeners) {
    deviceStore.initializeSocketListeners();
  }
  
  // Таймер для обновления времени
  timer = setInterval(() => {
    currentDateTime.value = new Date();
  }, 1000);

  // Регистрация обработчика Escape
  if (escapeStore && escapeStore.registerEscapeHandler) {
    escapeStore.registerEscapeHandler(closeSidebar);
  }
  
  // Сохранение для очистки
  unsubscribeCallbacks.value.push(
    () => window.removeEventListener('device-booked', handleDeviceBooked)
  );
});

onUnmounted(() => {
  console.log('🧹 Cleaning up App.vue...')
  
  // Очищаем таймер
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  
  // Очищаем все слушатели
  unsubscribeCallbacks.value.forEach(unsubscribe => {
    if (unsubscribe && typeof unsubscribe === 'function') {
      try {
        unsubscribe()
      } catch (error) {
        console.warn('⚠️ Error unsubscribing:', error)
      }
    }
  })
  unsubscribeCallbacks.value = []
  
  // Очищаем слушатели store
  if (deviceStore && deviceStore.cleanupSocketListeners) {
    deviceStore.cleanupSocketListeners()
  }
  
  // Очищаем escape handlers
  if (escapeStore && escapeStore.unregisterEscapeHandler) {
    escapeStore.unregisterEscapeHandler(closeSidebar)
  }
  
  // Очищаем socket слушатели
  if (socket) {
    socket.off('DAILY_PASSWORDS')
    socket.off('CLIENT_IP') 
    socket.off('device:wanTypes')
    socket.off('device:users')
    socket.off('device:mwsStatusUpdated')
  }
  
  console.log('✅ App.vue cleanup completed')
})
</script>

<style>
/* Стили остаются без изменений */
.app-container {
  min-height: 100vh;
  background-color: var(--surface-ground);
  position: relative;
}

.main-content {
  margin-left: 0;
  transition: margin-left 0.3s ease;
  position: relative;
  z-index: 1;
}

.content-area {
  padding: 1rem;
  background: var(--surface-ground);
  min-height: calc(100vh - 80px);
}

:deep(.p-sidebar) {
  box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
  z-index: 1001 !important;
}

:deep(.p-sidebar-header) {
  padding: 1rem;
  border-bottom: 1px solid var(--surface-border);
}

:deep(.p-sidebar-content) {
  padding: 1rem;
}

@media (max-width: 768px) {
  .content-area {
    padding: 0.5rem;
  }
  
  body.sidebar-open {
    overflow: hidden;
    position: fixed;
    width: 100%;
    height: 100%;
  }
  
  :deep(.p-sidebar-mask) {
    z-index: 1000 !important;
  }
  
  :deep(.p-sidebar) {
    width: 85% !important;
    max-width: 300px;
  }
}
.add-device-form { max-height: 60vh; overflow-y: auto; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }
.form-field { display: flex; flex-direction: column; gap: 0.25rem; }
.form-field label { font-size: 0.75rem; font-weight: 600; color: var(--text-color-secondary); }

@media (max-width: 900px) { .form-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
</style>