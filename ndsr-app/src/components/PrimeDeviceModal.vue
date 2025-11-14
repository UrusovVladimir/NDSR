<template>
  <Dialog 
    v-model:visible="visible" 
    :modal="true" 
    :header="modalTitle"
    :style="{ width: mobileView ? '95vw' : '550px', maxWidth: '550px' }"
    :breakpoints="{ '960px': '85vw', '641px': '95vw' }"
    :contentStyle="{ padding: mobileView ? '1rem' : '1.5rem' }"
    class="optimized-modal mws-connection-modal"
  >
    <!-- WAN Types Modal -->
    <div v-if="modalType === 'wanTypes'" class="modal-content">
      <div class="options-grid">
        <div 
          v-for="wan in filteredWanTypes" 
          :key="wan.vlanId" 
          class="option-item"
          :class="{ 'option-selected': modalValue === wan.vlanId }"
          @click="modalValue = wan.vlanId"
        >
          <RadioButton 
            v-model="modalValue" 
            :value="wan.vlanId" 
            :inputId="'wan_' + wan.vlanId"
          />
          <label :for="'wan_' + wan.vlanId" class="option-label">{{ wan.type }}</label>
        </div>
      </div>
      
      <Message v-if="showPPPoECredentials" severity="info" class="info-message">
        <div class="message-content">
          <i class="pi pi-info-circle"></i>
          <div>
            <div><strong>PPPoE Credentials</strong></div>
            <div>Login: <strong>support</strong></div>
            <div>Password: <strong>support2019</strong></div>
          </div>
        </div>
      </Message>
      
      <Message v-if="showResetHint" severity="info" class="info-message">
        <div class="message-content">
          <div>
            Select <strong>"Clear WAN type"</strong> to disconnect all WAN connections
          </div>
        </div>
      </Message>
    </div>

    <!-- MWS Connection Modal-->
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

      <div v-if="hasValidPassword && !authError" class="router-password-section mb-4">
        <h6 class="section-title mb-3">Router Authentication:</h6>
        
        <!-- Переключатель между паролем устройства и ручным вводом -->
        <div class="password-toggle-section mb-3">
          <div class="flex align-items-center gap-3">
            <div class="password-option" 
                :class="{ 'active': useDevicePassword }"
                @click="useDevicePassword = true">
              <RadioButton
                v-model="useDevicePassword"
                inputId="useDevicePassword"
                name="passwordSource"
                :value="true"
                class="password-radio"
              />
              <label for="useDevicePassword" class="password-label">
                <div class="flex align-items-center">
                  <i class="pi pi-key mr-2 text-primary"></i>
                  <strong>Use Device Password</strong>
                </div>
                <small class="block text-color-secondary">
                  Use the same password as the device (recommended)
                </small>
              </label>
            </div>

            <div class="password-option" 
                :class="{ 'active': !useDevicePassword }"
                @click="useDevicePassword = false">
              <RadioButton
                v-model="useDevicePassword"
                inputId="useManualPassword"
                name="passwordSource"
                :value="false"
                class="password-radio"
              />
              <label for="useManualPassword" class="password-label">
                <div class="flex align-items-center">
                  <i class="pi pi-pencil mr-2 text-warning"></i>
                  <strong>Enter Manually</strong>
                </div>
                <small class="block text-color-secondary">
                  Use different password for router
                </small>
              </label>
            </div>
          </div>
        </div>

        <!-- Поле для ручного ввода пароля -->
        <div v-if="!useDevicePassword" class="manual-password-section">
          <div class="password-input-container">
            <label class="text-sm font-semibold mb-2 block">Router Password:</label>
            <Password 
              v-model="manualRouterPassword" 
              :feedback="false" 
              placeholder="Enter router password"
              class="w-full router-password-input"
              toggleMask
              :disabled="operationInProgress"
            />
            <small class="text-color-secondary mt-1 block">
              <i class="pi pi-info-circle mr-1"></i>
              Enter the router's admin password if different from device
            </small>
          </div>
        </div>

        <!-- Информация о текущем выборе -->
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
      <div class="connection-options-section">
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
                :disabled="currentConnection?.routerId === router.id"
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
        <div v-if="availableRouters.length === 0" class="no-routers-message">
          <Message severity="info">
            <div class="message-content">
              <div>
                <div><strong>No Routers Available</strong></div>
                <div>No booked routers are currently online</div>
                <small class="text-color-secondary">
                  Book a router first to connect
                </small>
              </div>
            </div>
          </Message>
        </div>
      </div>

      <!-- Информация о подключении -->
      <Message severity="info" class="connection-tips">
        <div class="message-content">
          <i class="pi pi-lightbulb"></i>
          <div>
            <div><strong>Connection Tips</strong></div>
            <ul class="tips-list">
              <li>Both AP and Router must be <strong>online and booked by you</strong></li>
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
            />
            <Button 
              @click="currentLanguage = 'ru'" 
              :label="'RU'"
              size="small"
              :class="{ 'p-button-primary': currentLanguage === 'ru', 'p-button-outlined': currentLanguage !== 'ru' }"
            />
          </div>
          
          <!-- ✅ ИСПРАВЛЕННАЯ СТРУКТУРА ПОИСКА -->
          <span class="p-input-icon-left search-container">
            <i class="pi pi-search" />
            <InputText 
              v-model="faqSearchQuery" 
              :placeholder="currentLanguage === 'en' ? 'Search FAQ...' : 'Поиск...'"
              size="small"
              class="search-input"
            />
          </span>
        </div>

      <div class="faq-list">
        <Accordion :multiple="true">
          <AccordionTab 
            v-for="(item, index) in filteredFaqItems" 
            :key="item.id" 
            :header="item.question"
            class="faq-item"
          >
            <div class="answer-text">{{ item.answer }}</div>
            <div v-if="item.additionalInfo" class="additional-info">
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
          :label="mobileView ? 'Close' : 'Close'" 
          icon="pi pi-times" 
          @click="closeModal" 
          class="p-button-text close-btn"
          size="small"
        />
        
        <template v-if="modalType === 'wanTypes'">
          <Button 
            :label="mobileView ? 'Apply' : 'Apply changes'" 
            icon="pi pi-check" 
            @click="saveChanges" 
            :loading="isLoading"
            class="apply-btn" 
            size="small"
          />
        </template>
        
        <template v-if="modalType === 'mwsConnection'">
          <div class="connection-actions">
            <!-- Кнопка отключения показывается только если есть активное подключение -->
            <Button 
              v-if="currentConnection"
              :label="mobileView ? 'Disconnect' : 'Disconnect'" 
              icon="pi pi-unlink" 
              @click="saveChanges('disconnect')" 
              class="p-button-outlined p-button-danger disconnect-btn"
              :loading="isLoading"
              size="small"
            />
            
            <!-- Кнопка подключения/изменения подключения -->
            <Button 
              :label="getConnectButtonLabel()" 
              icon="pi pi-link" 
              @click="saveChanges('connect')" 
              :loading="isLoading"
              class="connect-btn"
              size="small"
              :disabled="!canConnect"
            />
          </div>
        </template>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
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

