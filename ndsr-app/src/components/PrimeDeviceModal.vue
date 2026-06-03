<template>
  <Dialog 
    :blockScroll="false"
    v-model:visible="visible" 
    :modal="true" 
    :header="modalTitle"
    :style="getModalStyle"
    :breakpoints="{ '960px': '85vw', '641px': '95vw' }"
    :contentStyle="{ padding: mobileView ? '1rem' : '1.5rem' }"
    :closable="!isLoading && !operationInProgress"
    :closeOnEscape="!isLoading && !operationInProgress"
    :dismissableMask="!isLoading && !operationInProgress"
    class="optimized-modal mws-connection-modal"
  >
    <div v-if="isLoading || operationInProgress" class="operation-progress">
      <ProgressBar mode="indeterminate" style="height: 6px; width: 100%"></ProgressBar>
      <div class="progress-message">
        <i class="pi pi-spin pi-spinner"></i>
        <span>{{ progressMessage }}</span>
      </div>
      
      <!-- Специфичная информация для WAN операций -->
      <div v-if="operationType === 'wan'" class="progress-details">
        <small class="text-color-secondary">
          <i class="pi pi-info-circle mr-1"></i>
          Connecting to switch via telnet...
        </small>
      </div>
    </div>

    <!-- WAN Types Modal -->
    <div v-if="modalType === 'wanTypes'" class="modal-content">
      <div class="options-grid" :class="{ 'opacity-50 pointer-events-none': isWanOperationInProgress }">
        <div 
          v-for="wan in filteredWanTypes" 
          :key="wan.vlanId" 
          class="option-item"
          :class="{ 'option-selected': modalValue === wan.vlanId }"
          @click="!isWanOperationInProgress && (modalValue = wan.vlanId)"
        >
          <RadioButton 
            v-model="modalValue" 
            :value="wan.vlanId" 
            :inputId="'wan_' + wan.vlanId"
            :disabled="isLoading || operationInProgress"
          />
          <label :for="'wan_' + wan.vlanId" class="option-label">{{ wan.type }}</label>
        </div>
      </div>
      
      <Message v-if="showPPPoECredentials" severity="info" class="info-message mt-3">
        <div class="message-content">
          <i class="pi pi-info-circle"></i>
          <div>
            <div><strong>PPPoE Credentials</strong></div>
            <div>Login: <strong>support</strong></div>
            <div>Password: <strong>support2019</strong></div>
          </div>
        </div>
      </Message>
      
      <Message v-if="showResetHint" severity="info" class="info-message mt-3">
        <div class="message-content">
          <div>
            Select <strong>"Clear WAN type"</strong> to disconnect all WAN connections
          </div>
        </div>
      </Message>
    </div>

    <!-- MWS Connection Modal -->
    <div v-if="modalType === 'mwsConnection'" class="modal-content">
      <!-- Текущее подключение -->
      <div class="current-connection-section" v-if="currentConnection">
        <Message :severity="getConnectionSeverity(currentConnection.status)" class="connection-info">
          <div class="message-content">
            <div class="connection-details">
              <div class="connection-header">
                <strong>Current Connection</strong>
                <Tag :value="currentConnection.status" :severity="getConnectionSeverity(currentConnection.status)" class="status-badge" />
              </div>
              <div class="connection-info-line">
                <span class="info-label">Router:</span>
                <strong>{{ currentConnection.routerName }}</strong>
              </div>
              <div class="connection-info-line">
                <span class="info-label">Connected since:</span>
                <span>{{ formatConnectionTime(currentConnection.connectedSince) }}</span>
              </div>
              <div v-if="currentConnection.modeConnect" class="connection-info-line">
                <span class="info-label">Connection Type:</span>
                <div class="signal-indicator">
                  <span>{{ currentConnection.modeConnect }}</span>
                </div>
              </div>
            </div>
          </div>
        </Message>
      </div>

      <!-- Статус отсутствия подключения -->
      <div v-else class="no-connection-section">
        <Message severity="warn" class="connection-info">
          <div class="message-content">
            <div>
              <div><strong>No Active Connection</strong></div>
              <div>This AP is not connected to any router</div>
            </div>
          </div>
        </Message>
      </div>

      <!-- Выбор пароля для роутера -->
      <div v-if="hasValidPassword && !authError" class="router-password-section mb-4 mt-3">
        <h6 class="section-title mb-3">Router Authentication:</h6>
        
        <div class="password-toggle-section mb-3">
          <div class="horizontal-password-options">
            <div class="password-option horizontal-option" 
                :class="{ 'active': useDevicePassword }"
                @click="useDevicePassword = true">
              <div class="option-content">
                <RadioButton
                  v-model="useDevicePassword"
                  inputId="useDevicePassword"
                  name="passwordSource"
                  :value="true"
                  class="password-radio"
                  :disabled="isLoading || operationInProgress"
                />
                <label for="useDevicePassword" class="password-label">
                  <div class="flex align-items-center mb-1">
                    <i class="pi pi-key mr-2 text-primary"></i>
                    <strong>Device Password</strong>
                  </div>
                  <small class="block text-color-secondary">
                    Same as device
                  </small>
                </label>
              </div>
            </div>

            <div class="password-option horizontal-option" 
                :class="{ 'active': !useDevicePassword }"
                @click="useDevicePassword = false">
              <div class="option-content">
                <RadioButton
                  v-model="useDevicePassword"
                  inputId="useManualPassword"
                  name="passwordSource"
                  :value="false"
                  class="password-radio"
                  :disabled="isLoading || operationInProgress"
                />
                <label for="useManualPassword" class="password-label">
                  <div class="flex align-items-center mb-1">
                    <i class="pi pi-pencil mr-2 text-warning"></i>
                    <strong>Manual Password</strong>
                  </div>
                  <small class="block text-color-secondary">
                    Enter manually
                  </small>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!useDevicePassword" class="manual-password-section">
          <div class="password-input-container">
            <label class="text-sm font-semibold mb-2 block">Router Password:</label>
            <form @submit.prevent>
            <Password 
              v-model="manualRouterPassword" 
              :feedback="false" 
              placeholder="Enter router password"
              class="w-full router-password-input"
              toggleMask
              :disabled="isLoading || operationInProgress"
            />
            </form>
            <small class="text-color-secondary mt-1 block">
              <i class="pi pi-info-circle mr-1"></i>
              Enter the router's admin password if different from device
            </small>
          </div>
        </div>

        <div v-else class="password-info-section">
          <div class="info-message p-2 border-round bg-green-50 border-1 border-green-200">
            <div class="flex align-items-center">
              <i class="pi pi-check-circle text-green-600 mr-2"></i>
              <span class="text-green-700">
                Will use device password: <strong>{{ devicePassword ? '••••••••' : 'Not set' }}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Выбор роутера для подключения -->
      <div class="connection-options-section mt-3">
        <h4 class="section-title">
          <i class="pi pi-wifi mr-2"></i>
          Available Routers
        </h4>
        
        <div class="routers-list">
          <div 
            v-for="router in availableRouters" 
            :key="router.id" 
            class="router-item"
            :class="{ 
              'router-selected': modalValue === router.id,
              'router-current': currentConnection?.routerId === router.id
            }"
            @click="selectRouter(router.id)"
          >
            <div class="router-selection">
              <RadioButton 
                v-model="modalValue" 
                :value="router.id" 
                :inputId="'router_' + router.id"
                :disabled="currentConnection?.routerId === router.id || isLoading || operationInProgress"
              />
            </div>
            
            <label :for="'router_' + router.id" class="router-info">
              <div class="router-main-info">
                <div class="router-name">{{ router.shortName }}</div>
                <div class="router-hwid">{{ router.hwId }}</div>
              </div>
              
              <div class="router-status">
                <div class="online-indicator">
                  <i class="pi pi-circle-fill online-dot"></i>
                  <span>Online</span>
                </div>
                <div v-if="currentConnection?.routerId === router.id" class="current-badge">
                  <i class="pi pi-check"></i>
                  Connected
                </div>
              </div>
            </label>
          </div>
        </div>

        <!-- Сообщение если нет доступных роутеров -->
        <div v-if="availableRouters.length === 0" class="no-routers-message mt-3">
          <Message severity="info">
            <div class="message-content">
              <div>
                <div><strong>No Routers Available</strong></div>
                <div>No online routers found</div>
              </div>
            </div>
          </Message>
        </div>
      </div>

      <!-- Информация о подключении -->
      <Message severity="info" class="connection-tips mt-3">
        <div class="message-content">
          <i class="pi pi-lightbulb"></i>
          <div>
            <div><strong>Connection Tips</strong></div>
            <ul class="tips-list">
              <li>Both AP and Router must be <strong>online</strong></li>
              <li>Connection may take 30-60 seconds to establish</li>
              <li>Devices will automatically reconnect after reboot</li>
            </ul>
          </div>
        </div>
      </Message>
    </div>

    <!-- FAQ Modal -->
    <div v-if="modalType === 'faq'" class="faq-modal-content">
      <div class="faq-controls">
        <div class="language-switcher">
          <Button 
            @click="currentLanguage = 'en'" 
            :label="'EN'"
            size="small"
            :class="{ 'p-button-primary': currentLanguage === 'en', 'p-button-outlined': currentLanguage !== 'en' }"
            :disabled="isLoading || operationInProgress"
          />
          <Button 
            @click="currentLanguage = 'ru'" 
            :label="'RU'"
            size="small"
            :class="{ 'p-button-primary': currentLanguage === 'ru', 'p-button-outlined': currentLanguage !== 'ru' }"
            :disabled="isLoading || operationInProgress"
          />
        </div>
        
        <span class="p-input-icon-left search-container">
          <i class="pi pi-search" />
          <InputText 
            v-model="faqSearchQuery" 
            :placeholder="currentLanguage === 'en' ? 'Search FAQ...' : 'Поиск...'"
            size="small"
            class="search-input"
            :disabled="isLoading || operationInProgress"
          />
        </span>
      </div>

      <div class="faq-list mt-3">
        <Accordion :multiple="true">
          <AccordionTab 
            v-for="(item, index) in filteredFaqItems" 
            :key="item.id" 
            :header="item.question"
            class="faq-item"
          >
            <div class="answer-text">{{ item.answer }}</div>
            <div v-if="item.additionalInfo" class="additional-info mt-2">
              <i class="pi pi-info-circle"></i>
              {{ item.additionalInfo }}
            </div>
          </AccordionTab>
        </Accordion>

        <div v-if="filteredFaqItems.length === 0" class="empty-faq">
          <i class="pi pi-search" style="font-size: 2rem; margin-bottom: 1rem;"></i>
          <div>{{ currentLanguage === 'en' ? 'No questions found' : 'Вопросы не найдены' }}</div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer">
        <Button 
          :label="'Close'" 
          icon="pi pi-times" 
          @click="closeModal" 
          class="p-button-text close-btn"
          size="small"
          :disabled="isLoading || operationInProgress"
        />
        
        <template v-if="modalType === 'wanTypes'">
          <Button 
            :label="mobileView ? 'Apply' : 'Apply changes'" 
            icon="pi pi-check" 
            @click="saveWanChanges" 
            :loading="isLoading"
            class="apply-btn" 
            size="small"
            :disabled="operationInProgress || !modalValue"
          />
        </template>
        
        <template v-if="modalType === 'mwsConnection'">
          <div class="connection-actions">
            <Button 
              v-if="currentConnection"
              :label="'Disconnect'" 
              icon="pi pi-unlink" 
              @click="saveChanges('disconnect')" 
              class="p-button-outlined p-button-danger disconnect-btn"
              :loading="isLoading && operationType === 'disconnect'"
              :disabled="isLoading || operationInProgress"
              size="small"
            />
            
            <Button 
              :label="getConnectButtonLabel()" 
              icon="pi pi-link" 
              @click="saveChanges('connect')" 
              :loading="isLoading && operationType === 'connect'"
              class="connect-btn"
              size="small"
              :disabled="!canConnect || isLoading || operationInProgress"
            />
          </div>
        </template>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import { socket } from '@/socket'
