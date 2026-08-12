<template>
  <Dialog 
    :blockScroll="false"
    v-model:visible="visible" 
    :modal="true" 
    :header="modalTitle"
    :style="getModalStyle"
    :breakpoints="{ '960px': '85vw', '641px': '95vw' }"
    :contentStyle="{ padding: mobileView ? '1rem' : '1.5rem' }"
    :closable="!isLoading && !operationInProgress && !showDualWanConfirm"
    :closeOnEscape="!isLoading && !operationInProgress && !showDualWanConfirm"
    :dismissableMask="!isLoading && !operationInProgress && !showDualWanConfirm"
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
      <!-- Основной выбор WAN типа -->
      <div class="options-grid" :class="{ 'opacity-50 pointer-events-none': isWanOperationInProgress }">
        <div 
          v-for="wan in filteredWanTypes" 
          :key="wan.vlanId || wan.type" 
          class="option-item"
          :class="{ 
            'option-selected': modalValue === (wan.vlanId || wan._id),
            'option-dual-wan-selected': wan.type === 'Dual WAN' && isDualWanSelected
          }"
          @click="!isWanOperationInProgress && selectWanType(wan)"
        >
          <RadioButton 
            v-model="modalValue" 
            :value="wan.vlanId || wan._id" 
            :inputId="'wan_' + (wan.vlanId || wan._id)"
            :disabled="isLoading || operationInProgress"
          />
          <label :for="'wan_' + (wan.vlanId || wan._id)" class="option-label">{{ wan.type }}</label>
        </div>
      </div>
      
      <!-- Dual WAN Configuration -->
      <div v-if="isDualWanSelected" class="dual-wan-configuration mt-4">
        <Divider />
        <h5 class="section-title">Dual WAN Configuration</h5>
        
        <!-- WAN 1 -->
        <div class="wan-config-section">
          <div class="wan-config-header">
            <i class="pi pi-network mr-2 text-primary"></i>
            <strong>WAN 1</strong>
            <Tag value="Primary (Port 0)" severity="info" size="small" />
          </div>
          <div class="wan-select m-1">
            <Dropdown
              v-model="dualWanConfig.wan1"
              :options="wan1Options"
              optionLabel="type"
              optionValue="vlanId"
              placeholder="Select WAN 1 type"
              class="w-full"
              :disabled="isLoading || operationInProgress"
              :loading="isLoading"
            />
          </div>
        </div>
        
        <!-- WAN 2 -->
        <div class="wan-config-section">
          <div class="wan-config-header">
            <i class="pi pi-network mr-2 text-warning"></i>
            <strong>WAN 2</strong>
            <Tag value="Secondary (Port 1)" severity="warning" size="small" />
          </div>
          <div class="wan-select m-1">
            <Dropdown
              v-model="dualWanConfig.wan2"
              :options="wan2Options"
              optionLabel="type"
              optionValue="vlanId"
              placeholder="Select WAN 2 type"
              class="w-full"
              :disabled="isLoading || operationInProgress"
              :loading="isLoading"
            />
          </div>
        </div>
        
        <Message severity="info" class="dual-wan-info mt-2">
          <div class="message-content">
            <div>
              <div><strong>Dual WAN Configuration</strong></div>
              <div>Select WAN types for primary and secondary connections</div>
              <small class="text-color-secondary">Both WAN connections will be active simultaneously.</small>
            </div>
          </div>
        </Message>
      </div>
      
      <!-- PPPoE Credentials -->
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
      
      <!-- Reset Hint -->
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
        
        <div class="password-toggle-section mb-3">
          <div class="horizontal-password-options">
            <!-- Первая опция -->
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

            <!-- Вторая опция -->
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

        <!-- Поле для ручного ввода пароля -->
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
          :disabled="isLoading || operationInProgress"
        />
        
        <template v-if="modalType === 'wanTypes'">
          <Button 
            :label="mobileView ? 'Apply' : 'Apply changes'" 
            icon="pi pi-check" 
            @click="handleApplyClick" 
            :loading="isLoading"
            class="apply-btn" 
            size="small"
            :disabled="operationInProgress || !modalValue"
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
              :loading="isLoading && operationType === 'disconnect'"
              :disabled="isLoading || operationInProgress"
              size="small"
            />
            
            <!-- Кнопка подключения/изменения подключения -->
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

  <!-- Диалог подтверждения для Dual WAN -->
  <Dialog 
  v-model:visible="showDualWanConfirm" 
  modal 
  :blockScroll="false"
  :header="isDualWanSelected ? '⚠️ Dual WAN Configuration Warning' : '⚠️ IPoE Public Configuration Warning'"
  :style="{ width: '600px', maxWidth: '90vw' }"
  :closable="false"
  class="dual-wan-confirm-dialog"