const emit = defineEmits(['save'])

const visible = ref(false)
const modalValue = ref(null)
const modalType = ref('')
const isLoading = ref(false)
const showPPPoECredentials = ref(false)
const showResetHint = ref(true)
const faqSearchQuery = ref('')
const currentLanguage = ref('en')
const currentConnection = ref(null)
const connectionLoading = ref(false)

// ✅ ДОБАВЛЕНЫ ПЕРЕМЕННЫЕ ДЛЯ УПРАВЛЕНИЯ ПАРОЛЕМ
const useDevicePassword = ref(true)
const manualRouterPassword = ref('')
const devicePassword = ref('')
const passwordSource = ref('global')
const authError = ref(false)
const operationInProgress = ref(false)

// Локальная копия для безопасности
const currentDevice = ref(null)

// Определение мобильного устройства
const mobileView = computed(() => window.innerWidth <= 768)

// ✅ FAQ данные из старого компонента
const localizedFaqItems = {
  en: [
    {
      id: 1,
      question: "How do I change the WAN type?",
      answer: "1. On your booked device slate, click the 'Wan Type' button and select desired WAN connection type to be used for the device\n2. Open the device web interface and set up selected type of connection in the 'Internet' menu",
      additionalInfo: "PPPoE requires special credentials (provided in the modal)"
    },
    {
      id: 2,
      question: "How to connect extender to router?",
      answer: "1. Book both the router and extender devices\n2. On extender device, click 'MWS Connection' button\n3. Select the router you want to connect to\n4. Click 'Connect' button",
      additionalInfo: "Both devices must be booked by you and online"
    },
    {
      id: 3,
      question: "How to reset device configuration?",
      answer: "1. Book the device you want to reset\n2. Click the 'Reset Configuration' button (circular refresh icon)\n3. Confirm the action in the dialog",
      additionalInfo: "This will restore factory defaults and erase all settings"
    },
    {
      id: 4,
      question: "How to extend booking time?",
      answer: "1. On your booked device, click the '+' button next to the timer\n2. Select additional time from the options or enter custom duration\n3. Confirm the extension",
      additionalInfo: "You can extend booking before it expires"
    },
    {
      id: 5,
      question: "How to change device mode?",
      answer: "1. Book the device you want to reconfigure\n2. Click the 'Change Mode' button (wrench icon)\n3. Select desired mode (Router/Extender)\n4. Confirm the change",
      additionalInfo: "Device will reboot after mode change"
    }
  ],
  ru: [
    {
      id: 1,
      question: "Как изменить тип WAN-подключения?",
      answer: "1. На панели устройства нажмите кнопку 'Wan Type' и укажите тип WAN-подключения, который будет использоваться для устройства\n2. Откройте веб-конфигуратор устройства и настройте выбранный тип подключения в меню 'Интернет'",
      additionalInfo: "PPPoE требует специальных учетных данных (отображаются в модальном окне)"
    },
    {
      id: 2,
      question: "Как подключить экстендер к роутеру?",
      answer: "1. Забронируйте оба устройства (роутер и экстендер)\n2. На экстендере нажмите кнопку 'MWS Connection'\n3. Выберите роутер для подключения\n4. Нажмите кнопку 'Connect'",
      additionalInfo: "Оба устройства должны быть онлайн и забронированы вами"
    },
    {
      id: 3,
      question: "Как сбросить конфигурацию устройства?",
      answer: "1. Забронируйте устройство для сброса\n2. Нажмите кнопку 'Reset Configuration'\n3. Подтвердите действие в диалоговом окне",
      additionalInfo: "Это восстановит заводские настройки и удалит все пользовательские параметры"
    },
    {
      id: 4,
      question: "Как продлить время бронирования?",
      answer: "1. На забронированном устройстве нажмите кнопку '+' рядом с таймером\n2. Выберите дополнительное время из вариантов или введите свое\n3. Подтвердите продление",
      additionalInfo: "Вы можете продлить бронирование до его истечения. Максимальное время продления 1440 минут"
    },
    {
      id: 5,
      question: "Как изменить режим устройства?",
      answer: "1. Забронируйте устройство для переконфигурации\n2. Нажмите кнопку 'Change Mode' (иконка гаечного ключа)\n3. Выберите желаемый режим (Экстендер+Роутер/Экстендер)\n4. Подтвердите изменение",
      additionalInfo: "Устройство перезагрузится после смены режима, для коммутации устройства, и настройки проброса для режима Экстендер/Экстендер+Роутер требуется 2-3 минуты"
    },
    {
      id: 6,
      question: "Можно ли менять локальный адрес устройства с дефолтного 192.168.1.1 на любой другой?",
      answer: "Да, изменить можно, для применения настроек потребуется примерно 1-2 минуты",
      additionalInfo: "Все устройства к свичу доступа подключены 1 портом, изменять его или настраивать в режиме Trunk на кинетике НЕЛЬЗЯ! Потеряете доступ сразуже!"
    },
    {
      id: 7,
      question: "Можно ли использовать свой пароль на устройтсве?",
      answer: "Да, но некоторые функции не будут работать. Например не будет отображаться версия ПО на портале.",
      additionalInfo: "При подключении эктендеров с вашим паролем нужно выбирать режим 'Enter Manually'"
    }
  ]
}