import Dialog from 'primevue/dialog'
import RadioButton from 'primevue/radiobutton'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Accordion from 'primevue/accordion'
import AccordionTab from 'primevue/accordiontab'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import Password from 'primevue/password'
import ProgressBar from 'primevue/progressbar'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useModeStore } from '@/stores/useModeStore'

const toast = useToast()
const deviceStore = useDeviceStore()
const modeStore = useModeStore()

const props = defineProps({
  device: {
    type: Object,
    default: null
  },
  wanTypes: {
    type: Array,
    default: () => [],
  },
  filteredDevices: {
    type: Array,
    default: () => [],
  },
  currentWanType: String,
})

const emit = defineEmits(['save', 'operationStarted', 'operationProgress'])

// Основные состояния
const visible = ref(false)
const modalValue = ref(null)
const modalType = ref('')
const isLoading = ref(false)
const operationType = ref('')
const operationInProgress = ref(false)
const progressMessage = ref('')
const showPPPoECredentials = ref(false)
const showResetHint = ref(true)
const faqSearchQuery = ref('')
const currentLanguage = ref('en')
const currentConnection = ref(null)
const connectionLoading = ref(false)

// Состояния для управления паролем
const useDevicePassword = ref(true)
const manualRouterPassword = ref('')
const devicePassword = ref('')
const passwordSource = ref('global')
const authError = ref(false)