>
  <div class="confirmation-content">
    <i class="pi pi-exclamation-triangle" style="font-size: 2rem; color: #f39c12; margin-right: 1rem;" />
    <div>
      <h4 class="mb-2">
        {{ isDualWanSelected ? 'Important: Configure Secondary WAN Interface' : 'Important: Configure WAN Interface with Static IP' }}
      </h4>
      <p class="text-color-secondary mb-2">
        {{ isDualWanSelected 
          ? 'Before applying Dual WAN configuration, you need to configure the second WAN interface on the router.'
          : 'Before applying IPoE Public configuration, you need to configure the WAN interface with static IP settings.' }}
      </p>
        <div class="dual-wan-warning-info p-3 surface-ground border-round">
          <div class="flex align-items-center gap-2 mb-2">
            <i class="pi pi-info-circle text-primary"></i>
            <strong>What you need to do:</strong>
          </div>
          <ol class="warning-list mt-1 mb-0">
            <li>Open the router's web interface</li>
            <li>Go to <strong>Internet → Ethernet Cable</strong> section</li>
                <template v-if="isDualWanWithPublicIP">
                    <li>Configure the second WAN interface with the static settings:</li>
                </template>
                <template v-else>
                    <li>Configure the second WAN interface</li>
                </template>
          </ol>
          
          <!-- Сетевые настройки с кнопками копирования -->
          <div v-if="shouldShowIPSettings" class="dual-wan-settings mt-2">
            <div class="setting-row">
              <span class="setting-label">IP address:</span>
              <div class="setting-value-group">
                <span class="setting-value">212.100.156.75</span>
                <Button 
                  icon="pi pi-copy" 
                  class="p-button-sm p-button-text p-button-rounded copy-btn-small"
                  v-tooltip.top="'Copy IP address'"
                  @click="copyToClipboard('212.100.156.75', 'IP address')"
                />
              </div>
            </div>
            <div class="setting-row">
              <span class="setting-label">MASK:</span>
              <div class="setting-value-group">
                <span class="setting-value">255.255.255.248</span>
                <Button 
                  icon="pi pi-copy" 
                  class="p-button-sm p-button-text p-button-rounded copy-btn-small"
                  v-tooltip.top="'Copy MASK'"
                  @click="copyToClipboard('255.255.255.248', 'MASK')"
                />
              </div>
            </div>
            <div class="setting-row">
              <span class="setting-label">GW:</span>
              <div class="setting-value-group">
                <span class="setting-value">212.100.156.73</span>
                <Button 
                  icon="pi pi-copy" 
                  class="p-button-sm p-button-text p-button-rounded copy-btn-small"
                  v-tooltip.top="'Copy GW'"
                  @click="copyToClipboard('212.100.156.73', 'GW')"
                />
              </div>
            </div>
            <div class="setting-row">
              <span class="setting-label">DNS:</span>
              <div class="setting-value-group">
                <span class="setting-value">87.245.145.6, 87.245.190.122</span>
                <Button 
                  icon="pi pi-copy" 
                  class="p-button-sm p-button-text p-button-rounded copy-btn-small"
                  v-tooltip.top="'Copy DNS'"
                  @click="copyToClipboard('87.245.145.6, 87.245.190.122', 'DNS')"
                />
              </div>
            </div>
            <div class="setting-row copy-all-row">
              <Button 
                icon="pi pi-copy" 
                label="Copy All Settings"
                class="p-button-sm p-button-text p-button-primary"
                @click="copyAllSettings"
              />
            </div>
          </div>
          
          <ol class="warning-list mt-2 mb-0" start="4">
            <li>Save the configuration</li>
            <li>Then apply this Dual WAN configuration</li>
          </ol>
        </div>
        
        <!-- Кнопки действий (центрированные, в ряд) -->
        <div class="mt-3 flex justify-content-center gap-2 flex-wrap">
          <Button 
            label="Open Router Interface" 
            icon="bi bi-layout-sidebar"
            class="p-button-sm p-button-outlined p-button-primary"
            @click="openRouterInterface"
          />
          <Button 
            label="Skip Wizard - set password" 
            icon="bi bi-magic"
            class="p-button-sm p-button-outlined p-button-warning"
            @click="handleInitializationFromConfirm"
          />
        </div>
        
        <p class="text-color-secondary mt-2 mb-0 text-sm text-center">
          <i class="pi pi-exclamation-circle text-warning mr-1"></i>
          If you don't configure the second WAN interface first, the connection may not work properly.
        </p>
      </div>
    </div>
    <template #footer>
      <Button 
        label="Cancel" 
        icon="pi pi-times" 
        class="p-button-text" 
        @click="showDualWanConfirm = false"
      />
      <Button 
        label="Apply Anyway" 
        icon="pi pi-check" 
        class="p-button-warning" 
        @click="confirmDualWanApply"
        :loading="isLoading"
      />
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
import Dropdown from 'primevue/dropdown'
import Divider from 'primevue/divider'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useModeStore } from '@/stores/useModeStore'
import { useDeviceActionsStore } from '@/stores/useDeviceActionsStore'