// ✅ ДОБАВЛЕН computed ДЛЯ ПАРОЛЯ
const hasValidPassword = computed(() => {
  return devicePassword.value && 
        devicePassword.value.trim() !== '' && 
        devicePassword.value !== 'Loading...'
})

// ✅ ДОБАВЛЕН computed ДЛЯ ПОЛУЧЕНИЯ ПАРОЛЯ РОУТЕРА
const routerPasswordToUse = computed(() => {
  if (useDevicePassword.value) {
    return devicePassword.value
  } else {
    return manualRouterPassword.value
  }
})

// Computed properties
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

const availableRouters = computed(() => {
  if (modalType.value !== 'mwsConnection') return []
  
  return props.filteredDevices.filter(dev => 
    dev.id && 
    dev.hwId && 
    dev.shortName &&
    dev.type === 'router' &&
    dev.statusCode === 200 &&
    dev.id !== currentDevice.value?.id &&
    // ✅ ФИЛЬТРАЦИЯ ПО БРОНИРОВАНИЮ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
    dev.booking?.isBooked && 
    dev.booking?.bookedBy === deviceStore.currentUserId
  )
})

// ✅ FAQ computed из старого компонента
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

// ✅ ДОБАВЛЕНЫ ОТСУТСТВУЮЩИЕ ФУНКЦИИ
const fetchCurrentConnection = async (deviceId) => {
  if (!deviceId) {
    // console.warn('⚠️ No device ID provided for fetching connection');
    currentConnection.value = null;
    return;
  }
  
  connectionLoading.value = true;
  try {
    // console.log('🔗 Fetching MWS connection for device:', deviceId);
    
    const device = deviceStore.devices.find(d => d.id === deviceId);
    
    if (!device) {
      // console.warn('⚠️ Device not found:', deviceId);
      currentConnection.value = null;
      return;
    }

    // ✅ ПРЯМАЯ ПРОВЕРКА ДАННЫХ ИЗ STORE
    const modeInfo = modeStore.getDeviceModeInfo(deviceId);
    // console.log('🔍 Mode info from store:', modeInfo);
    
    // ✅ ЕСЛИ ЕСТЬ ДАННЫЕ О ПОДКЛЮЧЕНИИ - ОТОБРАЖАЕМ ИХ
    if (modeInfo && modeInfo.mode === 'extender_connect' && modeInfo.routerId) {
      const router = deviceStore.devices.find(d => d.id === modeInfo.routerId);
      if (router) {
        currentConnection.value = {
          routerId: modeInfo.routerId,
          routerName: `${router.hwId} ${router.shortName}`,
          status: 'connected',
          connectedSince: modeInfo.timestamp || Date.now(),
          modeConnect: 'Wired'
        };
        // console.log('✅ Active connection found:', currentConnection.value);
        return;
      } else {
        console.warn('⚠️ Router not found for connection:', modeInfo.routerId);
      }
    }

    // ✅ ДЛЯ AP УСТРОЙСТВ - ПРОВЕРЯЕМ РЕАЛЬНЫЙ РЕЖИМ
    if (device && device.type === 'AP' && device.hWtype === 'true') {
      // console.log(`🔧 AP устройство ${deviceId}, проверяем реальный режим...`);
      await fetchAPDeviceConnection(deviceId, device);
    } else {
      currentConnection.value = null;
      // console.log('🔗 No active connection found');
    }
    
  } catch (error) {
    console.error('❌ Failed to fetch current connection:', error);
    currentConnection.value = null;
  } finally {
    connectionLoading.value = false;
  }
};

