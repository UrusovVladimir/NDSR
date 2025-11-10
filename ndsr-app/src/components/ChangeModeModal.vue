<template>
  <Dialog 
    v-model:visible="visible" 
    :modal="true" 
    :header="modalTitle"
    :style="dialogStyle"
    :breakpoints="breakpoints"
    @hide="closeModal"
    class="change-mode-dialog"
    :contentStyle="contentStyle"
    :position="isMobile ? 'top' : 'center'"
  >
    <div class="change-mode-modal" v-if="currentDevice">
      <!-- Статус пароля -->
      <div v-if="!hasValidPassword && !operationInProgress" class="mb-3">
        <Message severity="warn">
          <i class="pi pi-exclamation-triangle mr-2"></i>
          No password available for this device. Please book the device first.
        </Message>
      </div>

      <!-- Ошибка аутентификации -->
      <div v-if="authError && !operationInProgress" class="mb-3">
        <Message severity="error">
          <i class="pi pi-shield mr-2"></i>
          Authentication failed. Please check device credentials.
        </Message>
      </div>

      <!-- Прогресс смены режима -->
      <div v-if="operationInProgress" class="operation-progress mb-4">
        <h6 class="section-title text-center mb-3">
          <i class="pi pi-cog mr-2"></i>
          Changing Device Mode
        </h6>
        
        <!-- Прогресс-бар -->
        <ProgressBar 
          :value="progressPercentage" 
          class="custom-progressbar"
          :class="progressBarClass"
          showValue
        />
        
        <!-- Детальный статус -->
        <div class="status-steps">
          <div 
            v-for="step in statusSteps" 
            :key="step.id" 
            class="status-step" 
            :class="{ 
              'active': currentStep === step.id, 
              'completed': currentStep > step.id 
            }"
          >
            <div class="step-indicator">
              <i v-if="currentStep > step.id" class="pi pi-check-circle text-green-500"></i>
              <i v-else-if="currentStep === step.id" class="pi pi-spin pi-spinner text-primary"></i>
              <i v-else class="pi pi-circle text-color-secondary"></i>
            </div>
            <div class="step-content">
              <div class="step-title">{{ step.title }}</div>
              <div class="step-description">{{ step.description }}</div>
              <div v-if="step.details && currentStep >= step.id" class="step-details text-color-secondary text-sm">
                {{ getStepDetails(step.id) }}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Таймер перезагрузки -->
        <div v-if="currentStep >= 3" class="reboot-timer text-center mt-3">
          <div class="timer-display">
            <i class="pi pi-clock mr-2"></i>
            Device rebooting... Estimated time: 
            <span class="font-bold">{{ formatTime(estimatedTimeRemaining) }}</span>
          </div>
          <small class="text-color-secondary">This may take 2-3 minutes</small>
        </div>
      </div>

      <div v-if="!operationInProgress">
        <!-- УЛУЧШЕННОЕ ОТОБРАЖЕНИЕ ТЕКУЩЕГО РЕЖИМА -->
        <div class="current-mode-section mb-4" v-if="hasValidPassword">
          <h6 class="section-title mb-2">Current Mode:</h6>
          <div class="mode-display-container">
            <div class="flex align-items-center gap-3">
              <div class="mode-status-indicator" :class="modeStatusClass">
                <i :class="modeStatusIcon" class="mr-1"></i>
                <small>{{ modeStatusText }}</small>
              </div>
            </div>
          </div>
        </div>

        <!-- Информация о пароле -->
        <div v-if="hasValidPassword && !authError" class="password-info mb-3">
          <Chip :label="`Using ${passwordSource} password: ${devicePassword}`" icon="pi pi-key" />
        </div>

        <div v-if="hasValidPassword && !authError" class="action-selection-section mb-4">
          <h6 class="section-title mb-3">Select Action:</h6>
          
          <!-- Router Mode - скрываем если уже в router без подключения -->
          <div v-if="shouldShowAction('router')" 
               class="action-option mb-3 p-3 border-1 surface-border border-round" 
               :class="{ 'action-option-active': selectedAction === 'router' }">
            <RadioButton
              v-model="selectedAction"
              inputId="actionRouter"
              name="action"
              value="router"
              class="action-radio"
            />
            <label for="actionRouter" class="action-label">
              <div class="flex align-items-center mb-1">
                <i class="bi bi-router mr-2 text-primary"></i>
                <strong class="text-lg">Router Mode</strong>
              </div>
              <small class="block text-color-secondary">
                Convert device to standalone router
              </small>
            </label>
          </div>

          <!-- Extender Mode (без подключения) - скрываем если уже в extender без подключения -->
          <div v-if="shouldShowAction('extender')"
               class="action-option mb-3 p-3 border-1 surface-border border-round"
               :class="{ 'action-option-active': selectedAction === 'extender' }">
            <RadioButton
              v-model="selectedAction"
              inputId="actionExtender"
              name="action"
              value="extender"
              class="action-radio"
            />
            <label for="actionExtender" class="action-label">
              <div class="flex align-items-center mb-1">
                <i class="pi pi-wifi mr-2 text-success"></i>
                <strong class="text-lg">Extender Mode</strong>
              </div>
              <small class="block text-color-secondary">
                Convert to extender without connecting to router
              </small>
            </label>
          </div>

          <!-- Extender + Connect - скрываем если уже в extender с подключением -->
          <div v-if="shouldShowAction('extenderConnect')"
               class="action-option mb-3 p-3 border-1 surface-border border-round"
               :class="{ 'action-option-active': selectedAction === 'extenderConnect' }">
            <RadioButton
              v-model="selectedAction"
              inputId="actionExtenderConnect"
              name="action"
              value="extenderConnect"
              class="action-radio"
            />
            <label for="actionExtenderConnect" class="action-label">
              <div class="flex align-items-center mb-1">
                <i class="pi pi-broadcast mr-2 text-success"></i>
                <i class="pi pi-link mr-1 text-primary"></i>
                <strong class="text-lg">Extender + Connect</strong>
              </div>
              <small class="block text-color-secondary">
                Convert to extender and connect to selected router
              </small>
            </label>
          </div>

          <!-- Disconnect + Router Mode - показываем только если в extender с подключением -->
          <div v-if="shouldShowAction('disconnectRouter')"
               class="action-option mb-3 p-3 border-1 surface-border border-round"
               :class="{ 'action-option-active': selectedAction === 'disconnectRouter' }">
            <RadioButton
              v-model="selectedAction"
              inputId="actionDisconnectRouter"
              name="action"
              value="disconnectRouter"
              class="action-radio"
            />
            <label for="actionDisconnectRouter" class="action-label">
              <div class="flex align-items-center mb-1">
                <i class="pi pi-chain-broken mr-2 text-danger"></i>
                <i class="bi bi-router mr-1 text-primary"></i>
                <strong class="text-lg">Disconnect + Router Mode</strong>
              </div>
              <small class="block text-color-secondary">
                Disconnect from current router and switch to router mode
              </small>
            </label>
          </div>
        </div>

        <div v-if="(selectedAction === 'extenderConnect' || selectedAction === 'disconnectRouter') && hasValidPassword && !authError" 
            class="router-password-section mb-4">
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

        <!-- Выбор роутера для отключения -->
        <div v-if="selectedAction === 'disconnectRouter' && hasValidPassword && !authError" 
            class="router-selection-section mb-4">
          <h6 class="section-title mb-2">Select Router to Disconnect From:</h6>
          <Dropdown 
            v-model="selectedRouterId" 
            :options="availableBookedRoutersFormatted"
            optionLabel="displayName"
            optionValue="id"
            placeholder="Select router to disconnect from..."
            class="w-full router-dropdown"
            :disabled="operationInProgress"
          />
        </div>

        <!-- Выбор роутера для подключения -->
        <div v-if="selectedAction === 'extenderConnect' && hasValidPassword && !authError" class="router-selection-section mb-4">
          <h6 class="section-title mb-2">Select Router to Connect:</h6>
          <Dropdown 
            v-model="selectedRouterId" 
            :options="availableBookedRoutersFormatted"
            optionLabel="displayName"
            optionValue="id"
            placeholder="Select a router..."
            class="w-full router-dropdown"
            :panelStyle="{ 
              maxHeight: '200px',
              position: 'absolute',
              zIndex: 10000 
            }"
            :disabled="operationInProgress"
          />
          <div v-if="selectedAction === 'extenderConnect' && !selectedRouterId" class="text-orange-500 text-sm mt-2">
            <i class="pi pi-exclamation-circle mr-1"></i>
            Please select a router to connect to
          </div>
        </div>

        <!-- Предупреждения -->
        <div v-if="showWarning && !authError" class="mt-3">
          <div class="warning-message p-3 border-round bg-yellow-50 border-1 border-yellow-200">
            <div class="flex align-items-center">
              <i class="pi pi-exclamation-triangle text-yellow-600 mr-2"></i>
              <span class="text-yellow-700">{{ warningMessage }}</span>
            </div>
          </div>
        </div>

        <!-- Сообщение о необходимости бронирования -->
        <div v-if="!hasValidPassword" class="mt-3">
          <Message severity="info">
            <i class="pi pi-info-circle mr-2"></i>
            To change device mode, you need to book the device first.
          </Message>
        </div>

        <!-- Сообщение при ошибке аутентификации -->
        <div v-if="authError" class="mt-3">
          <Message severity="info">
            <i class="pi pi-info-circle mr-2"></i>
            Cannot determine current mode due to authentication issues. You can still try to change mode.
          </Message>
        </div>

        <!-- Debug секция -->
        <Button 
              :label="showDebug ? 'Hide' : 'Show Debug Info'"
              :icon="showDebug ? 'bi bi-toggle-on' : 'bi bi-tools'"
              @click="showDebugSection"
              class="p-button-sm p-button-info"
              style="margin-top: 15px;"
            />
            
        <div v-if="showDebug" class="debug-section mt-3 p-2 border-round" style="background: #f8f9fa; border: 1px dashed #ccc;">
          <small class="text-color-secondary">Debug info:</small>
          <div class="flex gap-2 mt-1">
            <Button 
              label="Test Mode Detection" 
              icon="pi pi-bug" 
              @click="testModeDetection"
              class="p-button-sm p-button-help"
              :disabled="!hasValidPassword"
            />
            <Button 
              label="Reset State" 
              icon="pi pi-refresh" 
              @click="resetState"
              class="p-button-sm p-button-secondary"
            />
          </div>
          <div v-if="debugInfo" class="mt-1 text-xs">
            <pre style="margin: 0; font-size: 0.75rem; background: #fff; padding: 0.5rem; border-radius: 4px; overflow-x: auto;">{{ debugInfo }}</pre>
          </div>
          <div class="mt-1 text-xs">
            <div><strong>Device:</strong> {{ currentDevice?.hwId }} ({{ currentDevice?.id }})</div>
            <div><strong>Password:</strong> {{ devicePassword ? '••••••••' : 'None' }} ({{ passwordSource }})</div>
            <div><strong>URL:</strong> {{ currentDevice?.URL }}</div>
            <div><strong>Auth Error:</strong> {{ authError }}</div>
            <div><strong>Current Mode:</strong> {{ currentDeviceBaseMode || 'Unknown' }}</div>
            <div><strong>Status MWS:</strong> {{ mwsStatus }}</div> 
            <div><strong>Available Routers:</strong> {{ availableBookedRoutersFormatted.length }}</div>
            <div><strong>Should Show Router:</strong> {{ shouldShowAction('router') }}</div>
            <div><strong>Should Show Extender:</strong> {{ shouldShowAction('extender') }}</div>
            <div><strong>Should Show Connect:</strong> {{ shouldShowAction('extenderConnect') }}</div>
            <div><strong>Should Show Disconnect:</strong> {{ shouldShowAction('disconnectRouter') }}</div>
          </div>
        </div>
      </div>
    </div>
    
    <div v-else-if="!operationInProgress" class="text-center p-4">
      <ProgressSpinner />
      <div class="mt-2 text-color-secondary">Loading device information...</div>
    </div>

    <template #footer>
      <!-- Кнопки для обычного режима -->
      <template v-if="!operationInProgress">
        <Button 
          label="Cancel" 
          icon="pi pi-times" 
          @click="closeModal" 
          class="p-button-secondary modal-btn-cancel"
          :disabled="operationInProgress" 
        />
        <Button 
          v-if="hasValidPassword && !authError"
          :label="confirmButtonText" 
          icon="pi pi-check" 
          @click="confirmAction"
          :disabled="!canConfirm || isLoading"
          :loading="isLoading"
          class="modal-btn-confirm"
        />
        <Button 
          v-else-if="hasValidPassword && authError"
          label="Try Change Mode Anyway" 
          icon="pi pi-exclamation-triangle" 
          @click="confirmAction"
          :disabled="!canConfirmAuthError || isLoading"
          :loading="isLoading"
          class="p-button-warning modal-btn-warning"
        />
        <Button 
          v-else
          label="Book Device First" 
          icon="pi pi-lock" 
          disabled
          class="p-button-outlined modal-btn-disabled"
        />
      </template>

      <!-- Кнопка для режима операции -->
      <Button 
        v-else
        :label="currentStep >= 3 ? 'Operation in Progress...' : 'Close'" 
        icon="pi pi-times" 
        @click="handleOperationClose" 
        class="p-button-outlined modal-btn-operation"
        :disabled="currentStep >= 3"
      />
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch, onUnmounted, onMounted, inject } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useModeStore } from '@/stores/useModeStore'
import { useDeviceStore } from '@/stores/useDeviceStore'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import RadioButton from 'primevue/radiobutton'
import Dropdown from 'primevue/dropdown'
import ProgressBar from 'primevue/progressbar'
import ProgressSpinner from 'primevue/progressspinner'
import Chip from 'primevue/chip'
import Message from 'primevue/message'
import Password from 'primevue/password' 