const toast = useToast()
const deviceStore = useDeviceStore()
const modeStore = useModeStore()
const deviceActionsStore = useDeviceActionsStore()

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
  currentWanType: {
    type: [String, Object],
    default: null
  },
})

const emit = defineEmits(['save', 'operationStarted', 'operationProgress'])


// Проверяем, выбран ли IPoE Public напрямую (не через Dual WAN)
const isPublicIPSelected = computed(() => {
  // Проверяем прямой выбор IPoE Public
  return modalValue.value === '67' || modalValue.value === 'public_ip'
})

// Проверяем, является ли Dual WAN с Public IP
const isDualWanWithPublicIP = computed(() => {
  if (!isDualWanSelected.value) return false
  
  // Находим типы WAN по vlanId
  const wan1Type = availableWanTypesForDual.value.find(w => w.vlanId === dualWanConfig.value.wan1)
  const wan2Type = availableWanTypesForDual.value.find(w => w.vlanId === dualWanConfig.value.wan2)
  
  // Проверяем, является ли один из выбранных типов "IPoE Public" (vlanId = "67")
  return wan1Type?.type === 'IPoE Public' || wan2Type?.type === 'IPoE Public'
})


// Общий computed: нужно ли показывать настройки IP
const shouldShowIPSettings = computed(() => {
  return isPublicIPSelected.value || isDualWanWithPublicIP.value
})

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

// Состояние для диалога подтверждения Dual WAN
const showDualWanConfirm = ref(false)
const pendingDualWanConfig = ref(null)

// Состояния для прогресс-модалки (нужны для слушателей)
const progress = ref(0)
const currentStepId = ref('')
const operationLog = ref([])

// Состояния для управления паролем
const useDevicePassword = ref(true)
const manualRouterPassword = ref('')
const devicePassword = ref('')
const passwordSource = ref('global')
const authError = ref(false)

// Dual WAN состояния
const dualWanConfig = ref({
  wan1: null,
  wan2: null
})

// Флаг для отслеживания, было ли изменено состояние вручную
const isManualSelection = ref(false)

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

const saveDevicePassword = (password) => {
    return new Promise((resolve, reject) => {
        socket.emit('device:setPassword', {
            deviceId: currentDevice.value.id,
            password: password
        }, (response) => {
            if (response?.success) {
                resolve(response);
            } else {
                reject(new Error(response?.error || 'Failed to save password'));
            }
        });
    });
};

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
    return props.wanTypes.filter(wan => {
      // Для Dual WAN пропускаем всегда (даже если нет vlanId)
      if (wan.type === 'Dual WAN') return true
      // Для остальных проверяем vlanId
      return wan.vlanId !== undefined && 
             wan.vlanId !== null && 
             wan.type?.trim() !== ""
    }).map(wan => {
      // Для Dual WAN добавляем специальный идентификатор
      if (wan.type === 'Dual WAN') {
        return {
          ...wan,
          _id: 'dual_wan_special'  // Специальный ID для RadioButton
        }
      }
      else if (wan.type === 'IPoE Public') {
        return {
          ...wan,
          _id: 'public_ip'
        }
      }
      return wan
    })
  }
  return []
})