const fetchAPDeviceConnection = async (deviceId, device) => {
  try {
    // console.log(`🔧 Checking real AP device connection for ${deviceId}`);
    
    // ✅ ПРЯМОЙ ЗАПРОС К СЕРВЕРУ ДЛЯ ПОЛУЧЕНИЯ АКТУАЛЬНЫХ ДАННЫХ
    const connectionResponse = await new Promise((resolve) => {
      socket.emit('device:getMwsConnection', deviceId, (response) => {
        resolve(response);
      });
      
      setTimeout(() => resolve({ success: false, connection: null }), 5000);
    });
    
    if (connectionResponse?.success && connectionResponse.connection) {
      currentConnection.value = {
        routerId: connectionResponse.connection.routerId,
        routerName: connectionResponse.connection.routerName,
        status: connectionResponse.connection.status,
        connectedSince: connectionResponse.connection.connectedSince,
        modeConnect: 'Wired'
      };
      // console.log('✅ AP device connection found via server:', currentConnection.value);
    } else {
      currentConnection.value = null;
      // console.log('🔗 No active connection found for AP device');
    }
    
  } catch (error) {
    console.error('❌ Error fetching AP device connection:', error);
    currentConnection.value = null;
  }
};

// ✅ ДОБАВЛЕНА ФУНКЦИЯ getConnectButtonLabel
const getConnectButtonLabel = () => {
  if (currentConnection.value && modalValue.value === currentConnection.value.routerId) {
    return mobileView.value ? 'Reconnect' : 'Reconnect'
  }
  return mobileView.value ? 'Connect' : 'Connect to Router'
}

