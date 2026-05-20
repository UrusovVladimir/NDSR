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


      <!-- Ошибка аутентификации -->
      <div v-if="authError" class="mb-3">
        <Message severity="error">
          <i class="pi pi-shield mr-2"></i>
          Authentication failed. Please check device credentials.
        </Message>
      </div>

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


      <div v-if="hasValidPassword && !authError" class="action-selection-section mb-4">
        <h6 class="section-title mb-3">Select Action:</h6>
        
        <!-- Router Mode -->
        <div v-if="shouldShowAction('router')" 
             class="action-option mb-3 p-3 border-1 surface-border border-round" 
             :class="{ 'action-option-active': selectedAction === 'router' }"
             @click="selectedAction = 'router'">
          <div class="option-content">
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
        </div>

        <!-- Extender Mode (без подключения) -->
        <div v-if="shouldShowAction('extender')"
             class="action-option mb-3 p-3 border-1 surface-border border-round"
             :class="{ 'action-option-active': selectedAction === 'extender' }"
             @click="selectedAction = 'extender'">
          <div class="option-content">
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
        </div>

        <!-- Extender + Connect -->
        <div v-if="shouldShowAction('extenderConnect')"
             class="action-option mb-3 p-3 border-1 surface-border border-round"
             :class="{ 'action-option-active': selectedAction === 'extenderConnect' }"
             @click="selectedAction = 'extenderConnect'">
          <div class="option-content">
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
        </div>

        <!-- Disconnect + Router Mode -->
      <div v-if="shouldShowAction('disconnectRouter')"
             class="action-option mb-3 p-3 border-1 surface-border border-round"
             :class="{ 'action-option-active': selectedAction === 'disconnectRouter' }"
             @click="selectedAction = 'disconnectRouter'">
          <div class="option-content">
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
      </div>

      <!-- Router Password Section (для connect/disconnect) -->
      <div v-if="(selectedAction === 'extenderConnect' || selectedAction === 'disconnectRouter') && hasValidPassword && !authError" 
           class="router-password-section mb-4">
        <h6 class="section-title mb-3">Router Authentication:</h6>
        
        <div class="password-toggle-section mb-3">
          <div class="horizontal-password-options">
            <!-- Device Password Option -->
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
                />
                <label for="useDevicePassword" class="password-label">
                  <div class="flex align-items-center mb-1">
                    <i class="pi pi-key mr-2 text-primary"></i>
                    <strong>Device Password</strong>
                  </div>
                  <small class="block text-color-secondary">
                    Same as Router
                  </small>
                </label>
              </div>
            </div>

            <!-- Manual Password Option -->
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

        <!-- Manual Password Input -->
        <div v-if="!useDevicePassword" class="manual-password-section">
          <div class="password-input-container">
            <label class="text-sm font-semibold mb-2 block">Router Password:</label>
            <form @submit.prevent>
              <!-- Используем видимое, но стилизованное как скрытое поле (screen-reader only) -->
              <div style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0;">
                <label for="username">Username</label>
                <input 
                  type="text" 
                  id="username"
                  name="username" 
                  value="admin" 
                  autocomplete="username"
                  readonly
                />
              </div>
              
              <!-- Поле для нового пароля -->
              <Password 
                v-model="manualRouterPassword" 
                :feedback="false" 
                placeholder="Enter router password"
                class="w-full router-password-input"
                toggleMask
                :inputProps="{ 
                  autocomplete: 'new-password',
                  id: 'new-password'
                }"
              />
            </form>
          </div>
        </div>
        <!-- Device Password Info -->
        <div v-else class="password-info-section">
          <div class="info-message p-2 border-round bg-green-50 border-1 border-green-200">
            <div class="flex align-items-center">
              <i class="pi pi-check-circle text-green-600 mr-2"></i>
              <span class="text-green-700">
                Will use device password
              </span>
            </div>
          </div>
        </div>
      </div>
      <!-- Disconnect Router Selection -->
      <div v-if="selectedAction === 'disconnectRouter' && hasValidPassword && !authError" 
          class="router-selection-section mb-4">
        <h6 class="section-title mb-2">Select Router to Disconnect From:</h6>
        <Dropdown 
          v-model="selectedRouterId" 
          :options="availableRoutersFormatted"
          optionLabel="displayName"
          optionValue="id"
          placeholder="Select a router..."
          class="w-full router-dropdown"
          panelClass="modal-dropdown-panel"
        />
      </div>

      <!-- Connect Router Selection -->
      <div v-if="selectedAction === 'extenderConnect' && hasValidPassword && !authError" 
          class="router-selection-section mb-4">
        <h6 class="section-title mb-2">Select Router to Connect:</h6>
        <Dropdown 
          v-model="selectedRouterId" 
          :options="availableRoutersFormatted"
          optionLabel="displayName"
          optionValue="id"
          placeholder="Select a router..."
          class="w-full router-dropdown"
          panelClass="modal-dropdown-panel"
        />
        <div v-if="!selectedRouterId" class="text-orange-500 text-sm mt-2">
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
          <div><strong>Password:</strong> {{ devicePassword ? `'${devicePassword}'` : 'None' }} ({{ passwordSource }})</div>
          <div><strong>Auth Error:</strong> {{ authError }}</div>
          <div><strong>Current Mode:</strong> {{ currentDeviceBaseMode || 'Unknown' }}</div>
          <div><strong>Available Routers:</strong> {{ availableRoutersFormatted.length }}</div>
        </div>
      </div>
    </div>
    
    <div v-else-if="!currentDevice" class="text-center p-4">
      <ProgressSpinner />
      <div class="mt-2 text-color-secondary">Loading device information...</div>
    </div>

    <template #footer>
      <Button 
        label="Cancel" 
        icon="pi pi-times" 
        @click="closeModal" 
        class="p-button-secondary modal-btn-cancel"
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
        label="No Password Available" 
        icon="pi pi-lock" 
        disabled
        class="p-button-outlined modal-btn-disabled"
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
import ProgressSpinner from 'primevue/progressspinner'
import Chip from 'primevue/chip'
import Message from 'primevue/message'
import Password from 'primevue/password' 