const toast = useToast()
const modeStore = useModeStore()
const deviceStore = useDeviceStore()

// Определяем мобильное устройство
const isMobile = ref(false)

// ✅ ДОБАВЛЯЕМ НОВЫЕ ПЕРЕМЕННЫЕ ДЛЯ УПРАВЛЕНИЯ ПАРОЛЕМ
const useDevicePassword = ref(true)
const manualRouterPassword = ref('')

const checkMobile = () => {
  isMobile.value = window.innerWidth <= 768
}
const showDebugSection = () => {
  showDebug.value = !showDebug.value
}
// Стили для диалога
const dialogStyle = computed(() => {
  if (isMobile.value) {
    return { 
      width: '100vw', 
      height: '90vh', 
      margin: '0',
      borderRadius: '0',
      maxHeight: 'none'
    }
  }
  return { 
    width: '50vw', 
    maxWidth: '600px',
    minWidth: '400px'
  }
})

const breakpoints = computed(() => {
  if (isMobile.value) {
    return {
      '0px': { 
        width: '100vw', 
        height: '100vh', 
        margin: '0',
        borderRadius: '0'
      }
    }
  }
  
  return {
    '1400px': '60vw',
    '1200px': '70vw', 
    '960px': '80vw',
    '768px': { 
      width: '100vw', 
      height: '100vh', 
      margin: '0',
      borderRadius: '0'
    }
  }
})