// ✅ ДОБАВЛЕНА ФУНКЦИЯ getConnectionSeverity
const getConnectionSeverity = (status) => {
  const severityMap = {
    connected: 'success',
    connecting: 'warning',
    disconnected: 'danger',
    error: 'danger'
  }
  return severityMap[status] || 'info'
}

// ✅ ДОБАВЛЕНА ФУНКЦИЯ formatConnectionTime
const formatConnectionTime = (timestamp) => {
  if (!timestamp) return 'Unknown'
  return new Date(timestamp).toLocaleString()
}

// ✅ ОБНОВЛЕННЫЙ метод show для получения пароля
const show = async (type, password = '', source = 'global') => {
  modalType.value = type
  faqSearchQuery.value = ''
  visible.value = true
  currentDevice.value = props.device
  
  // ✅ СОХРАНЯЕМ ПАРОЛЬ
  devicePassword.value = password
  passwordSource.value = source
  useDevicePassword.value = true
  manualRouterPassword.value = ''
  authError.value = false
  
  // console.log('🔑 MWS Modal opened with password:', {
  //   type: type,
  //   device: props.device?.hwId,
  //   hasPassword: !!password,
  //   source: source
  // })
  
  if (type === 'mwsConnection' && props.device) {
    if (!props.device.id) {
      console.error('❌ No device ID provided for MWS connection')
      return
    }
    
    await fetchCurrentConnection(props.device.id)
    
    // Если есть текущее подключение, выбираем его по умолчанию
    if (currentConnection.value) {
      modalValue.value = currentConnection.value.routerId
      // console.log('🔗 Default selection: current connection router', modalValue.value)
    } else if (availableRouters.value.length > 0) {
      // Иначе выбираем первый доступный роутер
      modalValue.value = availableRouters.value[0].id
      // console.log('🔗 Default selection: first available router', modalValue.value)
    } else {
      modalValue.value = null
      // console.log('🔗 No default selection - no routers available')
    }
  }
}

const selectRouter = (routerId) => {
  modalValue.value = routerId
}

  const saveChanges = async (action) => {
    isLoading.value = true
    try {
      // ✅ ПРОВЕРКА ЧТО УСТРОЙСТВО ВСЕ ЕЩЕ ДОСТУПНО
      if (!currentDevice.value || !currentDevice.value.id) {
        throw new Error('Device information is no longer available')
      }

      let valueToSend = modalValue.value
      let actionType = action

      if (modalType.value === 'mwsConnection') {
        if (action === 'disconnect') {
          if (!currentConnection.value) {
            throw new Error('No active connection to disconnect from')
          }
          
          valueToSend = currentConnection.value.routerId
          actionType = 'disconnect'
          
          // console.log("🔗 DISCONNECT from current connection:", {
          //   device: currentDevice.value?.hwId,
          //   router: currentConnection.value.routerName,
          //   routerId: valueToSend
          // })
        } else {
          valueToSend = modalValue.value
          actionType = currentConnection.value ? 'reconnect' : 'connect'
          
          // console.log("🔗 CONNECT to selected router:", {
          //   device: currentDevice.value?.hwId, 
          //   selectedRouter: modalValue.value,
          //   useDevicePassword: useDevicePassword.value,
          //   hasManualPassword: !!manualRouterPassword.value
          // })
        }
      }

      // ✅ ПЕРЕДАЕМ ДАННЫЕ О ПАРОЛЕ И ПОЛУЧАЕМ СООБЩЕНИЕ
      const customMessage = await new Promise((resolve, reject) => {
        // ✅ ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА ПЕРЕД ОТПРАВКОЙ
        if (!currentDevice.value || !currentDevice.value.id) {
          reject(new Error('Device data lost during operation'))
          return
        }

        emit('save', {
          value: valueToSend,
          type: modalType.value,
          action: actionType,
          routerPassword: routerPasswordToUse.value,
          useDevicePassword: useDevicePassword.value,
          callback: (success, message) => {
            if (success) {
              resolve(message)
            } else {
              reject(new Error(message))
            }
          }
        })
      })

      // ✅ ТОЛЬКО ОДИН TOAST С КАСТОМНЫМ СООБЩЕНИЕМ
      const successMessage = customMessage || getSuccessMessage(actionType)
      
      toast.add({
        severity: 'success',
        summary: 'Success', 
        detail: successMessage,
        life: 3000
      })

      // ✅ ПРОВЕРКА ПЕРЕД ОБНОВЛЕНИЕМ СТАТУСА
      if (modalType.value === 'mwsConnection' && currentDevice.value?.id) {
        // console.log('🔄 Targeted status check for extender after MWS operation...')
        
        // ✅ ЗАЩИЩЕННЫЙ ВЫЗОВ С ПРОВЕРКОЙ
        const deviceId = currentDevice.value.id
        const deviceHwId = currentDevice.value.hwId
        
        socket.emit('device:forceStatusCheck', deviceId, (response) => {
          if (response?.success) {
            // console.log(`✅ Extender ${deviceHwId} status: ${response.status}`)
          } else {
            // console.log(`⚠️ Failed to check extender status: ${response?.error}`)
          }
        })
        
        // ✅ ОТЛОЖЕННОЕ ОБНОВЛЕНИЕ С ПРОВЕРКОЙ
        setTimeout(() => {
          if (currentDevice.value && currentDevice.value.id === deviceId) {
            fetchCurrentConnection(deviceId)
          }
        }, 2000)
      }
      
      closeModal()
      
    } catch (error) {
      console.error('❌ Save changes error:', error)
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: `Failed to apply changes: ${error.message}`,
        life: 5000
      })
    } finally {
      isLoading.value = false
    }
  }