// Таймеры
const operationTimeout = ref(null)
const completionHandler = ref(null)

// Локальная копия устройства
const currentDevice = ref(null)

// Определение мобильного устройства
const mobileView = computed(() => window.innerWidth <= 768)

// FAQ данные
const localizedFaqItems = {
  en: [
    {
      id: 1,
      question: "How do I change the WAN type?",
      answer: "1. On your device slate, click the 'Wan Type' button and select desired WAN connection type\n2. Open the device web interface and set up selected type of connection in the 'Internet' menu",
      additionalInfo: "PPPoE requires special credentials (provided in the modal)"
    },
    {
      id: 2,
      question: "How to connect extender to router?",
      answer: "1. On extender device, click 'MWS Connection' button\n2. Select the router you want to connect to\n3. Click 'Connect' button",
      additionalInfo: "Both devices must be online"
    },
    {
      id: 3,
      question: "How to reset device configuration?",
      answer: "1. Click the 'Reset Configuration' button (circular refresh icon)\n2. Confirm the action in the dialog",
      additionalInfo: "This will restore factory defaults and erase all settings"
    },
    {
      id: 4,
      question: "How to change device mode?",
      answer: "1. Click the 'Change Mode' button (wrench icon)\n2. Select desired mode (Router/Extender)\n3. Confirm the change",
      additionalInfo: "Device will reboot after mode change"
    }
  ],
  ru: [
    {
      id: 1,
      question: "Как изменить тип WAN-подключения?",
      answer: "1. Нажмите кнопку 'Wan Type' и укажите тип WAN-подключения\n2. Откройте веб-конфигуратор устройства и настройте выбранный тип подключения в меню 'Интернет'",
      additionalInfo: "PPPoE требует специальных учетных данных (отображаются в модальном окне)"
    },
    {
      id: 2,
      question: "Как подключить экстендер к роутеру?",
      answer: "1. На экстендере нажмите кнопку 'MWS Connection'\n2. Выберите роутер для подключения\n3. Нажмите кнопку 'Connect'",
      additionalInfo: "Оба устройства должны быть онлайн"
    },
    {
      id: 3,
      question: "Как сбросить конфигурацию устройства?",
      answer: "1. Нажмите кнопку 'Reset Configuration'\n2. Подтвердите действие в диалоговом окне",
      additionalInfo: "Это восстановит заводские настройки и удалит все пользовательские параметры"
    },
    {
      id: 4,
      question: "Как изменить режим устройства?",
      answer: "1. Нажмите кнопку 'Change Mode' (иконка гаечного ключа)\n2. Выберите желаемый режим (Экстендер+Роутер/Экстендер)\n3. Подтвердите изменение",
      additionalInfo: "Устройство перезагрузится после смены режима"
    },
    {
      id: 5,
      question: "Можно ли менять локальный адрес устройства с дефолтного 192.168.1.1 на любой другой?",
      answer: "Да, изменить можно, для применения настроек потребуется примерно 1-2 минуты",
      additionalInfo: "Все устройства к свичу доступа подключены 1 портом, изменять его или настраивать в режиме Trunk на кинетике НЕЛЬЗЯ! Потеряете доступ сразу же!"
    },
    {
      id: 6,
      question: "Можно ли использовать свой пароль на устройстве?",
      answer: "Да, но некоторые функции не будут работать. Например не будет отображаться версия ПО на портале.",
      additionalInfo: "При подключении экстендеров с вашим паролем нужно выбирать режим 'Enter Manually'"
    }
  ]
}