const toast = useToast()
const modeStore = useModeStore()
const deviceStore = useDeviceStore()
const emit = defineEmits(['modeChanged', 'operationStarted'])
const props = defineProps({
  device: {
    type: Object,
    default: null
  }
})

// ========== СОСТОЯНИЯ ==========


const visible = ref(false)
const selectedAction = ref('router')
const selectedRouterId = ref('')
const isLoading = ref(false)
const modeCheckInProgress = ref(false)
const devicePassword = ref('')
const passwordSource = ref('global')
const authError = ref(false)
const useDevicePassword = ref(true)
const manualRouterPassword = ref('')
const isMobile = ref(false)
const currentDevice = ref(null)
const debugInfo = ref('')
const showDebug = ref(false)
const todayPassword = inject('todayPassword')

// ========== COMPUTED ==========
const hasValidPassword = computed(() => {
  return devicePassword.value && 
        devicePassword.value.trim() !== '' && 
        devicePassword.value !== 'Loading...'
})

const modalTitle = computed(() => {
  if (!currentDevice.value) return 'Device Mode'
  return `Device Mode - ${currentDevice.value.shortName} ${currentDevice.value.hwId}`
})

const currentDeviceModeInfo = computed(() => {
  if (!currentDevice.value) return null
  return modeStore.getDeviceModeInfo(currentDevice.value.id)
})

const currentDeviceBaseMode = computed(() => {
  const modeInfo = currentDeviceModeInfo.value
  if (!modeInfo) {
    return hasValidPassword.value && !authError.value ? 'router' : null
  }
  return modeInfo.mode
})

const hasRouterConnection = computed(() => {
  const modeInfo = currentDeviceModeInfo.value
  return modeInfo && (
    modeInfo.mode === 'extender_connect' || 
    (modeInfo.mode === 'extender' && modeInfo.routerId)
  )
})

const connectedRouterId = computed(() => {
  const modeInfo = currentDeviceModeInfo.value
  return modeInfo?.routerId || null
})

const mwsStatus = computed(() => {
  return modeStore.mwsStatus || 'No MWS status'
})