const contentStyle = computed(() => {
  if (isMobile.value) {
    return {
      maxHeight: 'calc(100vh - 120px)',
      overflowY: 'auto',
      padding: '1rem',
      paddingBottom: 'env(safe-area-inset-bottom, 1rem)'
    }
  }
  return {
    maxHeight: '70vh',
    overflowY: 'auto',
    padding: '1.5rem'
  }
})

const props = defineProps({
  device: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['modeChanged'])

const visible = ref(false)
const selectedAction = ref('router')
const selectedRouterId = ref('')
const isLoading = ref(false)
const modeCheckInProgress = ref(false)
const devicePassword = ref('')
const passwordSource = ref('global')
const authError = ref(false)
const todayPassword = inject('todayPassword')
// Переменные для отслеживания прогресса
const operationInProgress = ref(false)
const currentStep = ref(0)
const operationStartTime = ref(null)
const estimatedTimeRemaining = ref(180)
const progressInterval = ref(null)

// Локальная копия устройства чтобы избежать проблем с null
const currentDevice = ref(null)

const debugInfo = ref('')
const showDebug = ref(false) // ✅ Добавляем переключатель для debug секции

// ✅ ДОБАВЛЯЕМ ОТСУТСТВУЮЩИЕ ПЕРЕМЕННЫЕ
const mwsStatus = computed(() => {
  return modeStore.mwsStatus || 'No MWS status'
})

// ✅ ИСПРАВЛЕННОЕ: Правильно получаем информацию о режиме
const currentDeviceModeInfo = computed(() => {
  if (!currentDevice.value) return null;
  
  const modeInfo = modeStore.getDeviceModeInfo(currentDevice.value.id);
  
  // ✅ ЕСЛИ В STORE NULL, НО УСТРОЙСТВО ОНЛАЙН - ПЫТАЕМСЯ ОПРЕДЕЛИТЬ
  if (!modeInfo && hasValidPassword.value && !authError.value) {
    console.log('🔄 No mode info in store for online device');
    // Можно запустить автоматическое определение
  }
  
  return modeInfo;
})

// ✅ Базовый режим с fallback
const currentDeviceBaseMode = computed(() => {
  const modeInfo = currentDeviceModeInfo.value;
  
  if (!modeInfo) {
    // ✅ ВОЗВРАЩАЕМ 'router' КАК ДЕФОЛТНЫЙ РЕЖИМ ВМЕСТО null
    return hasValidPassword.value && !authError.value ? 'router' : null;
  }
  
  return modeInfo.mode;
})

// ✅ Есть ли подключение к роутеру
const hasRouterConnection = computed(() => {
  const modeInfo = currentDeviceModeInfo.value
  // ✅ extender_connect ИЛИ extender с routerId считаются подключенными
  return modeInfo && (
    modeInfo.mode === 'extender_connect' || 
    (modeInfo.mode === 'extender' && modeInfo.routerId)
  )
})
// ✅ ID подключенного роутера
const connectedRouterId = computed(() => {
  const modeInfo = currentDeviceModeInfo.value
  return modeInfo?.routerId || null
})

const show = async (password, source = 'global') => {
    console.log('🔑 ChangeModeModal show called:', { 
        device: props.device?.hwId,
        hasPassword: !!password 
    });
  
    devicePassword.value = password;
    useDevicePassword.value = true;
    manualRouterPassword.value = '';
    passwordSource.value = source;
    authError.value = false;
    operationInProgress.value = false;
    currentStep.value = 0;
    selectedAction.value = 'router';
    selectedRouterId.value = '';
    modeCheckInProgress.value = false;
    isLoading.value = false;
    debugInfo.value = '';
    
    currentDevice.value = props.device;
    visible.value = true;

    if (hasValidPassword.value && currentDevice.value) {
        console.log('🔄 Loading current mode (preserving connections)...');
        
        // ✅ ТОЛЬКО ДЛЯ ОТЛАДКИ - можно закомментировать в проде
        await loadCurrentMode();
    }

    // ✅ ВОССТАНАВЛИВАЕМ ВЫБРАННЫЙ РОУТЕР ИЗ СУЩЕСТВУЮЩИХ ДАННЫХ
    if (currentDevice.value) {
        const savedMode = modeStore.getDeviceModeInfo(currentDevice.value.id);
        if (savedMode?.routerId) {
            selectedRouterId.value = savedMode.routerId;
            console.log(`🔗 Restored router selection: ${selectedRouterId.value}`);
        }
        
        // ✅ АВТОМАТИЧЕСКИ ВЫБИРАЕМ СООТВЕТСТВУЮЩЕЕ ДЕЙСТВИЕ
        autoSelectActionBasedOnMode(savedMode);
    }
}

// ✅ ДОБАВЬТЕ ЭТУ ФУНКЦИЮ ДЛЯ АВТОВЫБОРА ДЕЙСТВИЯ
const autoSelectActionBasedOnMode = (modeInfo) => {
    if (!modeInfo) return;
    
    const mode = modeInfo.mode;
    const hasConnection = modeInfo.routerId;
    
    console.log('🤖 Auto-selecting action based on mode:', { mode, hasConnection });
    
    if (mode === 'router' && !hasConnection) {
        selectedAction.value = 'router';
    } else if (mode === 'extender' && !hasConnection) {
        selectedAction.value = 'extender';
    } else if (mode === 'extender_connect' || (mode === 'extender' && hasConnection)) {
        selectedAction.value = 'disconnectRouter';
    }
}



const loadCurrentMode = async () => {
    if (!hasValidPassword.value || !currentDevice.value) return;
    
    modeCheckInProgress.value = true;
    authError.value = false;
    
    try {
        console.log('🔄 Loading current mode (preserving connections)...');
        
        // ✅ СОХРАНЯЕМ ПОЛНУЮ ИНФОРМАЦИЮ О ТЕКУЩЕМ РЕЖИМЕ
        const existingModeInfo = modeStore.getDeviceModeInfo(currentDevice.value.id);
        const existingMode = existingModeInfo?.mode;
        const existingRouterId = existingModeInfo?.routerId;
        
        console.log('📊 Existing mode info:', { existingMode, existingRouterId });
        
        // ✅ ЕСЛИ УСТРОЙСТВО ПОДКЛЮЧЕНО - НЕ ПЕРЕОПРЕДЕЛЯЕМ РЕЖИМ!
        if (existingMode === 'extender_connect' && existingRouterId) {
            console.log('🔗 Device is connected, skipping mode detection to preserve connection');
            authError.value = false;
            return; // ← ВАЖНО: выходим без переопределения режима
        }
        
        // ✅ ТОЛЬКО ДЛЯ НЕПОДКЛЮЧЕННЫХ УСТРОЙСТВ - определяем режим
        const detectedMode = await modeStore.getCurrentMode(currentDevice.value.id, devicePassword.value);
        
        // ✅ УМНАЯ ЛОГИКА ОБНОВЛЕНИЯ: СОХРАНЯЕМ ПОДКЛЮЧЕНИЯ
        let finalMode = detectedMode;
        let finalRouterId = existingRouterId;
        
        // Если устройство было подключено, но сервер вернул extender - сохраняем подключение
        if (existingMode === 'extender_connect' && detectedMode === 'extender' && existingRouterId) {
            finalMode = 'extender_connect';
            console.log('🔄 Preserving connection mode despite server response');
        }
        // Если не подключено и сервер вернул router - очищаем routerId
        else if (detectedMode === 'router') {
            finalRouterId = null;
        }
        
        modeStore.updateDeviceMode(currentDevice.value.id, {
            mode: finalMode,
            routerId: finalRouterId,
            timestamp: Date.now()
        });
        
        authError.value = false;
        console.log(`✅ Mode updated: ${finalMode}, routerId: ${finalRouterId}`);
        
    } catch (error) {
        console.log('❌ Error getting current mode:', error.message);
        
        // ✅ ПРИ ОШИБКЕ НЕ СБРАСЫВАЕМ ДАННЫЕ
        const existingModeInfo = modeStore.getDeviceModeInfo(currentDevice.value.id);
        if (existingModeInfo) {
            console.log('⚠️ Keeping existing mode data due to error:', existingModeInfo);
        }
        
        if (error.message.includes('401') || error.message.includes('authentication')) {
            authError.value = true;
            toast.add({ 
                severity: 'error', 
                summary: 'Authentication Failed', 
                detail: 'Cannot determine current mode due to authentication issues', 
                life: 5000 
            });
        } else if (error.message.includes('timeout')) {
            toast.add({ 
                severity: 'warn', 
                summary: 'Device Timeout', 
                detail: 'Device is slow to respond. Mode detection failed.', 
                life: 5000 
            });
        }
    } finally {
        modeCheckInProgress.value = false;
    }
}

// Функции для отладки
const testModeDetection = async () => {
  if (!hasValidPassword.value || !currentDevice.value) return
  
  debugInfo.value = 'Testing mode detection via store...'
  
  try {
    let testPassword = devicePassword.value;
    
    if (!testPassword) {
      debugInfo.value = '❌ No password available for testing'
      toast.add({ severity: 'error', summary: 'Mode Detection Test Failed', detail: 'No password available for testing', life: 5000 })
      return;
    }
    
    console.log('🔧 TestModeDetection via store:', {
      deviceId: currentDevice.value.id,
      hasPassword: !!testPassword,
      passwordLength: testPassword.length
    });
    
    // ✅ Используем forceRefresh: true только для тестирования
    const mode = await modeStore.getCurrentMode(currentDevice.value.id, testPassword, { forceRefresh: true })
    
    debugInfo.value = `✅ Success! Mode: ${mode}`
    toast.add({ severity: 'success', summary: 'Mode Detection Test', detail: `Mode detected: ${mode}`, life: 3000 })
    
  } catch (error) {
    debugInfo.value = `❌ Store error: ${error.message}`
    console.error('TestModeDetection store error:', error)
    
    if (modeStore.error) {
      console.error('Store error details:', modeStore.error)
      debugInfo.value += `\nStore error: ${modeStore.error}`
    }
    
    let errorDetail = error.message;
    if (error.message.includes('401') || error.message.includes('authentication')) {
      errorDetail = 'Authentication failed. Please check the device password.'
    } else if (error.message.includes('timeout')) {
      errorDetail = 'Device timeout. Device may be offline or slow to respond.'
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorDetail = 'Network error. Check device connectivity.'
    }
    
    toast.add({ severity: 'error', summary: 'Mode Detection Test Failed', detail: errorDetail, life: 5000 })
  }
}

const resetState = () => {
  modeStore.resetDeviceMode(currentDevice.value?.id)
  authError.value = false
  modeCheckInProgress.value = false
  debugInfo.value = 'State reset'
  toast.add({ severity: 'info', summary: 'State Reset', detail: 'Modal state has been reset', life: 2000 })
}

const startOperationProgress = () => {
  operationInProgress.value = true
  currentStep.value = 1
  operationStartTime.value = Date.now()
  estimatedTimeRemaining.value = 180
  
  progressInterval.value = setInterval(() => {
    if (currentStep.value < 4) {
      const elapsed = Math.floor((Date.now() - operationStartTime.value) / 1000)
      estimatedTimeRemaining.value = Math.max(0, 180 - elapsed)
    }
  }, 1000)
}

const updateProgressStep = (step) => {
  currentStep.value = step
}

const getStepDetails = (stepId) => {
  switch (stepId) {
    case 1:
      return currentStep.value >= 1 ? 'Command sent successfully' : ''
    case 2:
      return currentStep.value >= 2 ? 'Configuration applied' : ''
    case 3:
      return currentStep.value >= 3 ? `Estimated time: ${formatTime(estimatedTimeRemaining.value)}` : ''
    case 4:
      return currentStep.value >= 4 ? 'You can now use the device' : ''
    default:
      return ''
  }
}

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
  
const closeModal = () => {
  fullCleanup()
  visible.value = false
}

const handleOperationClose = () => {
  if (currentStep.value >= 3) {
    toast.add({ severity: 'info', summary: 'Operation in Progress', detail: 'Please wait for the operation to complete', life: 3000 })
    return
  }
  closeModal()
}

const cleanupOperation = () => {
  if (progressInterval.value) {
    clearInterval(progressInterval.value)
    progressInterval.value = null
  }
  operationInProgress.value = false
  currentStep.value = 0
  isLoading.value = false
  estimatedTimeRemaining.value = 180
}

const fullCleanup = () => {
  cleanupOperation()
  selectedAction.value = 'router'
  selectedRouterId.value = ''
  devicePassword.value = ''
  useDevicePassword.value = true
  manualRouterPassword.value = ''
  passwordSource.value = 'global'
  authError.value = false
  modeCheckInProgress.value = false
  currentDevice.value = null
  debugInfo.value = ''
  showDebug.value = false
}
  
const confirmAction = async () => {
  if ((!canConfirm.value && !authError.value) || (!canConfirmAuthError.value && authError.value)) return
  
  isLoading.value = true
  
  try {
    let mode, routerId;
    
    switch (selectedAction.value) {
      case 'router':
        mode = 'router'
        routerId = null
        break
      case 'extender':
        mode = 'extender' 
        routerId = null
        break
      case 'extenderConnect':
        mode = 'extender_connect'
        routerId = selectedRouterId.value
        break
      case 'disconnectRouter':
        mode = 'extender_disconnect'
        routerId = selectedRouterId.value 
        break
      default:
        throw new Error('Invalid action selected')
    }
    
    startOperationProgress()
    
    setTimeout(() => updateProgressStep(2), 1000)
    
    if (selectedAction.value === 'extenderConnect') {
      setTimeout(() => updateProgressStep(3), 3000)
    } else {
      setTimeout(() => updateProgressStep(3), 3000)
    }
    
    let routerPasswordToUse = null
    if (selectedAction.value === 'extenderConnect' || selectedAction.value === 'disconnectRouter') {
      if (useDevicePassword.value) {
        routerPasswordToUse = devicePassword.value
        console.log('🔑 Using device password for router')
      } else if (manualRouterPassword.value) {
        routerPasswordToUse = manualRouterPassword.value
        console.log('🔑 Using manual password for router')
      }
    }
    
    const result = await modeStore.changeMode(
      currentDevice.value.id, 
      mode,
      routerId, 
      devicePassword.value,
      routerPasswordToUse
    )
    
    if (result.success) {
      updateProgressStep(4)
      
      let successMessage = `Device mode successfully changed to ${mode}`
      if (result.mwsConnected) {
        successMessage += ` and connected to ${routerId} via MWS`
      }
      
      toast.add({ severity: 'success', summary: 'Operation Completed', detail: successMessage, life: 5000 })
      
      setTimeout(() => {
        emit('modeChanged', {
          deviceId: currentDevice.value.id,
          mode: mode,
          routerId: routerId,
          action: selectedAction.value,
          mwsConnected: result.mwsConnected || false,
          passwordUsed: useDevicePassword.value ? 'device' : 'manual'
        })
        closeModal()
      }, 2000)
    } else {
      throw new Error(result.message)
    }
    
  } catch (error) {
    console.error('Action failed:', error)
    cleanupOperation()
    toast.add({ severity: 'error', summary: 'Operation Failed', detail: error.message, life: 5000 })
  } finally {
    isLoading.value = false
  }
}

// ✅ ВАЖНЫЕ ИСПРАВЛЕНИЯ:

// ✅ 1. ФИЛЬТРАЦИЯ РОУТЕРОВ - только забронированные и type = router
const availableBookedRoutersFormatted = computed(() => {
  return deviceStore.devices
    .filter(device => {
      // Только роутеры
      const isRouter = device.type === 'router';
      // Только забронированные текущим пользователем
      const isBooked = device.booking?.isBooked && device.booking?.bookedBy === deviceStore.currentUserId;
      // Только онлайн устройства
      const isOnline = device.statusCode === 200;
      // Исключаем текущее устройство из списка
      const isNotCurrentDevice = device.id !== currentDevice.value?.id;
      
      return isRouter && isBooked && isOnline && isNotCurrentDevice;
    })
    .map(router => ({
      id: router.id,
      displayName: `${router.hwId} ${router.shortName}`
    }));
});

// ✅ 2.   ЛОГИКА ОТОБРАЖЕНИЯ ДЕЙСТВИЙ
const shouldShowAction = (action) => {
  if (!hasValidPassword.value || authError.value) return true;
  
  const baseMode = currentDeviceBaseMode.value;
  const hasConnection = hasRouterConnection.value;
  const connectedRouter = connectedRouterId.value;
  
  console.log('🔍 shouldShowAction check:', {
    action,
    baseMode,
    hasConnection,
    connectedRouter,
    modeInfo: currentDeviceModeInfo.value
  });
  
  switch (action) {
    case 'router':
      // Скрываем Router если уже в router без подключения
      return !(baseMode === 'router' && !hasConnection);
      
    case 'extender':
      // Скрываем Extender если уже в extender без подключения
      return !(baseMode === 'extender' && !hasConnection);
      
    case 'extenderConnect':
      // Скрываем Extender+Connect если уже в extender с подключением
      return !(baseMode === 'extender_connect' || (baseMode === 'extender' && hasConnection));
      
    case 'disconnectRouter':
      // Показываем Disconnect только если в extender с подключением
      return (baseMode === 'extender_connect' || (baseMode === 'extender' && hasConnection && connectedRouter));
      
    default:
      return true;
  }
}

// ✅ 3.  COMPUTED PROPERTIES ДЛЯ ОТОБРАЖЕНИЯ РЕЖИМА
const hasValidPassword = computed(() => {
  return devicePassword.value && 
        devicePassword.value.trim() !== '' && 
        devicePassword.value !== 'Loading...'
})

const modalTitle = computed(() => {
  if (!currentDevice.value) return 'Device Mode'
  
  return operationInProgress.value 
    ? `Changing Mode - ${currentDevice.value.shortName} ${currentDevice.value.hwId}`
    : `Device Mode - ${currentDevice.value.shortName} ${currentDevice.value.hwId}`
})

// ✅ ИСПРАВЛЕННОЕ computed свойство для severity
const progressSeverity = computed(() => {
  if (currentStep.value <= 2) return 'info'
  if (currentStep.value === 3) return 'warning'
  return 'success'
})

// ✅ Оставьте progressPercentage как есть
const progressPercentage = computed(() => {
  return Math.min((currentStep.value / 4) * 100, 100)
})

const progressBarClass = computed(() => {
  if (currentStep.value <= 2) return 'progress-info'
  if (currentStep.value === 3) return 'progress-warning'
  return 'progress-success'
})

const statusSteps = computed(() => [
  {
    id: 1,
    title: 'Sending Command',
    description: 'Sending mode change request to device',
  },
  {
    id: 2,
    title: 'Configuring Device',
    description: 'Device is applying new configuration',
  },
  {
    id: 3,
    title: 'Device Rebooting',
    description: 'Device is restarting with new mode',
  },
  {
    id: 4,
    title: 'Operation Complete',
    description: 'Device mode has been changed successfully',
  }
])

// ✅ ИСПРАВЛЕННЫЕ computed ДЛЯ ОТОБРАЖЕНИЯ РЕЖИМА
const modeStatusClass = computed(() => {
  if (!hasValidPassword.value) return 'status-unknown'
  if (authError.value) return 'status-error'
  if (modeCheckInProgress.value) return 'status-checking'
  
  const baseMode = currentDeviceBaseMode.value
  const hasConnection = hasRouterConnection.value
  
  if (baseMode === 'router') return 'status-router'
  if (baseMode === 'extender_connect') return 'status-extender-connected'
  if (baseMode === 'extender') return 'status-extender'
  return 'status-unknown'
})

const modeStatusIcon = computed(() => {
  if (!hasValidPassword.value) return 'pi pi-question-circle text-color-secondary'
  if (authError.value) return 'pi pi-exclamation-triangle text-red-500'
  if (modeCheckInProgress.value) return 'pi pi-spin pi-spinner text-primary'
  
  const baseMode = currentDeviceBaseMode.value
  const hasConnection = hasRouterConnection.value
  
  if (baseMode === 'router') return 'bi bi-router text-blue-500'
  if (baseMode === 'extender_connect') return 'pi pi-wifi text-green-500 pi-link'
  if (baseMode === 'extender') return 'pi pi-wifi text-green-500'
  return 'pi pi-question-circle text-color-secondary'
})

const modeStatusText = computed(() => {
  if (!hasValidPassword.value) return 'Password required'
  if (authError.value) return 'Authentication failed'
  if (modeCheckInProgress.value) return 'Detecting mode...'
  
  const baseMode = currentDeviceBaseMode.value
  const hasConnection = hasRouterConnection.value
  
  if (baseMode === 'router') return 'Router mode active'
  if (baseMode === 'extender_connect') return 'Extender mode (connected)'
  if (baseMode === 'extender') return 'Extender mode active'
  return 'Mode unknown'
})

// ✅ Информация о подключенном роутере
const connectedRouterInfo = computed(() => {
  if (!hasRouterConnection.value || !connectedRouterId.value) return ''
  
  const router = deviceStore.devices.find(d => d.id === connectedRouterId.value)
  return router ? `${router.hwId} (${router.shortName})` : `Router ${connectedRouterId.value}`
})

const canConfirm = computed(() => {
  if (!hasValidPassword.value || 
      operationInProgress.value || 
      modeCheckInProgress.value ||
      isLoading.value) return false
  
  // ✅ Проверяем что действие должно отображаться
  if (!shouldShowAction(selectedAction.value)) return false
      
  if (selectedAction.value === 'extenderConnect') return !!selectedRouterId.value
  if (selectedAction.value === 'disconnectRouter') return !!selectedRouterId.value
  
  return !!selectedAction.value
})

const confirmButtonText = computed(() => {
  if (authError.value) return 'Try Change Mode Anyway'
  
  const baseMode = currentDeviceBaseMode.value
  const hasConnection = hasRouterConnection.value
  
  switch (selectedAction.value) {
    case 'router': 
      return baseMode === 'router' && !hasConnection
        ? 'Device is already in Router Mode' 
        : 'Switch to Router Mode'
    case 'extender': 
      return baseMode === 'extender' && !hasConnection
        ? 'Device is already in Extender Mode' 
        : 'Switch to Extender Mode'
    case 'extenderConnect': 
      return baseMode === 'extender_connect' && hasConnection
        ? 'Reconnect Extender to Router' 
        : 'Switch to Extender & Connect'
    case 'disconnectRouter':
      return 'Disconnect & Switch to Router'
    default: return 'Confirm'
  }
})

const showWarning = computed(() => {
  if (!hasValidPassword.value || authError.value || operationInProgress.value || modeCheckInProgress.value || isLoading.value) return false
  
  const baseMode = currentDeviceBaseMode.value
  const hasConnection = hasRouterConnection.value
  
  // Показываем предупреждение если выбрано действие, которое не должно отображаться
  return !shouldShowAction(selectedAction.value)
})

const warningMessage = computed(() => {
  const baseMode = currentDeviceBaseMode.value
  const hasConnection = hasRouterConnection.value
  
  if (baseMode === 'router' && selectedAction.value === 'router' && !hasConnection) {
    return 'Device is already in Router mode'
  }
  if (baseMode === 'extender' && selectedAction.value === 'extender' && !hasConnection) {
    return 'Device is already in Extender mode'
  }
  if (baseMode === 'extender_connect' && selectedAction.value === 'extenderConnect' && hasConnection) {
    return 'Device is already in Extender mode with router connection'
  }
  return ''
})

const canConfirmAuthError = computed(() => {
  if (!hasValidPassword.value || 
      !authError.value || 
      operationInProgress.value || 
      modeCheckInProgress.value ||
      isLoading.value) return false
      
  if (selectedAction.value === 'extenderConnect') return !!selectedRouterId.value
  if (selectedAction.value === 'disconnectRouter') return !!selectedRouterId.value
  
  return !!selectedAction.value
})

// Watchers
watch(selectedAction, (newAction) => {
  if (newAction !== 'extenderConnect' && newAction !== 'disconnectRouter') {
    selectedRouterId.value = ''
  }
})

// ✅ СЛУШАЕМ ОБНОВЛЕНИЯ РЕЖИМА ИЗ STORE
watch(
  () => currentDeviceModeInfo.value,
  (newModeInfo) => {
    if (currentDevice.value && visible.value && newModeInfo) {
      console.log('🔄 Mode updated in store:', newModeInfo)
      
      // Автоматически выбираем соответствующий роутер для disconnect
      if (newModeInfo.routerId && hasRouterConnection.value) {
        selectedRouterId.value = newModeInfo.routerId
      }
    }
  },
  { deep: true }
)

defineExpose({ show })

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  fullCleanup()
})
</script>
<style scoped>
.change-mode-modal {
  min-height: 200px;
}