// ✅ ОБНОВЛЕННЫЙ метод getSuccessMessage с проверками
const getSuccessMessage = (action) => {
  const deviceName = currentDevice.value?.shortName || currentDevice.value?.hwId || 'device'
  
  const messages = {
    connect: `Successfully connected ${deviceName} to router`,
    disconnect: `Successfully disconnected ${deviceName}`,
    reconnect: `Connection updated for ${deviceName}`,
    default: `Changes applied for ${deviceName} successfully`
  }
  return messages[action] || messages.default
}

// ✅ ОБНОВЛЕННЫЙ метод closeModal с полной очисткой
const closeModal = () => {
  // ✅ СОХРАНЯЕМ ДАННЫЕ ДЛЯ АСИНХРОННЫХ ОПЕРАЦИЙ
  const deviceId = currentDevice.value?.id
  const deviceHwId = currentDevice.value?.hwId
  
  // ✅ ОЧИСТКА ДАННЫХ
  modalValue.value = null
  modalType.value = '' 
  currentDevice.value = null
  currentConnection.value = null
  visible.value = false
  isLoading.value = false
  faqSearchQuery.value = ''
  
  // ✅ СБРАСЫВАЕМ ПАРОЛИ ПРИ ЗАКРЫТИИ
  devicePassword.value = ''
  manualRouterPassword.value = ''
  useDevicePassword.value = true
  authError.value = false
  
  // console.log('🔒 Modal closed, device data cleared:', { deviceId, deviceHwId })
}

// Watchers
watch(modalValue, (newVal) => {
  showPPPoECredentials.value = newVal === '747'
  showResetHint.value = newVal === null
})

defineExpose({ show })
</script>

<style scoped>
/* ✅ СОВМЕЩЕННЫЕ СТИЛИ ИЗ ОБОИХ КОМПОНЕНТОВ */

.optimized-modal {
  max-height: 90vh;
}

.modal-content {
  padding: 0.5rem 0;
}

.mws-connection-modal .modal-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Стили для секции пароля */
.router-password-section {
  background: var(--surface-50);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--surface-200);
  margin-bottom: 1rem;
}

.password-toggle-section {
  margin-bottom: 1rem;
}

.password-option {
  display: flex;
  align-items: flex-start;
  padding: 0.75rem;
  border: 2px solid var(--surface-300);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  flex: 1;
}

.password-option:hover {
  border-color: var(--primary-300);
  background-color: var(--surface-50);
}