// Computed свойства
const hasValidPassword = computed(() => {
  return devicePassword.value && 
        devicePassword.value.trim() !== '' && 
        devicePassword.value !== 'Loading...'
})

const routerPasswordToUse = computed(() => {
  if (useDevicePassword.value) {
    return devicePassword.value
  } else {
    return manualRouterPassword.value
  }
})

const modalTitle = computed(() => {
  if (!currentDevice.value) return 'FAQ'
  
  const titles = {
    wanTypes: `WAN Type: ${currentDevice.value.shortName}`,
    mwsConnection: `MWS Connection: ${currentDevice.value.shortName}`,
    faq: currentLanguage.value === 'en' ? 'FAQ' : 'Частые вопросы'
  }
  
  return titles[modalType.value] || (currentLanguage.value === 'en' ? 'FAQ' : 'Частые вопросы')
})

const filteredWanTypes = computed(() => {
  if (modalType.value === 'wanTypes') {
    return props.wanTypes.filter(wan => 
      wan.vlanId !== undefined && 
      wan.vlanId !== null && 
      wan.type?.trim() !== ""
    )
  }
  return []
})

// ✅ Доступные роутеры — сортировка по shortName A-Z
const availableRouters = computed(() => {
  if (modalType.value !== 'mwsConnection') return []
  
  return deviceStore.devices
    .filter(dev => 
      dev.type === 'router' &&
      dev.statusCode === 200 &&
      dev.id !== currentDevice.value?.id
    )
    .sort((a, b) => (a.shortName || '').localeCompare(b.shortName || ''))
})