.section-title {
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--text-color);
  font-size: 1rem;
  line-height: 1.2;
}

/* Стили для опций действий */
.action-option {
  display: flex;
  align-items: flex-start;
  transition: all 0.3s ease;
  border-radius: 8px;
  border: 2px solid var(--surface-300);
  cursor: pointer;
}

.action-option:hover {
  border-color: var(--primary-300);
  background-color: var(--surface-50);
}

.action-option-active {
  border-color: var(--primary-500) !important;
  background-color: var(--primary-50);
}

.action-radio {
  margin-right: 12px;
  margin-top: 2px;
}

.action-label {
  cursor: pointer;
  flex: 1;
  margin: 0;
}

/* Стили для прогресса */
.status-steps {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
}

.status-step {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.75rem;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.status-step.active {
  background-color: var(--blue-50);
  border-left: 4px solid var(--blue-500);
}

.status-step.completed {
  background-color: var(--green-50);
  border-left: 4px solid var(--green-500);
}

.step-indicator {
  font-size: 1.25rem;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-content {
  flex: 1;
}

.step-title {
  font-weight: 600;
  margin-bottom: 0.25rem;
  color: var(--text-color);
}

.step-description {
  color: var(--text-color-secondary);
  font-size: 0.9rem;
}

.step-details {
  margin-top: 0.25rem;
  font-style: italic;
}

.reboot-timer {
  background: var(--yellow-100);
  border: 1px solid var(--yellow-200);
  border-radius: 8px;
  padding: 1rem;
}

.timer-display {
  font-size: 1.1rem;
  color: var(--yellow-800);
}

/* Секции */
.operation-progress {
  background: var(--surface-50);
  border-radius: 8px;
  padding: 1.5rem;
  border: 1px solid var(--surface-200);
}

.current-mode-section {
  padding: 0.75rem;
  background: var(--surface-50);
  border-radius: 8px;
  border: 1px solid var(--surface-200);
}

.mode-display-container {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.mode-status-indicator {
  display: inline-flex;
  align-items: center;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.25rem 0.75rem;
  border-radius: 16px;
  border: 1px solid currentColor;
  opacity: 0.9;
}

.warning-message {
  border-left: 4px solid #f59e0b;
}

.action-selection-section {
  background: var(--surface-50);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--surface-200);
}

.router-selection-section {
  background: var(--surface-50);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--surface-200);
}

.router-password-section {
  background: var(--surface-50);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--surface-200);
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

/* Стили для индикаторов статуса */
.status-unknown {
  color: #6c757d;
  background: #f8f9fa;
}

.status-checking {
  color: #007bff;
  background: #e7f3ff;
}

.status-error {
  color: #dc3545;
  background: #f8d7da;
}

.status-router {
  color: #007bff;
  background: #e7f3ff;
}

.status-extender {
  color: #28a745;
  background: #e8f5e8;
}

.status-extender-connected {
  color: #198754;
  background: #d1e7dd;
}

/* Мобильная адаптивность */
@media (max-width: 768px) {
  .change-mode-modal {
    min-height: auto;
    padding: 0.25rem;
  }
  
  .current-mode-section {
    padding: 0.75rem;
    margin-bottom: 1rem;
  }
  
  .mode-display-container .flex.align-items-center {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    width: 100%;
  }
  
  .mode-status-indicator {
    align-self: flex-start;
    margin-left: 0;
  }
  
  .action-selection-section,
  .router-selection-section,
  .router-password-section {
    padding: 0.75rem;
    margin-bottom: 1rem;
  }
  
  .action-option {
    padding: 0.75rem;
    margin-bottom: 0.75rem;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .action-radio {
    margin-right: 0;
    align-self: flex-start;
  }
  
  .section-title {
    font-size: 0.95rem;
    margin-bottom: 0.75rem;
  }
  
  .action-label .text-lg {
    font-size: 1rem;
  }
  
  .action-label small {
    font-size: 0.8rem;
  }
  
  .password-toggle-section .flex.align-items-center {
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .password-option {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .current-mode-section {
    padding: 0.5rem;
  }
  
  .action-option {
    padding: 0.5rem;
  }
  
  .action-label .text-lg {
    font-size: 0.9rem;
  }
  
  .action-label small {
    font-size: 0.75rem;
  }
  
  .router-password-section {
    padding: 0.5rem;
  }
  
  .password-option {
    padding: 0.5rem;
  }
}

@media (max-width: 375px) {
  .current-mode-section {
    padding: 0.4rem;
  }
  
  .action-option {
    padding: 0.4rem;
  }
}

/* Для очень маленьких экранов */
@media (max-width: 360px) {
  .current-mode-section .flex.align-items-center {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
  
  .mode-status-indicator {
    align-self: flex-start;
    margin-left: 0 !important;
  }
}
</style>

<style>
/* Глобальные стили для этого диалога */
.change-mode-dialog .p-dialog-header {
  background: linear-gradient(135deg, #f8f9fa, #e9ecef) !important;
  border-bottom: 1px solid #dee2e6 !important;
  padding: 1.25rem 1.5rem !important;
}

.change-mode-dialog .p-dialog-content {
  background: #ffffff !important;
  overflow-y: auto;
}

.change-mode-dialog .p-dialog-footer {
  background: #f8f9fa !important;
  border-top: 1px solid #dee2e6 !important;
  display: flex !important;
  gap: 0.75rem !important;
  justify-content: flex-end !important;
}

/* Стили для кнопок в модальном окне */
.modal-btn-cancel,
.modal-btn-confirm,
.modal-btn-warning,
.modal-btn-disabled,
.modal-btn-operation {
  border-radius: 8px !important;
  padding: 0.75rem 1.5rem !important;
  font-weight: 500 !important;
  transition: all 0.3s ease !important;
  min-width: 120px !important;
}

.modal-btn-cancel {
  background: #6c757d !important;
  border: 1px solid #6c757d !important;
  color: white !important;
}

.modal-btn-cancel:hover {
  background: #5a6268 !important;
  border-color: #545b62 !important;
  transform: translateY(-1px) !important;
}

.modal-btn-confirm {
  background: linear-gradient(135deg, #28a745, #20c997) !important;
  border: none !important;
  color: white !important;
}

.modal-btn-confirm:hover {
  background: linear-gradient(135deg, #218838, #1e9e8a) !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 4px 8px rgba(40, 167, 69, 0.3) !important;
}

.modal-btn-warning {
  background: linear-gradient(135deg, #ffc107, #fd7e14) !important;
  border: none !important;
  color: white !important;
}

.modal-btn-warning:hover {
  background: linear-gradient(135deg, #e0a800, #e36407) !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 4px 8px rgba(255, 193, 7, 0.3) !important;
}

.modal-btn-disabled {
  border-radius: 8px !important;
  padding: 0.75rem 1.5rem !important;
}

.modal-btn-operation {
  border-radius: 8px !important;
  padding: 0.75rem 1.5rem !important;
}

/* Стили для dropdown */
.router-dropdown .p-dropdown {
  border-radius: 6px !important;
  border: 1px solid #ced4da !important;
  width: 100% !important;
}

.router-dropdown .p-dropdown:focus {
  border-color: #28a745 !important;
  box-shadow: 0 0 0 0.2rem rgba(40, 167, 69, 0.25) !important;
}
/* Стили через классы PrimeVue */
.custom-progressbar {
  height: 13.5px !important;
  border-radius: 4px;
  margin: 0.5rem 0;
}


:deep(.custom-progressbar.progress-info .p-progressbar .p-progressbar-value) {
  background: linear-gradient(90deg, #007bff, #0056b3) !important;
}

:deep(.custom-progressbar.progress-warning .p-progressbar .p-progressbar-value) {
  background: linear-gradient(90deg, #ffc107, #fd7e14) !important;
}

:deep(.custom-progressbar.progress-success .p-progressbar .p-progressbar-value) {
  background: linear-gradient(90deg, #28a745, #20c997) !important;
}
/* ПОЛНОЭКРАННАЯ АДАПТИВНОСТЬ ДЛЯ МОБИЛЬНЫХ */
@media (max-width: 768px) {
  .change-mode-dialog .p-dialog {
    width: 100vw !important;
    height: 100vh !important;
    margin: 0 !important;
    max-width: none !important;
    border-radius: 0 !important;
  }
  
  .change-mode-dialog .p-dialog-content {
    padding: 1rem !important;
    max-height: calc(100vh - 120px) !important;
  }
  
  .change-mode-dialog .p-dialog-header {
    padding: 1rem !important;
    border-radius: 0 !important;
  }
  
  .change-mode-dialog .p-dialog-footer {
    padding: 0.75rem 1rem !important;
    flex-direction: column !important;
    gap: 0.5rem !important;
    border-radius: 0 !important;
  }
  
  .modal-btn-cancel,
  .modal-btn-confirm,
  .modal-btn-warning,
  .modal-btn-disabled,
  .modal-btn-operation {
    width: 100% !important;
    min-width: auto !important;
    margin-bottom: 0;
  }
}

/* Для очень маленьких экранов */
@media (max-width: 480px) {
  .change-mode-dialog .p-dialog {
    width: 100vw !important;
    height: 100vh !important;
  }
  
  .change-mode-dialog .p-dialog-content {
    padding: 0.75rem !important;
  }
  
  .change-mode-dialog .p-dialog-header {
    padding: 0.75rem !important;
  }
  
  .change-mode-dialog .p-dialog-footer {
    padding: 0.5rem !important;
  }
}

/* Безопасные зоны для iPhone */
@supports(padding: max(0px)) {
  .change-mode-dialog .p-dialog {
    padding-left: env(safe-area-inset-left) !important;
    padding-right: env(safe-area-inset-right) !important;
    padding-top: env(safe-area-inset-top) !important;
    padding-bottom: env(safe-area-inset-bottom) !important;
  }
  
  .change-mode-dialog .p-dialog-content {
    padding-left: max(1rem, env(safe-area-inset-left)) !important;
    padding-right: max(1rem, env(safe-area-inset-right)) !important;
    padding-bottom: max(1rem, env(safe-area-inset-bottom)) !important;
  }
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
</style>