.password-option.active {
  border-color: var(--primary-500);
  background-color: var(--primary-50);
}

.password-radio {
  margin-right: 12px;
  margin-top: 2px;
}

.password-label {
  cursor: pointer;
  flex: 1;
  margin: 0;
}

.manual-password-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--surface-200);
}

.password-input-container {
  position: relative;
}

.info-message {
  border-left: 4px solid #28a745;
}

.router-password-input .p-password input {
  border-radius: 6px !important;
  border: 1px solid #ced4da !important;
  width: 100% !important;
}

.router-password-input .p-password:focus-within input {
  border-color: #28a745 !important;
  box-shadow: 0 0 0 0.2rem rgba(40, 167, 69, 0.25) !important;
}

/* Стили для MWS подключения */
.current-connection-section,
.no-connection-section {
  margin-bottom: 0.5rem;
}

.connection-info .message-content {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.connection-details {
  flex: 1;
}

.connection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.status-badge {
  font-size: 0.7rem;
}

.connection-info-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  font-size: 0.9rem;
}

.info-label {
  color: var(--text-color-secondary);
  min-width: 100px;
}

.signal-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.connection-options-section {
  border-top: 1px solid var(--surface-border);
  padding-top: 1rem;
}

.section-title {
  margin: 0 0 1rem 0;
  color: var(--text-color);
  font-weight: 600;
  display: flex;
  align-items: center;
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
  -webkit-tap-highlight-color: transparent;
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

.router-selection {
  flex-shrink: 0;
}

.router-info {
  flex: 1;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.router-main-info {
  flex: 1;
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

.no-routers-message {
  margin-top: 1rem;
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

/* WAN Types Styles */
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
  -webkit-tap-highlight-color: transparent;
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

.info-message {
  margin-top: 1rem;
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

/* FAQ Styles */
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

/* ✅ ИСПРАВЛЕННЫЕ СТИЛИ ДЛЯ ПОИСКА */
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
  padding-left: 2.5rem !important; /* Место для иконки */
}

.search-input:focus {
  border-color: var(--primary-color) !important;
  box-shadow: 0 0 0 0.1rem var(--primary-color) !important;
}

.faq-list {
  flex: 1;
  overflow-y: auto;
}

/* ✅ МОБИЛЬНАЯ АДАПТАЦИЯ */
@media (max-width: 768px) {
  .faq-controls {
    flex-direction: column;
    gap: 0.75rem;
  }

  .language-switcher {
    justify-content: center;
    width: 100%;
  }

  .search-container {
    max-width: 100%;
    width: 100%;
  }
}

/* ✅ ДЕСКТОПНАЯ АДАПТАЦИЯ */
@media (min-width: 769px) {
  .faq-controls {
    flex-direction: row;
  }
  
  .search-container {
    max-width: 200px;
  }
}

.answer-text {
  white-space: pre-line;
  line-height: 1.5;
}

.additional-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.75rem;
  background: var(--surface-ground);
  border-radius: 6px;
  font-size: 0.9rem;
  color: var(--text-color-secondary);
}

.additional-info i {
  color: var(--primary-color);
  flex-shrink: 0;
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

/* Footer Styles */
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

.close-btn {
  min-width: auto;
}

.apply-btn {
  min-width: 100px;
}

/* Mobile Optimizations */
@media (max-width: 768px) {
  .mws-connection-modal .modal-content {
    gap: 1rem;
  }

  .connection-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .router-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .router-status {
    flex-direction: row;
    align-items: center;
    width: 100%;
    justify-content: space-between;
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

  .router-item {
    padding: 0.75rem;
  }

  .faq-controls {
    flex-direction: column;
    gap: 0.75rem;
  }

  .language-switcher {
    justify-content: center;
  }

  .router-password-section {
    padding: 0.75rem;
    margin-bottom: 1rem;
  }
  
  .password-toggle-section .flex.align-items-center {
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .password-option {
    width: 100%;
  }
}

/* Desktop Optimizations */
@media (min-width: 769px) {
  .faq-controls {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }

  .search-container {
    width: 200px;
  }
}

/* Scrollbar Styling */
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

.routers-list::-webkit-scrollbar-thumb:hover,
.options-grid::-webkit-scrollbar-thumb:hover,
.faq-list::-webkit-scrollbar-thumb:hover {
  background: var(--surface-400);
}
</style>