const filteredFaqItems = computed(() => {
  const items = localizedFaqItems[currentLanguage.value] || []
  if (!faqSearchQuery.value) return items
  
  const query = faqSearchQuery.value.toLowerCase()
  return items.filter(item => 
    item.question.toLowerCase().includes(query) || 
    item.answer.toLowerCase().includes(query)
  )
})

const canConnect = computed(() => {
  return modalValue.value !== null && availableRouters.value.length > 0
})

const getModalStyle = computed(() => {
  if (mobileView.value) {
    return { width: '95vw', maxWidth: '95vw' }
  }
  
  const widthSettings = {
    mwsConnection: { width: '600px', maxWidth: '600px' },
    wanTypes: { width: '550px', maxWidth: '550px' },
    faq: { width: '700px', maxWidth: '700px' }
  }
  
  return widthSettings[modalType.value] || { width: '550px', maxWidth: '550px' }
})

const isWanOperationInProgress = computed(() => {
  return operationInProgress.value && operationType.value === 'wan'
})

// Методы
const fetchCurrentConnection = async (deviceId) => {
  if (!deviceId) {
    currentConnection.value = null
    return
  }
  
  connectionLoading.value = true
  try {
    const device = deviceStore.devices.find(d => d.id === deviceId)
    
    if (!device) {
      currentConnection.value = null
      return
    }

    const modeInfo = modeStore.getDeviceModeInfo(deviceId)
    
    if (modeInfo && modeInfo.mode === 'extender_connect' && modeInfo.routerId) {
      const router = deviceStore.devices.find(d => d.id === modeInfo.routerId)
      if (router) {
        currentConnection.value = {
          routerId: modeInfo.routerId,
          routerName: `${router.hwId} ${router.shortName}`,
          status: 'connected',
          connectedSince: modeInfo.timestamp || Date.now(),
          modeConnect: 'Wired'
        }
        return
      }
    }

    if (device && device.type === 'AP' && device.hWtype === 'true') {
      await fetchAPDeviceConnection(deviceId, device)
    } else {
      currentConnection.value = null
    }
    
  } catch (error) {
    console.error('❌ Failed to fetch current connection:', error)
    currentConnection.value = null
  } finally {
    connectionLoading.value = false
  }
}

const fetchAPDeviceConnection = async (deviceId, device) => {
  try {
    const connectionResponse = await new Promise((resolve) => {
      socket.emit('device:getMwsConnection', deviceId, (response) => {
        resolve(response)
      })
      
      setTimeout(() => resolve({ success: false, connection: null }), 5000)
    })
    
    if (connectionResponse?.success && connectionResponse.connection) {
      currentConnection.value = {
        routerId: connectionResponse.connection.routerId,
        routerName: connectionResponse.connection.routerName,
        status: connectionResponse.connection.status,
        connectedSince: connectionResponse.connection.connectedSince,
        modeConnect: 'Wired'
      }
    } else {
      currentConnection.value = null
    }
    
  } catch (error) {
    console.error('❌ Error fetching AP device connection:', error)
    currentConnection.value = null
  }
}

