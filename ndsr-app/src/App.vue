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
      />
    </Sidebar>

    <div class="main-content">
      <AppHeader
        :is-sidebar-open="isSidebarOpen"
        :formatted-date-time="formattedDateTime"
        :password-of-days="passwordOfDays"
        :current-day="currentDay"
        :cron-enabled="cronStore.cronEnabled"
        :search-query="searchQuery"
        @toggle-sidebar="toggleSidebar"
        @toggle-day="toggleDay"
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

// ✅ Убедитесь, что все импорты корректны
// Удаляем импорт FileManager из App.vue, так как он используется только в AppHeader

// Socket
import { socket } from '@/socket'

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
</style>