// ========== ФИЛЬТРАЦИЯ РОУТЕРОВ ==========
const availableRoutersFormatted = computed(() => {
  return deviceStore.devices
    .filter(device => {
      const isRouter = device.type === 'router'
      const isOnline = device.statusCode === 200
      const isNotCurrentDevice = device.id !== currentDevice.value?.id
      return isRouter && isOnline && isNotCurrentDevice
    })
    .map(router => ({
      id: router.id,
      displayName: `${router.hwId} ${router.shortName}`
    }))
})

// ========== ЛОГИКА ОТОБРАЖЕНИЯ ДЕЙСТВИЙ ==========
const shouldShowAction = (action) => {
  if (!hasValidPassword.value || authError.value) return true
  
  const baseMode = currentDeviceBaseMode.value
  const hasConnection = hasRouterConnection.value
  const connectedRouter = connectedRouterId.value
  
  if (baseMode === 'extender_connect' || (baseMode === 'extender' && hasConnection)) {
    switch (action) {
      case 'disconnectRouter': return true
      case 'router':
      case 'extender':
      case 'extenderConnect':
        return false
      default: return false
    }
  }
  
  switch (action) {
    case 'router':
      return !(baseMode === 'router' && !hasConnection)
    case 'extender':
      return !(baseMode === 'extender' && !hasConnection)
    case 'extenderConnect':
      return !(baseMode === 'extender_connect' || (baseMode === 'extender' && hasConnection))
    case 'disconnectRouter':
      return (baseMode === 'extender_connect' || (baseMode === 'extender' && hasConnection && connectedRouter))
    default:
      return true
  }
}

const canConfirm = computed(() => {
  if (!hasValidPassword.value || modeCheckInProgress.value || isLoading.value) return false
  if (!shouldShowAction(selectedAction.value)) return false
  if (selectedAction.value === 'extenderConnect') return !!selectedRouterId.value
  if (selectedAction.value === 'disconnectRouter') return !!selectedRouterId.value
  return !!selectedAction.value
})

const canConfirmAuthError = computed(() => {
  if (!hasValidPassword.value || !authError.value || modeCheckInProgress.value || isLoading.value) return false
  if (selectedAction.value === 'extenderConnect') return !!selectedRouterId.value
  if (selectedAction.value === 'disconnectRouter') return !!selectedRouterId.value
  return !!selectedAction.value
})

const confirmButtonText = computed(() => {
  if (authError.value) return 'Try Change Mode Anyway'
  
  const baseMode = currentDeviceBaseMode.value
  const hasConnection = hasRouterConnection.value
  
  if (baseMode === 'extender_connect' || (baseMode === 'extender' && hasConnection)) {
    switch (selectedAction.value) {
      case 'disconnectRouter': return 'Disconnect & Switch to Router'
      case 'router': return 'Switch to Router Mode'
      default: return 'Confirm'
    }
  }
  
  switch (selectedAction.value) {
    case 'router': 
      return baseMode === 'router' && !hasConnection ? 'Device is already in Router Mode' : 'Switch to Router Mode'
    case 'extender': 
      return baseMode === 'extender' && !hasConnection ? 'Device is already in Extender Mode' : 'Switch to Extender Mode'
    case 'extenderConnect': 
      return baseMode === 'extender_connect' && hasConnection ? 'Reconnect Extender to Router' : 'Switch to Extender & Connect'
    case 'disconnectRouter':
      return 'Disconnect & Switch to Router'
    default: return 'Confirm'
  }
})