const getConnectButtonLabel = () => {
  if (currentConnection.value && modalValue.value === currentConnection.value.routerId) {
    return 'Reconnect'
  }
  return 'Connect to Router'
}

const getConnectionSeverity = (status) => {
  const severityMap = {
    connected: 'success',
    connecting: 'warning',
    disconnected: 'danger',
    error: 'danger'
  }
  return severityMap[status] || 'info'
}

const formatConnectionTime = (timestamp) => {
  if (!timestamp) return 'Unknown'
  return new Date(timestamp).toLocaleString()
}

const selectRouter = (routerId) => {
  modalValue.value = routerId
}

// ✅ ИСПРАВЛЕНО: Убраны проверки бронирования
const show = async (type, password = '', source = 'global') => {
  modalType.value = type
  faqSearchQuery.value = ''
  visible.value = true
  currentDevice.value = props.device
  
  devicePassword.value = password
  passwordSource.value = source
  useDevicePassword.value = true
  manualRouterPassword.value = ''
  authError.value = false
  
  isLoading.value = false
  operationInProgress.value = false
  operationType.value = ''
  progressMessage.value = ''
  
  if (type === 'mwsConnection' && props.device) {
    if (!props.device.id) {
      console.error('❌ No device ID provided for MWS connection')
      return
    }
    
    await fetchCurrentConnection(props.device.id)
    
    if (currentConnection.value) {
      modalValue.value = currentConnection.value.routerId
    } else if (availableRouters.value.length > 0) {
      modalValue.value = availableRouters.value[0].id
    } else {
      modalValue.value = null
    }
  } else if (type === 'wanTypes') {
    modalValue.value = props.currentWanType === 'ISP not configured' ? null : props.currentWanType
  }
}

const closeModal = () => {
  if (operationInProgress.value && currentDevice.value?.id) {
    socket.emit('device:cancelOperation', {
      deviceId: currentDevice.value.id,
      operationType: operationType.value
    })
  }
  
  const deviceId = currentDevice.value?.id
  const deviceHwId = currentDevice.value?.hwId
  
  modalValue.value = null
  modalType.value = '' 
  currentDevice.value = null
  currentConnection.value = null
  visible.value = false
  isLoading.value = false
  operationInProgress.value = false
  operationType.value = ''
  progressMessage.value = ''
  faqSearchQuery.value = ''
  
  devicePassword.value = ''
  manualRouterPassword.value = ''
  useDevicePassword.value = true
  authError.value = false
  
  // console.log('🔒 Modal closed, device data cleared:', { deviceId, deviceHwId })
}

const saveChanges = async (action = 'connect') => {
  try {
    // console.log('💾 Saving MWS changes for device:', currentDevice.value?.id, 'action:', action)
    
    if (!currentDevice.value?.id) {
      toast.add({ severity: 'error', summary: 'Error', detail: 'No device selected', life: 3000 })
      return
    }
    
    if (!modalValue.value && action !== 'disconnect') {
      toast.add({ severity: 'warn', summary: 'Warning', detail: 'Please select a router', life: 3000 })
      return
    }
    
    const deviceId = currentDevice.value.id;
    
    if (currentDevice.value.hwType === 'yes') {
      const mwsData = {
        deviceId: deviceId,
        routerId: modalValue.value,
        action: action,
        routerPassword: routerPasswordToUse.value,
        useDevicePassword: useDevicePassword.value
      };
      
      const saveData = {
        value: modalValue.value,
        type: 'mwsApConnection',  
        action: action,
        routerPassword: routerPasswordToUse.value,
        useDevicePassword: useDevicePassword.value,
        callback: (success, message) => {
          if (success) {
            // console.log('✅ MWS AP operation completed:', message)
            toast.add({ severity: 'success', summary: 'Success', detail: message, life: 3000 })
            
            if (action === 'disconnect') {
              currentConnection.value = null
            } else {
              setTimeout(() => {
                fetchCurrentConnection(deviceId);
              }, 5000);
            }
          } else {
            console.error('❌ MWS AP operation failed:', message)
            toast.add({ severity: 'error', summary: 'Error', detail: message, life: 5000 })
          }
        }
      };
      
      emit('save', saveData);
      
      emit('operationStarted', {
        deviceId: deviceId,
        operationType: 'mwsConnection',  
        operationData: {
          action: action,
          routerId: modalValue.value,
          isDisconnect: action === 'disconnect'
        }
      });
      
      closeModal();
      return;
    }
    
    let mode
    if (action === 'disconnect') {
      mode = 'extender_disconnect'
    } else {
      mode = currentConnection.value ? 'extender_connect' : 'extender'
    }

    emit('operationStarted', {
      deviceId: deviceId,
      operationType: 'modeChange',
      operationData: {
        oldMode: currentConnection.value ? 'extender_connect' : 'router',
        newMode: mode,
        routerId: modalValue.value,
        action: action
      }
    });

    const saveData = {
      value: modalValue.value,
      type: 'mwsConnection',
      action: action,
      routerPassword: routerPasswordToUse.value,
      useDevicePassword: useDevicePassword.value,
      mode: mode,
      callback: (success, message) => {
        if (success) {
          // console.log('✅ MWS operation completed:', message)
          toast.add({ severity: 'success', summary: 'Success', detail: message, life: 3000 })
          
          if (action === 'disconnect') {
            currentConnection.value = null
          } else {
            setTimeout(() => {
              fetchCurrentConnection(deviceId);
            }, 5000);
          }
        } else {
          console.error('❌ MWS operation failed:', message)
          toast.add({ severity: 'error', summary: 'Error', detail: message, life: 5000 })
        }
      }
    }

    emit('save', saveData);    
    
  } catch (error) {
    console.error('❌ Save changes error:', error)
    toast.add({ severity: 'error', summary: 'Error', detail: error.message, life: 5000 })
  }
}