const availableRouters = computed(() => {
  if (modalType.value !== 'mwsConnection') return []
  
  return deviceStore.devices.filter(dev => 
    dev.type === 'router' &&
    dev.statusCode === 200 &&
    dev.id !== currentDevice.value?.id &&
    dev.booking?.isBooked && 
    dev.booking?.bookedBy === deviceStore.currentUserId
  )
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

// Computed для Dual WAN
const isDualWanSelected = computed(() => {
  // Проверяем, что значение соответствует специальному ID или является объектом
  return modalValue.value === 'dual_wan_special' || 
         (modalValue.value && typeof modalValue.value === 'object' && modalValue.value.type === 'dual_wan')
})


const availableWanTypesForDual = computed(() => {
  // Все типы WAN кроме Dual WAN
  return props.wanTypes.filter(wan => 
    wan.type !== 'Dual WAN' && 
    wan.vlanId !== undefined && 
    wan.vlanId !== null && 
    wan.type?.trim() !== ""
  )
})

// Опции для WAN 1 (исключаем выбранный в WAN 2)
const wan1Options = computed(() => {
  return availableWanTypesForDual.value.filter(wan => 
    wan.vlanId !== dualWanConfig.value.wan2
  )
})

// Опции для WAN 2 (исключаем выбранный в WAN 1)
const wan2Options = computed(() => {
  return availableWanTypesForDual.value.filter(wan => 
    wan.vlanId !== dualWanConfig.value.wan1
  )
})

// Методы
const addLog = (type, message) => {
  operationLog.value.unshift({
    type,
    message,
    time: new Date().toLocaleTimeString()
  })
  
  if (operationLog.value.length > 20) {
    operationLog.value = operationLog.value.slice(0, 20)
  }
}

const setStepError = (stepId, errorMessage) => {
  console.error(`❌ Step error [${stepId}]:`, errorMessage)
  addLog('error', errorMessage)
}

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

const setupModeChangeListeners = () => {
  socket.off('device:modeUpdated')
  socket.off('device:operationError')
  
  socket.on('device:modeUpdated', (data) => {
    if (data.deviceId === props.device?.id && data.source === 'mode_change') {
      if (data.success) {
        addLog('success', `Mode changed successfully to ${data.mode}`)
        emit('operationProgress', {
          deviceId: data.deviceId,
          progress: 100,
          step: 'completed',
          message: 'Operation completed successfully'
        })
      } else {
        setStepError(currentStepId.value, data.message || 'Operation failed')
        emit('operationProgress', {
          deviceId: data.deviceId,
          progress: 0,
          step: 'error',
          message: data.message || 'Operation failed'
        })
      }
    }
  })
  
  socket.on('device:operationError', (data) => {
    if (data.deviceId === props.device?.id) {
      setStepError(currentStepId.value, data.error)
      emit('operationProgress', {
        deviceId: data.deviceId,
        progress: 0,
        step: 'error',
        message: data.error
      })
    }
  })
}

const cleanupOperation = () => {
  if (operationTimeout.value) {
    clearTimeout(operationTimeout.value)
    operationTimeout.value = null
  }
  
  socket.off('device:modeUpdated')
  socket.off('device:operationError')
  socket.off('device:mwsOperationProgress')
  socket.off('device:modeChangeProgress')
}

const getConnectButtonLabel = () => {
  if (currentConnection.value && modalValue.value === currentConnection.value.routerId) {
    return mobileView.value ? 'Reconnect' : 'Reconnect'
  }
  return mobileView.value ? 'Connect' : 'Connect to Router'
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

const selectWanType = (wan) => {
  if (isWanOperationInProgress.value) return
  
  // Устанавливаем флаг ручного выбора
  isManualSelection.value = true
  
  // Проверяем, является ли это Dual WAN
  const isDualWan = wan.type === 'Dual WAN'
  
  if (isDualWan) {
    // Используем специальный идентификатор для RadioButton
    modalValue.value = wan._id || 'dual_wan_special'
    // Инициализируем конфигурацию с первыми доступными типами
    if (availableWanTypesForDual.value.length >= 2) {
      dualWanConfig.value.wan1 = availableWanTypesForDual.value[0].vlanId
      dualWanConfig.value.wan2 = availableWanTypesForDual.value[1].vlanId
    }
  } else {
    modalValue.value = wan.vlanId
    // Сбрасываем Dual WAN конфигурацию
    dualWanConfig.value = { wan1: null, wan2: null }
  }
  
  // Сбрасываем флаг после обновления
  setTimeout(() => {
    isManualSelection.value = false
  }, 100)
}

const show = async (type, password = '', source = 'global') => {
    modalType.value = type
    faqSearchQuery.value = ''
    visible.value = true
    currentDevice.value = props.device
  
  // ✅ Если пароль не передан, пробуем получить из бронирования устройства
    // ✅ Если пароль не передан, пробуем получить сохраненный
    if (!password && props.device?.id) {
        try {
            const response = await new Promise((resolve) => {
                socket.emit('device:getPassword', props.device.id, (response) => {
                    resolve(response)
                })
                setTimeout(() => resolve({ success: false, password: null }), 5000)
            })
            
            if (response?.success && response.password) {
                password = response.password
                source = 'saved'
            }
        } catch (error) {
            console.error('❌ Failed to load saved password:', error)
        }
    }
    
    // Если все еще нет пароля, пробуем из бронирования
    if (!password && props.device?.booking?.isBooked && 
        props.device?.booking?.bookedBy === deviceStore.currentUserId &&
        props.device?.booking?.accessPassword) {
        password = props.device.booking.accessPassword
        source = 'booking'
    }
    
    devicePassword.value = password
    passwordSource.value = source
    useDevicePassword.value = true
    manualRouterPassword.value = ''
    authError.value = false
  
  isLoading.value = false
  operationInProgress.value = false
  operationType.value = ''
  progressMessage.value = ''
  dualWanConfig.value = { wan1: null, wan2: null }
  isManualSelection.value = false
  showDualWanConfirm.value = false
  pendingDualWanConfig.value = null

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
    // Проверяем текущий тип WAN
    const currentWan = props.currentWanType
    
    // Если это объект Dual WAN
    if (currentWan && typeof currentWan === 'object' && currentWan.type === 'dual_wan') {
      modalValue.value = 'dual_wan_special'
      dualWanConfig.value.wan1 = currentWan.wan1 || null
      dualWanConfig.value.wan2 = currentWan.wan2 || null
      
      // Убедимся, что выбранные значения существуют
      const availableIds = availableWanTypesForDual.value.map(w => w.vlanId)
      if (!availableIds.includes(dualWanConfig.value.wan1) && availableIds.length > 0) {
        dualWanConfig.value.wan1 = availableIds[0]
      }
      if (!availableIds.includes(dualWanConfig.value.wan2) && availableIds.length > 1) {
        dualWanConfig.value.wan2 = availableIds[1]
      }
    } 
    // Если это строка (обычный WAN)
    else if (currentWan && typeof currentWan === 'string') {
      modalValue.value = currentWan === 'ISP not configured' ? null : currentWan
    } 
    else {
      modalValue.value = null
    }
  }
  
  setupModeChangeListeners()
}

const closeModal = () => {
  cleanupOperation()
  
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
  dualWanConfig.value = { wan1: null, wan2: null }
  isManualSelection.value = false
  showDualWanConfirm.value = false
  pendingDualWanConfig.value = null
}

const saveChanges = async (action = 'connect') => {
  try {
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
      // Для AP устройств используем device:mwsConnected
      const saveData = {
        value: modalValue.value,
        type: 'mwsApConnection',  
        action: action,
        routerPassword: routerPasswordToUse.value,
        useDevicePassword: useDevicePassword.value,
        callback: (success, message) => {
          if (success) {
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

// Обработка клика по Apply
const handleApplyClick = () => {
  // Если выбран Dual WAN или IPoE Public - показываем предупреждение
  if (isDualWanSelected.value || isPublicIPSelected.value) {
    // Сохраняем текущую конфигурацию
    pendingDualWanConfig.value = {
      value: modalValue.value,
      wan1: dualWanConfig.value.wan1,
      wan2: dualWanConfig.value.wan2,
      isPublicIP: isPublicIPSelected.value && !isDualWanSelected.value
    }
    showDualWanConfirm.value = true
  } else {
    // Для обычного WAN - сразу применяем
    saveWanChanges()
  }
}

// Подтверждение применения Dual WAN
const confirmDualWanApply = () => {
  showDualWanConfirm.value = false
  // Применяем сохраненную конфигурацию
  saveWanChanges()
}

// Открытие интерфейса роутера
const openRouterInterface = () => {
  if (currentDevice.value && currentDevice.value.URL) {
    window.open(currentDevice.value.URL, '_blank')
    toast.add({
      severity: 'info',
      summary: 'Device Interface',
      detail: `Opening ${currentDevice.value.hwId} interface`,
      life: 2000
    })
  } else {
    toast.add({
      severity: 'warn',
      summary: 'Not Available',
      detail: 'Router interface URL is not available for this device',
      life: 3000
    })
  }
}

const handleInitializationFromConfirm = async () => {
    if (!currentDevice.value) {
        toast.add({
            severity: 'warn',
            summary: 'No Device',
            detail: 'No device selected',
            life: 3000
        })
        return
    }
  
  // Закрываем диалог подтверждения
  // showDualWanConfirm.value = false
  
  // ✅ Используем пароль из devicePassword.value (который пришел из бронирования)
const password = devicePassword.value
    
    if (!password) {
        toast.add({
            severity: 'warn',
            summary: 'No Password',
            detail: 'Device password is not available',
            life: 3000
        })
        return
    }
    
    try {
        // ✅ Сначала сохраняем пароль в конфиг
        await saveDevicePassword(password)
        
        // Копируем пароль в буфер обмена
        copyToClipboard(password, 'Device Password')
        
        // Используем существующий метод из store для инициализации
         deviceActionsStore.initializationDevice(currentDevice.value, password)
        
        toast.add({
            severity: 'info',
            summary: 'Initialization Started',
            detail: `Initializing ${currentDevice.value.hwId}... Password saved and copied to clipboard`,
            life: 3000
        })
    } catch (error) {
        console.error('❌ Failed to save password:', error)
        toast.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to save device password',
            life: 3000
        })
    }
};

const saveWanChanges = () => {
  // Валидация для Dual WAN
  if (isDualWanSelected.value) {
    if (!dualWanConfig.value.wan1 || !dualWanConfig.value.wan2) {
      toast.add({
        severity: 'warn',
        summary: 'Warning',
        detail: 'Please select both WAN 1 and WAN 2 types',
        life: 3000
      })
      return
    }
    
    if (dualWanConfig.value.wan1 === dualWanConfig.value.wan2) {
      toast.add({
        severity: 'warn',
        summary: 'Warning',
        detail: 'WAN 1 and WAN 2 must be different',
        life: 3000
      })
      return
    }
    
    const availableIds = availableWanTypesForDual.value.map(w => w.vlanId)
    if (!availableIds.includes(dualWanConfig.value.wan1)) {
      toast.add({
        severity: 'warn',
        summary: 'Warning',
        detail: 'Selected WAN 1 type is not available',
        life: 3000
      })
      return
    }
    if (!availableIds.includes(dualWanConfig.value.wan2)) {
      toast.add({
        severity: 'warn',
        summary: 'Warning',
        detail: 'Selected WAN 2 type is not available',
        life: 3000
      })
      return
    }
  }
  
  isLoading.value = true
  operationInProgress.value = true
  operationType.value = 'wan'
  progressMessage.value = 'Configuring switch...'
  
  let valueToSave = modalValue.value
  
  // Если выбран Dual WAN, передаем объект с конфигурацией
  if (isDualWanSelected.value) {
    valueToSave = {
      type: 'dual_wan',
      wan1: dualWanConfig.value.wan1,
      wan2: dualWanConfig.value.wan2
    }
  }
  
  const saveData = {
    value: valueToSave,
    type: 'wanTypes',
    callback: (success, message) => {
      isLoading.value = false
      operationInProgress.value = false
      operationType.value = ''
      progressMessage.value = ''
      
      if (success) {
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

// Функция копирования в буфер обмена
const copyToClipboard = async (text, fieldName = 'Text') => {
  if (!text) return
  
  try {
    await navigator.clipboard.writeText(text)
    // toast.add({
    //   severity: 'success',
    //   summary: 'Copied!',
    //   detail: `${fieldName} copied to clipboard`,
    //   life: 2000
    // })
  } catch (err) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    
    toast.add({
      severity: 'success',
      summary: 'Copied!',
      detail: `${fieldName} copied to clipboard`,
      life: 2000
    })
  }
}

// Функция копирования всех сетевых настроек
const copyAllSettings = async () => {
  const settings = `IP address: 212.100.156.75
MASK: 255.255.255.248
GW: 212.100.156.73
DNS: 87.245.145.6, 87.245.190.122`
  
  await copyToClipboard(settings, 'All network settings')
}

// Watch для автоматической очистки при выборе одинаковых типов
watch(() => dualWanConfig.value.wan1, (newVal) => {
  if (newVal && dualWanConfig.value.wan2 === newVal) {
    dualWanConfig.value.wan2 = null
    toast.add({
      severity: 'info',
      summary: 'Info',
      detail: 'WAN 1 and WAN 2 cannot be the same. WAN 2 has been cleared.',
      life: 3000
    })
  }
})

watch(() => dualWanConfig.value.wan2, (newVal) => {
  if (newVal && dualWanConfig.value.wan1 === newVal) {
    dualWanConfig.value.wan1 = null
    toast.add({
      severity: 'info',
      summary: 'Info',
      detail: 'WAN 1 and WAN 2 cannot be the same. WAN 1 has been cleared.',
      life: 3000
    })
  }
})

// Watch для modalValue
watch(modalValue, (newVal, oldVal) => {
  showPPPoECredentials.value = newVal === '747'
  showResetHint.value = newVal === null
  
  if (!isManualSelection.value) {
    const wasDualWan = oldVal === 'dual_wan_special' || (oldVal && typeof oldVal === 'object' && oldVal.type === 'dual_wan')
    const isDualWan = newVal === 'dual_wan_special' || (newVal && typeof newVal === 'object' && newVal.type === 'dual_wan')
    
    if (wasDualWan && !isDualWan) {
      if (dualWanConfig.value.wan1 || dualWanConfig.value.wan2) {
        toast.add({
          severity: 'info',
          summary: 'Info',
          detail: 'Switching from Dual WAN will reset the configuration',
          life: 3000
        })
      }
      dualWanConfig.value = { wan1: null, wan2: null }
    }
    
    if (!isDualWan) {
      dualWanConfig.value = { wan1: null, wan2: null }
    }
  }
})

// Очистка при размонтировании
onUnmounted(() => {
  cleanupOperation()
})

defineExpose({ 
  show,
  updateProgress: (newProgress, step, details) => {
    // console.log('Progress update:', newProgress, step, details)
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

/* Стили для прогресс-бара операции */
.operation-progress {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 8px;
  border: 1px solid var(--surface-200);
}

.wan-operation-progress {
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

/* ===== СТИЛИ ДЛЯ ДИАЛОГА ПОДТВЕРЖДЕНИЯ DUAL WAN ===== */
.dual-wan-confirm-dialog :deep(.p-dialog) {
  width: 600px !important;
  max-width: 90vw !important;
}

.confirmation-content {
  display: flex;
  align-items: flex-start;
  padding: 0.5rem 0;
}

.confirmation-content i {
  flex-shrink: 0;
}

.dual-wan-warning-info {
  background: var(--surface-50);
  border-radius: 6px;
  padding: 0.75rem;
  border-left: 3px solid var(--warning-500);
}

.warning-list {
  padding-left: 1.25rem;
  margin: 0;
}

.warning-list li {
  margin-bottom: 0.25rem;
  font-size: 0.9rem;
  color: var(--text-color-secondary);
}

.warning-list li:last-child {
  margin-bottom: 0;
}

/* Стили для сетевых настроек в диалоге */
.dual-wan-settings {
  background: var(--surface-card);
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--surface-200);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.2rem 0;
  font-size: 0.85rem;
  border-bottom: 1px solid var(--surface-100);
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-row .setting-label {
  color: var(--text-color-secondary);
  font-weight: 500;
  min-width: 70px;
  flex-shrink: 0;
}

.setting-row .setting-value-group {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex: 1;
  justify-content: flex-end;
}

.setting-row .setting-value {
  font-family: 'Courier New', monospace;
  font-size: 0.85rem;
  color: var(--text-color);
}

.copy-btn-small {
  width: 1.4rem !important;
  height: 1.4rem !important;
  min-width: auto !important;
  padding: 0 !important;
  color: var(--text-color-secondary);
  border: none !important;
  background: transparent !important;
}

.copy-btn-small:hover {
  color: var(--primary-color);
  background: var(--primary-50) !important;
}

.copy-btn-small .p-button-label {
  display: none !important;
}

.copy-btn-small .p-button-icon {
  font-size: 0.7rem !important;
}

.copy-all-row {
  border-top: 1px solid var(--surface-200);
  padding-top: 0.3rem;
  margin-top: 0.2rem;
  justify-content: center;
}

/* Стили для кнопок в диалоге */
.flex.justify-content-center.gap-2 {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.flex.justify-content-center.gap-2 .p-button {
  min-width: 180px;
}

/* ===== WAN TYPES СТИЛИ ===== */
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

.option-dual-wan-selected {
  background: var(--purple-50);
  border-color: var(--purple-500);
}

.option-dual-wan-selected .option-label {
  color: var(--purple-700);
}

.option-label {
  cursor: pointer;
  flex: 1;
  margin: 0;
}

/* ===== DUAL WAN СТИЛИ ===== */
.dual-wan-configuration {
  background: var(--surface-50);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--surface-200);
  margin-top: 1rem;
}

.dual-wan-configuration .section-title {
  font-size: 0.95rem;
  margin-bottom: 1rem;
  color: var(--text-color);
}

.wan-config-section {
  margin-bottom: 1rem;
}

.wan-config-section:last-child {
  margin-bottom: 0;
}

.wan-config-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.wan-config-header i {
  font-size: 1rem;
}

.wan-select {
  width: 100%;
}

.wan-select :deep(.p-dropdown) {
  width: 100%;
}

.dual-wan-info {
  margin-top: 0.5rem;
}

.dual-wan-info :deep(.p-message) {
  padding: 0.75rem;
}

/* ===== MWS CONNECTION СТИЛИ ===== */
.mws-connection-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.connection-info {
  margin: 0;
}

.current-connection-section {
  margin-bottom: 1.5rem;
}

.connection-info :deep(.p-message) {
  padding: 0.75rem;
}

.connection-info :deep(.p-message-content) {
  padding: 0;
}

.connection-details {
  flex: 1;
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

.signal-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.info-label {
  color: var(--text-color-secondary);
  min-width: 120px;
  text-align: left;
  font-size: 0.85rem;
}

/* Секция пароля роутера */
.router-password-section {
  background: var(--surface-50);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--surface-200);
}

.password-toggle-section {
  margin-bottom: 1rem;
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

.password-label .flex.align-items-center {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
}

.password-label .flex.align-items-center i {
  flex-shrink: 0;
}

.password-label .flex.align-items-center strong {
  flex: 1;
  text-align: left;
}

.password-label small {
  text-align: left;
  margin-top: 0.25rem;
}

/* Список роутеров */
.connection-options-section {
  border-top: 1px solid var(--surface-border);
  padding-top: 1rem;
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
  min-width: 0;
}

.router-name {
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

/* Подсказки подключения */
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

/* ===== FAQ СТИЛИ ===== */
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

/* ===== ФУТЕР МОДАЛКИ ===== */
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

/* Утилиты */
.no-routers-message,
.no-connection-section {
  margin-top: 1rem;
}

.info-message {
  margin-top: 1rem;
}

/* ===== АДАПТИВНОСТЬ ===== */
@media (max-width: 768px) {
  .modal-content {
    padding: 0.25rem 0;
  }

  .section-title {
    font-size: 0.95rem;
    margin-bottom: 0.75rem;
  }

  .mws-connection-content {
    gap: 1rem;
  }

  .connection-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .connection-info-line {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .info-label {
    min-width: auto;
    font-size: 0.9rem;
  }

  .router-password-section {
    padding: 0.75rem;
  }

  .horizontal-password-options {
    flex-direction: column;
    gap: 0.5rem;
  }

  .password-option {
    width: 100%;
  }

  .router-item {
    padding: 0.75rem;
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
  
  .dual-wan-configuration {
    padding: 0.75rem;
  }
  
  .wan-config-header {
    font-size: 0.85rem;
  }
  
  .dual-wan-confirm-dialog :deep(.p-dialog) {
    width: 95vw !important;
    max-width: 95vw !important;
  }
  
  .flex.justify-content-center.gap-2 {
    flex-direction: column;
    width: 100%;
  }
  
  .flex.justify-content-center.gap-2 .p-button {
    width: 100%;
    min-width: unset;
  }
  
  .setting-row {
    font-size: 0.8rem;
    padding: 0.3rem 0;
  }
  
  .setting-row .setting-label {
    min-width: 60px;
    font-size: 0.8rem;
  }
  
  .setting-row .setting-value {
    font-size: 0.8rem;
  }
  
  .copy-btn-small {
    width: 1.2rem !important;
    height: 1.2rem !important;
  }
  
  .copy-btn-small .p-button-icon {
    font-size: 0.6rem !important;
  }
}

@media (max-width: 480px) {
  .router-password-section {
    padding: 0.5rem;
  }

  .password-option {
    padding: 0.5rem;
  }

  .router-item {
    padding: 0.5rem;
  }

  .option-item {
    padding: 0.5rem;
  }
  
  .dual-wan-confirm-dialog :deep(.p-dialog) {
    width: 98vw !important;
    max-width: 98vw !important;
  }
  
  .setting-row {
    flex-wrap: wrap;
    gap: 0.2rem;
    padding: 0.3rem 0;
  }
  
  .setting-row .setting-label {
    min-width: 100%;
    font-size: 0.75rem;
  }
  
  .setting-row .setting-value-group {
    width: 100%;
    justify-content: space-between;
  }
  
  .setting-row .setting-value {
    font-size: 0.75rem;
    flex: 1;
  }
  
  .copy-btn-small {
    width: 1.1rem !important;
    height: 1.1rem !important;
  }
  
  .copy-btn-small .p-button-icon {
    font-size: 0.55rem !important;
  }
}

@media (min-width: 769px) {
  .faq-controls {
    flex-direction: row;
  }

  .search-container {
    max-width: 200px;
  }
}

/* Стили для скроллбара */
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