const showWarning = computed(() => {
  if (!hasValidPassword.value || authError.value || modeCheckInProgress.value || isLoading.value) return false
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

// ========== СТАТУС РЕЖИМА ==========
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

// ========== МЕТОДЫ ==========
const show = async (password, source = 'global') => {
  devicePassword.value = password
  useDevicePassword.value = true
  manualRouterPassword.value = ''
  passwordSource.value = source
  authError.value = false
  selectedAction.value = 'router'
  selectedRouterId.value = ''
  modeCheckInProgress.value = false
  isLoading.value = false
  debugInfo.value = ''
  
  currentDevice.value = props.device
  visible.value = true

  if (hasValidPassword.value && currentDevice.value) {
    await loadCurrentMode()
  }

  if (currentDevice.value) {
    const savedMode = modeStore.getDeviceModeInfo(currentDevice.value.id)
    if (savedMode?.routerId) {
      selectedRouterId.value = savedMode.routerId
    }
    autoSelectActionBasedOnMode(savedMode)
  }
}

const autoSelectActionBasedOnMode = (modeInfo) => {
  if (!modeInfo) return
  
  const mode = modeInfo.mode
  const hasConnection = modeInfo.routerId
  
  if (mode === 'extender_connect' || (mode === 'extender' && hasConnection)) {
    selectedAction.value = 'disconnectRouter'
  } else if (mode === 'router' && !hasConnection) {
    selectedAction.value = 'router'
  } else if (mode === 'extender' && !hasConnection) {
    selectedAction.value = 'extender'
  }
}

const loadCurrentMode = async () => {
  if (!hasValidPassword.value || !currentDevice.value) return
  
  modeCheckInProgress.value = true
  authError.value = false
  
  try {
    const existingModeInfo = modeStore.getDeviceModeInfo(currentDevice.value.id)
    const existingMode = existingModeInfo?.mode
    const existingRouterId = existingModeInfo?.routerId
    
    if (existingMode === 'extender_connect' && existingRouterId) {
      authError.value = false
      return
    }
    
    const detectedMode = await modeStore.getCurrentMode(currentDevice.value.id, devicePassword.value)
    
    let finalMode = detectedMode
    let finalRouterId = existingRouterId
    
    if (existingMode === 'extender_connect' && detectedMode === 'extender' && existingRouterId) {
      finalMode = 'extender_connect'
    } else if (detectedMode === 'router') {
      finalRouterId = null
    }
    
    modeStore.updateDeviceMode(currentDevice.value.id, {
      mode: finalMode,
      routerId: finalRouterId,
      timestamp: Date.now()
    })
    
    authError.value = false
    
  } catch (error) {
    console.log('❌ Error getting current mode:', error.message)
    
    const existingModeInfo = modeStore.getDeviceModeInfo(currentDevice.value.id)
    if (existingModeInfo) {
      // сохраняем существующие данные
    }
    
    if (error.message.includes('401') || error.message.includes('authentication')) {
      authError.value = true
      toast.add({ 
        severity: 'error', 
        summary: 'Authentication Failed', 
        detail: 'Cannot determine current mode due to authentication issues', 
        life: 5000 
      })
    } else if (error.message.includes('timeout')) {
      toast.add({ 
        severity: 'warn', 
        summary: 'Device Timeout', 
        detail: 'Device is slow to respond. Mode detection failed.', 
        life: 5000 
      })
    }
  } finally {
    modeCheckInProgress.value = false
  }
}

const confirmAction = async () => {
  if ((!canConfirm.value && !authError.value) || (!canConfirmAuthError.value && authError.value)) return
  
  if (!currentDevice.value) {
    toast.add({ 
      severity: 'error', 
      summary: 'Error', 
      detail: 'Device information is missing', 
      life: 5000 
    })
    return
  }
  
  isLoading.value = true
  
  try {
    let mode, routerId, action = null
    
    switch (selectedAction.value) {
      case 'router':
        mode = 'router'
        routerId = null
        break
      case 'extender':
        mode = 'extender' 
        routerId = null
        action = 'wan_off'
        break
      case 'extenderConnect':
        mode = 'extender_connect'
        routerId = selectedRouterId.value
        action = 'wan_off'
        break
      case 'disconnectRouter':
        mode = 'extender_disconnect'
        routerId = selectedRouterId.value
        break
      default:
        throw new Error('Invalid action selected')
    }
    
    let routerPasswordToUse = null
    if (selectedAction.value === 'extenderConnect' || selectedAction.value === 'disconnectRouter') {
      if (useDevicePassword.value) {
        routerPasswordToUse = devicePassword.value
      } else if (manualRouterPassword.value) {
        routerPasswordToUse = manualRouterPassword.value
      }
    }
    
    const deviceId = currentDevice.value.id
    
  emit('operationStarted', {
    deviceId: deviceId,
    operationType: 'modeChange',
    operationData: {
      oldMode: currentDeviceBaseMode.value || 'unknown',
      newMode: mode,
      routerId: routerId,
      action: selectedAction.value
    }
  })
    
    // ✅ НЕБОЛЬШАЯ ЗАДЕРЖКА, ЧТОБЫ МОДАЛКА УСПЕЛА ОТКРЫТЬСЯ
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // ✅ ПОСЛЕ ОТКРЫТИЯ МОДАЛКИ ОТПРАВЛЯЕМ ЗАПРОС
    const result = await modeStore.changeMode(
      deviceId,
      mode,
      routerId, 
      devicePassword.value,
      routerPasswordToUse,
      action
    )
    
    if (result.success) {
      let successMessage = `Device mode successfully changed to ${mode}`
      if (result.mwsConnected) {
        successMessage += ` and connected to ${routerId} via MWS`
      }
      
      emit('modeChanged', {
        deviceId: deviceId,
        mode: mode,
        routerId: routerId,
        action: selectedAction.value,
        mwsConnected: result.mwsConnected || false,
        passwordUsed: useDevicePassword.value ? 'device' : 'manual'
      })
      closeModal()
      
    } else {
      throw new Error(result.message)
    }
    
  } catch (error) {
    console.error('Action failed:', error)
    toast.add({ severity: 'error', summary: 'Operation Failed', detail: error.message, life: 5000 })
  } finally {
    isLoading.value = false
  }
}

const closeModal = () => {
  fullCleanup()
  visible.value = false
}

const fullCleanup = () => {
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
  isLoading.value = false
}

// ========== DEBUG ==========
const testModeDetection = async () => {
  if (!hasValidPassword.value || !currentDevice.value) return
  
  debugInfo.value = 'Testing mode detection via store...'
  
  try {
    const mode = await modeStore.getCurrentMode(currentDevice.value.id, devicePassword.value, { forceRefresh: true })
    debugInfo.value = `✅ Success! Mode: ${mode}`
    toast.add({ severity: 'success', summary: 'Mode Detection Test', detail: `Mode detected: ${mode}`, life: 3000 })
  } catch (error) {
    debugInfo.value = `❌ Store error: ${error.message}`
    let errorDetail = error.message
    if (error.message.includes('401') || error.message.includes('authentication')) {
      errorDetail = 'Authentication failed. Please check the device password.'
    } else if (error.message.includes('timeout')) {
      errorDetail = 'Device timeout. Device may be offline or slow to respond.'
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

const showDebugSection = () => {
  showDebug.value = !showDebug.value
}

// ========== МОБИЛЬНАЯ АДАПТАЦИЯ ==========
const checkMobile = () => {
  isMobile.value = window.innerWidth <= 768
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


// ========== WATCHERS ==========
watch(selectedAction, (newAction) => {
  if (newAction !== 'extenderConnect' && newAction !== 'disconnectRouter') {
    selectedRouterId.value = ''
  }
})

watch(
  () => currentDeviceModeInfo.value,
  (newModeInfo) => {
    if (currentDevice.value && visible.value && newModeInfo) {
      if (newModeInfo.routerId && hasRouterConnection.value) {
        selectedRouterId.value = newModeInfo.routerId
      }
    }
  },
  { deep: true }
)

// ========== LIFECYCLE ==========
onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  fullCleanup()
})

defineExpose({ show })
</script>

<style scoped>
.change-mode-modal {
  min-height: 200px;
}

.action-option {
  cursor: pointer;
  border-radius: 16px !important;
  border: 1.5px solid var(--surface-300);
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.action-option::before,
.action-option::after {
  border-radius: inherit;
}

.option-content {
  display: flex;
  align-items: flex-start;
  padding: 0.875rem 0.5rem;
  width: 100%;
  gap: 0.75rem;
}

.action-radio {
  margin-top: 0.125rem;
  flex-shrink: 0;
}

.action-radio :deep(.p-radiobutton-box) {
  width: 18px;
  height: 18px;
}

.action-radio :deep(.p-radiobutton-box.p-highlight) {
  border-color: var(--primary-500);
  background: var(--primary-500);
}

.action-label {
  cursor: pointer;
  flex: 1;
  margin: 0;
}

.action-label .flex.align-items-center {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.action-label .flex.align-items-center i {
  font-size: 1.1rem; /* Немного уменьшенные иконки */
}

.action-label .flex.align-items-center strong {
  font-size: 0.95rem; /* Уменьшенный размер шрифта */
  font-weight: 600;
  color: var(--text-color);
}

.action-label small {
  display: block;
  font-size: 0.8rem; /* Уменьшенный размер шрифта */
  color: var(--text-color-secondary);
  line-height: 1.4;
  margin-left: 1.6rem; /* Выравнивание с текстом */
}

/* Специфические стили для иконок */
.bi-router {
  color: var(--primary-600);
}

.pi-wifi {
  color: var(--green-600);
}

.pi-broadcast,
.pi-link {
  color: var(--green-600);
}

.pi-chain-broken {
  color: var(--red-600);
}

.bi-router.mr-1 {
  color: var(--primary-600);
}

/* Адаптация для мобильных */
@media (max-width: 768px) {
  .action-option {
    border-radius: 14px;
    margin-bottom: 0.5rem;
  }
  
  .option-content {
    padding: 0.75rem;
  }
  
  .action-label .flex.align-items-center strong {
    font-size: 0.9rem;
  }
  
  .action-label small {
    font-size: 0.75rem;
    margin-left: 1.4rem;
  }
  
  .action-radio :deep(.p-radiobutton-box) {
    width: 16px;
    height: 16px;
  }
}

/* Для очень маленьких экранов */
@media (max-width: 480px) {
  .action-option {
    border-radius: 12px;
  }
  
  .option-content {
    padding: 0.625rem;
  }
}

/* Анимация появления */
.action-option {
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.section-title {
  font-weight: 600;
  margin-bottom: 0.75rem;
  color: var(--text-color);
  font-size: 0.95rem;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  opacity: 0.8;
  line-height: 1.2;
}
/* Улучшенные тени для активного состояния */
.action-option-active {
  border-color: var(--primary-500) !important;
  background: linear-gradient(135deg, var(--primary-50) 0%, #ffffff 100%);
  box-shadow: 0 6px 14px rgba(var(--primary-500-rgb, 33, 150, 243), 0.12);
}

.action-option-active .bi-router,
.action-option-active .pi-wifi,
.action-option-active .pi-broadcast,
.action-option-active .pi-link,
.action-option-active .pi-chain-broken {
  filter: brightness(0.9);
}

.action-option-active .pi-wifi,
.action-option-active .pi-broadcast,
.action-option-active .pi-link {
  color: var(--green-700);
}

.action-option-active .pi-chain-broken {
  color: var(--red-700);
}
/* Секции */
.current-mode-section {
  padding: 0.75rem;
  background: var(--surface-50);
  border-radius: 8px;
  border: 1px solid var(--surface-200);
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

/* Password options */
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
}

.manual-password-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--surface-200);
  position: relative;
  min-height: 80px; 
}

.info-message {
  border-left: 4px solid #28a745;
}

/* Status indicators */
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

/* Footer buttons */
.modal-btn-cancel,
.modal-btn-confirm,
.modal-btn-warning,
.modal-btn-disabled {
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

/* Mobile */
@media (max-width: 768px) {
  .change-mode-modal {
    padding: 0.25rem;
  }
  
  .horizontal-password-options {
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .password-option.horizontal-option {
    width: 100%;
  }
  
  .action-option {
    padding: 0.5rem;
  }
  
  .modal-btn-cancel,
  .modal-btn-confirm,
  .modal-btn-warning,
  .modal-btn-disabled {
    width: 100% !important;
    min-width: auto !important;
  }
}

/* Простые и рабочие стили для dropdown */
.router-dropdown {
  position: relative;
}

/* Панель dropdown будет позиционироваться автоматически */
:deep(.modal-dropdown-panel) {
  z-index: 10001 !important;
  max-height: 200px !important;
}

/* Убираем конфликтующие стили */
.change-mode-dialog :deep(.p-dialog-content) {
  overflow-y: auto !important;
}

</style>