const saveWanChanges = () => {
  isLoading.value = true
  operationInProgress.value = true
  operationType.value = 'wan'
  progressMessage.value = 'Configuring switch...'
  
  const saveData = {
    value: modalValue.value,
    type: 'wanTypes',
    callback: (success, message) => {
      isLoading.value = false
      operationInProgress.value = false
      operationType.value = ''
      progressMessage.value = ''
      
      if (success) {
        // console.log('✅ WAN type saved successfully:', message)
        toast.add({
          severity: 'success',
          summary: 'Success',
          detail: message,
          life: 3000
        })
        closeModal()
      } else {
        console.error('❌ Failed to save WAN type:', message)
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: message,
          life: 5000
        })
      }
    }
  }
  
  emit('save', saveData)
}

watch(modalValue, (newVal) => {
  showPPPoECredentials.value = newVal === '747'
  showResetHint.value = newVal === null
})

onUnmounted(() => {
  if (operationTimeout.value) {
    clearTimeout(operationTimeout.value)
  }
  socket.off('device:modeUpdated')
  socket.off('device:operationError')
})

defineExpose({ 
  show,
  updateProgress: (newProgress, step, details) => {
    console.log('Progress update:', newProgress, step, details)
  }
})


</script>

<style scoped>
.optimized-modal {
  max-height: 90vh;
}

.modal-content {
  padding: 0.5rem 0;
}

/* Остальные стили без изменений */
.operation-progress {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 8px;
  border: 1px solid var(--surface-200);
}

.progress-details {
  margin-top: 0.5rem;
  font-size: 0.85rem;
}

.opacity-50 {
  opacity: 0.5;
}

.pointer-events-none {
  pointer-events: none;
}

.progress-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  color: var(--text-color-secondary);
  font-size: 0.9rem;
}

.progress-message i {
  color: var(--primary-color);
}

.section-title {
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--text-color);
  font-size: 1rem;
  line-height: 1.2;
}

.message-content {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.message-content i {
  color: var(--primary-color);
  margin-top: 0.125rem;
  flex-shrink: 0;
}

/* WAN Types */
.options-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 50vh;
  overflow-y: auto;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.option-item:hover {
  background: var(--surface-hover);
  border-color: var(--primary-color);
}

.option-selected {
  background: var(--primary-color-light);
  border-color: var(--primary-color);
}

.option-label {
  cursor: pointer;
  flex: 1;
  margin: 0;
}

/* MWS Connection */
.connection-info-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.connection-info-line strong,
.connection-info-line span:not(.info-label) {
  font-size: 0.85rem;
  line-height: 1.2;
}

.info-label {
  color: var(--text-color-secondary);
  min-width: 120px;
  text-align: left;
  font-size: 0.85rem;
}

.connection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.status-badge {
  font-size: 0.7rem;
}

.router-password-section {
  background: var(--surface-50);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--surface-200);
}

.horizontal-password-options {
  display: flex;
  flex-direction: row;
  gap: 1rem;
  width: 100%;
}

.password-option.horizontal-option {
  display: flex;
  align-items: stretch;
  padding: 0;
  border: 2px solid var(--surface-300);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  height: auto;
  flex: 1;
  min-width: 0;
}

.password-option.horizontal-option:hover {
  border-color: var(--primary-300);
  background-color: var(--surface-50);
}

.password-option.horizontal-option.active {
  border-color: var(--primary-500);
  background-color: var(--primary-50);
}

.password-option.horizontal-option .option-content {
  display: flex;
  align-items: flex-start;
  padding: 1rem;
  width: 100%;
  height: 100%;
}

.password-option.horizontal-option .password-radio {
  margin-right: 12px;
  margin-top: 2px;
  flex-shrink: 0;
}

.password-option.horizontal-option .password-label {
  cursor: pointer;
  flex: 1;
  margin: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100%;
}

.routers-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 300px;
  overflow-y: auto;
}

.router-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.router-item:hover {
  background: var(--surface-hover);
  border-color: var(--primary-color);
}

.router-selected {
  background: var(--primary-color-light);
  border-color: var(--primary-color);
}

.router-current {
  border-color: var(--green-500);
  background: var(--green-50);
}

.router-info {
  flex: 1;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.router-name {
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 0.25rem;
}

.router-hwid {
  font-size: 0.8rem;
  color: var(--text-color-secondary);
}

.router-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
  flex-shrink: 0;
}

.online-indicator {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: var(--green-600);
}

.online-dot {
  font-size: 0.5rem;
}

.current-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: var(--green-500);
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-size: 0.7rem;
  font-weight: 500;
}

.connection-tips {
  margin-top: 1rem;
}

.tips-list {
  margin: 0.5rem 0 0 1rem;
  padding: 0;
}

.tips-list li {
  margin-bottom: 0.25rem;
  font-size: 0.9rem;
  color: var(--text-color-secondary);
}

/* FAQ */
.faq-modal-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 60vh;
}

.faq-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  width: 100%;
}

.language-switcher {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.search-container {
  position: relative;
  flex: 1;
  max-width: 250px;
}

.search-container .pi-search {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-color-secondary);
  z-index: 1;
}

.search-input {
  width: 100%;
  padding-left: 2.5rem !important;
}

.faq-list {
  flex: 1;
  overflow-y: auto;
}

.answer-text {
  white-space: pre-line;
  line-height: 1.5;
}

.additional-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--surface-ground);
  border-radius: 6px;
  font-size: 0.9rem;
  color: var(--text-color-secondary);
}

.empty-faq {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--text-color-secondary);
  text-align: center;
}

/* Footer */
.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.connection-actions {
  display: flex;
  gap: 0.5rem;
}

.disconnect-btn {
  border-color: var(--red-500);
  color: var(--red-500);
}

.disconnect-btn:hover {
  background: var(--red-500);
  color: white;
}

.connect-btn {
  min-width: 120px;
}

.info-message {
  margin-top: 1rem;
}

/* Scrollbar */
.routers-list::-webkit-scrollbar,
.options-grid::-webkit-scrollbar,
.faq-list::-webkit-scrollbar {
  width: 4px;
}

.routers-list::-webkit-scrollbar-track,
.options-grid::-webkit-scrollbar-track,
.faq-list::-webkit-scrollbar-track {
  background: var(--surface-ground);
}

.routers-list::-webkit-scrollbar-thumb,
.options-grid::-webkit-scrollbar-thumb,
.faq-list::-webkit-scrollbar-thumb {
  background: var(--surface-300);
  border-radius: 2px;
}

/* Responsive */
@media (max-width: 768px) {
  .modal-content {
    padding: 0.25rem 0;
  }

  .horizontal-password-options {
    flex-direction: column;
    gap: 0.5rem;
  }

  .router-item {
    padding: 0.75rem;
  }

  .router-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .faq-controls {
    flex-direction: column;
    gap: 0.75rem;
  }

  .search-container {
    max-width: 100%;
    width: 100%;
  }

  .modal-footer {
    flex-direction: column;
    gap: 0.75rem;
  }

  .connection-actions {
    width: 100%;
  }

  .connection-actions .p-button {
    flex: 1;
  }
}
</style>