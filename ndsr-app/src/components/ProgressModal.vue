<template>
    <Dialog 
      v-model:visible="visible" 
      :modal="true" 
      :closable="userCanClose"
      :closeOnEscape="userCanClose"
      :dismissableMask="userCanClose"
      :header="modalHeader"
      :blockScroll="true"
      :style="{ width: mobileView ? '95vw' : '550px' }"
      class="universal-progress-modal"
    >
      <div class="progress-content">
        <!-- Информация об операции -->
        <div class="operation-info-section">
          <div class="operation-type-badge" :class="operationTypeClass">
            <i :class="operationIcon"></i>
            <span>{{ operationTypeText }}</span>
          </div>
          <div class="device-info">
            <div class="device-name">{{ localDevice?.shortName }}</div>
            <div class="device-hwid">{{ localDevice?.hwId }}</div>
            <div class="operation-details" v-if="operationDetails">
              {{ operationDetails }}
            </div>
          </div>
        </div>
  
        <!-- Основной прогресс -->
        <div class="main-progress-section">
          <div class="progress-info">
            <i :class="statusIcon" class="status-icon" :style="{ color: statusColor }"></i>
            <div class="progress-text">
              <div class="progress-title">{{ currentStepTitle }}</div>
              <div class="progress-subtitle">{{ currentStepDescription }}</div>
            </div>
            <div class="progress-percent">{{ Math.round(progress) }}%</div>
          </div>
          
          <ProgressBar 
            :value="progress" 
            :showValue="false"
            :class="progressBarClass"
            class="main-progress-bar"
          />
          
          <div class="progress-details">
            <span class="progress-time" v-if="estimatedTime > 0">
              ~{{ estimatedTime }}s remaining
            </span>
            <span class="device-status" v-if="deviceStatus > 0">
              <i class="pi pi-wifi" :class="deviceStatus === 200 ? 'online' : 'offline'"></i>
              Device {{ deviceStatus === 200 ? 'online' : 'booting' }}
            </span>
          </div>
        </div>
  
        <!-- Детализированные шаги -->
        <div class="steps-section">
          <div 
            v-for="step in stepsList" 
            :key="step.id"
            class="step-item"
            :class="{
              'step-completed': step.status === 'completed',
              'step-current': step.status === 'current',
              'step-pending': step.status === 'pending',
              'step-error': step.status === 'error'
            }"
          >
            <div class="step-indicator">
              <i class="pi pi-check" v-if="step.status === 'completed'"></i>
              <i class="pi pi-spin pi-spinner" v-else-if="step.status === 'current'"></i>
              <i class="pi pi-exclamation-triangle" v-else-if="step.status === 'error'"></i>
              <i class="pi pi-circle" v-else></i>
            </div>
            <div class="step-content">
              <div class="step-title">{{ step.title }}</div>
              <div class="step-description">{{ step.description }}</div>
              <div class="step-details" v-if="step.details && (step.status === 'current' || step.status === 'completed')">
                {{ step.details }}
              </div>
              <div class="step-error" v-if="step.status === 'error'">
                {{ step.error }}
              </div>
            </div>
          </div>
        </div>
  
        <!-- Лог операций -->
        <div class="log-section" v-if="operationLog.length > 0">
          <div class="log-header">
            <span>Operation Log</span>
            <Button 
              icon="pi pi-times" 
              class="p-button-text p-button-sm" 
              @click="clearLog"
              v-tooltip="'Clear log'"
            />
          </div>
          <div class="log-content">
            <div 
              v-for="(log, index) in operationLog" 
              :key="index"
              class="log-entry"
              :class="`log-${log.type}`"
            >
              <i :class="getLogIcon(log.type)"></i>
              <span class="log-time">{{ log.time }}</span>
              <span class="log-message">{{ log.message }}</span>
            </div>
          </div>
        </div>
  
        <!-- Сообщения -->
        <Message v-if="hasErrors" severity="error" class="error-message">
          <div class="message-content">
            <i class="pi pi-exclamation-triangle"></i>
            <div>
              <div><strong>Operation completed with errors</strong></div>
              <div>Some steps may not have completed successfully</div>
            </div>
          </div>
        </Message>
  
        <Message v-if="showWarning && !userCanClose" severity="warn" class="warning-message">
          <div class="message-content">
            <div>
              <div><strong>Operation in progress</strong></div>
              <div>Closing this window will not cancel the operation</div>
            </div>
          </div>
        </Message>
  
        <Message v-if="progress >= 100 && !hasErrors" severity="success" class="success-message">
          <div class="message-content">
            <i class="pi pi-check-circle"></i>
            <div>
              <div><strong>Operation completed successfully!</strong></div>
              <div>{{ successMessage }}</div>
            </div>
          </div>
        </Message>
      </div>
  
      <template #footer>
        <div class="progress-footer">
          <div class="footer-info">
            <i class="pi pi-clock footer-clock"></i>
            <small>Started: {{ startTimeFormatted }}</small>
            <small v-if="estimatedTime > 0">• Est: {{ estimatedTime }}s</small>
          </div>
          
          <Button 
            :label="getCloseButtonLabel()" 
            :icon="closeButtonIcon"
            @click="handleClose" 
            :class="footerButtonClass"
            :disabled="!userCanClose && !forceCloseAvailable"
            :loading="closingInProgress"
            size="small"
          />
        </div>
      </template>
    </Dialog>
  </template>
  
<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import ProgressBar from 'primevue/progressbar'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { socket } from '@/socket'
import { useDeviceStore } from '../stores/useDeviceStore'

const toast = useToast()
// console.log('📊 ProgressModal component loaded');
const deviceStore = useDeviceStore()

const getRouterName = (routerId) => {
  if (!routerId) return "Unknown Router name";
  const router = deviceStore.devices.find(d => d.id === routerId);
  return router ? `${router.hwId}(${router.shortName})`: `Router ${routerId}`;
}

const props = defineProps({
  device: {
    type: Object,
    default: null
  },
  operationType: {
    type: String,
    default: 'mwsConnection'
  },
  operationData: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['close', 'completed', 'cancelled'])

// ✅ ЛОКАЛЬНЫЕ КОПИИ
const localDevice = ref(null)
const localOperationType = ref('')
const localOperationData = ref({})

// Reactive state
const visible = ref(false)
const progress = ref(0)
const currentStepId = ref('')
const deviceStatus = ref(0)
const startTime = ref(null)
const userClosed = ref(false)
const closingInProgress = ref(false)
const operationCompleted = ref(false)
const hasErrors = ref(false)
const operationLog = ref([])

// Для защиты от дублирующихся событий
const lastProgressData = ref(null);
const lastProgressTime = ref(0);

// ✅ СПИСОК ШАГОВ С СОСТОЯНИЯМИ
const stepsList = ref([])

const operationConfigs = {
  mwsApConnection: {
    title: 'MWS AP Connection',
    icon: 'pi pi-wifi',
    badgeClass: 'ap-connection-badge',
    getSteps: (operationData) => {
      const isDisconnect = operationData?.action === 'disconnect';
      
      if (isDisconnect) {
        return [
          { id: 'initializing', title: 'Initializing', description: 'Preparing disconnection' },
          { id: 'switch_config', title: 'Switch Configuration', description: 'Removing MWS configuration' },
          { id: 'port_forwarding', title: 'Port Forwarding', description: 'Removing firewall rules' },
          { id: 'verification', title: 'Verification', description: 'Checking disconnection status' },
          { id: 'completed', title: 'Completed', description: 'Disconnection finished' }
        ];
      } else {
        return [
          { id: 'initializing', title: 'Initializing', description: 'Validating devices and parameters' },
          { id: 'switch_config', title: 'Switch Configuration', description: 'Setting up MWS on switch' },
          { id: 'port_forwarding', title: 'Port Forwarding', description: 'Configuring firewall rules' },
          { id: 'verification', title: 'Verification', description: 'Checking connection status' },
          { id: 'completed', title: 'Completed', description: 'Connection established' }
        ];
      }
    },
    successMessage: (operationData) => {
      return operationData?.action === 'disconnect' 
        ? 'AP disconnected successfully' 
        : 'AP connected successfully';
    }
  },
  
  mwsConnection: {
    title: 'MWS Connection',
    icon: 'pi pi-link',
    badgeClass: 'connect-badge',
    getSteps: (operationData) => {
      const isDisconnect = operationData?.action === 'disconnect';
      
      if (isDisconnect) {
        return [
          { id: 'initializing', title: 'Initializing', description: 'Preparing disconnection' },
          { id: 'switch_config', title: 'Switch Configuration', description: 'Removing MWS configuration' },
          { id: 'port_forwarding', title: 'Port Forwarding', description: 'Removing firewall rules' },
          { id: 'device_reboot', title: 'Device Reboot', description: 'Restarting device' },
          { id: 'verification', title: 'Verification', description: 'Checking disconnection status' },
          { id: 'completed', title: 'Completed', description: 'Disconnection finished' }
        ];
      } else {
        return [
          { id: 'initializing', title: 'Initializing', description: 'Validating devices and parameters' },
          { id: 'switch_config', title: 'Switch Configuration', description: 'Setting up MWS on switch' },
          { id: 'port_forwarding', title: 'Port Forwarding', description: 'Configuring firewall rules' },
          { id: 'ap_dhcp', title: 'AP DHCP Setup', description: 'Waiting for IP assignment' },
          { id: 'verification', title: 'Verification', description: 'Checking connection status' },
          { id: 'completed', title: 'Completed', description: 'Connection established' }
        ];
      }
    },
    successMessage: (operationData) => {
      return operationData?.action === 'disconnect' 
        ? 'Device disconnected successfully' 
        : 'MWS connection established successfully';
    }
  },
  
modeChange: {
  title: 'Mode Change',
  icon: 'pi pi-cog',
  badgeClass: 'mode-change-badge',
  getSteps: (operationData) => {
    if (operationData?.action === 'disconnect') {
      return [
        { id: 'initializing', title: 'Initializing', description: 'Preparing disconnection' },
        { id: 'applying_config', title: 'Applying Configuration', description: 'Sending disconnect command' },
        { id: 'rebooting', title: 'Device Rebooting', description: 'Restarting with new mode' },
        { id: 'waiting_online', title: 'Waiting for Device', description: 'Monitoring device status' },
        { id: 'finalizing', title: 'Finalizing', description: 'Completing mode transition' },
        { id: 'completed', title: 'Completed', description: 'Mode change finished' }
      ];
    } else {
      const newMode = operationData?.newMode;
      const WanOff = newMode === 'extender' || newMode === 'extender_connect';
      
      if (WanOff) {
        return [
          { id: 'initializing', title: 'Initializing', description: 'Preparing mode change' },
          { id: 'applying_config', title: 'Applying Configuration', description: 'Sending new settings' },
          { id: 'wan_off', title: 'WAN Configuration', description: `Disabling WAN interface for ${localDevice.value?.hwId} and setup Port forward` },
          { id: 'rebooting', title: 'Device Rebooting', description: 'Restarting with new mode' },
          { id: 'waiting_online', title: 'Waiting for Device', description: 'Monitoring device status' },
          { id: 'finalizing', title: 'Finalizing', description: 'Completing mode transition' },
          { id: 'completed', title: 'Completed', description: 'Mode change finished' }
        ];
      } else {
        return [
          { id: 'initializing', title: 'Initializing', description: 'Preparing mode change' },
          { id: 'applying_config', title: 'Applying Configuration', description: 'Sending new settings' },
          { id: 'rebooting', title: 'Device Rebooting', description: 'Restarting with new mode' },
          { id: 'waiting_online', title: 'Waiting for Device', description: 'Monitoring device status' },
          { id: 'finalizing', title: 'Finalizing', description: 'Completing mode transition' },
          { id: 'completed', title: 'Completed', description: 'Mode change finished' }
        ];
      }
    }
  },
  successMessage: (operationData) => {
    return operationData?.action === 'disconnect' 
      ? 'Device disconnected successfully' 
      : 'Mode changed successfully';
  }
}
}

const mobileView = computed(() => window.innerWidth <= 768)

const operationConfig = computed(() => {
  return operationConfigs[localOperationType.value] || operationConfigs.mwsConnection
})

const modalHeader = computed(() => {
  return `${operationConfig.value.title}: ${localDevice.value?.shortName || 'Device'}`
})

const operationTypeText = computed(() => {
  return operationConfig.value.title
})

const operationTypeClass = computed(() => {
  return operationConfig.value.badgeClass
})

const operationIcon = computed(() => {
  return operationConfig.value.icon
})

const operationDetails = computed(() => {
  if (localOperationType.value === 'modeChange') {
    const routerName = getRouterName(localOperationData.value?.routerId);
    const newMode = localOperationData.value?.newMode;
    const action = localOperationData.value?.action;
    
    if (action === 'disconnect' || newMode === 'extender_disconnect') {
      return `🔌 Disconnecting from ${routerName} → Switching to Router mode`;
    }
    
    if (newMode === 'extender_connect') {
      return `🔗 Switching to Extender mode → Connecting to ${routerName} (WAN will be disabled)`;
    }
    
    if (newMode === 'extender') {
      return `📡 Switching to Extender mode (standalone) (WAN will be disabled)`;
    }
    
    if (newMode === 'router') {
      return `🌐 Switching to Router mode (WAN remains as is)`;
    }
    
    return `Changing mode: ${localOperationData.value?.oldMode || '?'} → ${newMode || '?'}`;
    
  } else if (localOperationType.value === 'mwsConnection') {
    const routerName = getRouterName(localOperationData.value?.routerId);
    return localOperationData.value?.action === 'disconnect' 
      ? `🔌 Disconnecting from ${routerName}` 
      : `🔗 Connecting to ${routerName}`;
  }
  
  return '';
});

const statusIcon = computed(() => {
  if (hasErrors.value) return 'pi pi-exclamation-triangle'
  if (progress.value >= 100) return 'pi pi-check-circle'
  if (deviceStatus.value === 200) return 'pi pi-wifi'
  return 'pi pi-spin pi-spinner'
})

const statusColor = computed(() => {
  if (hasErrors.value) return 'var(--red-500)'
  if (progress.value >= 100) return 'var(--green-500)'
  if (deviceStatus.value === 200) return 'var(--blue-500)'
  return 'var(--primary-color)'
})

const progressBarClass = computed(() => {
  if (hasErrors.value) return 'p-progressbar-danger'
  if (progress.value >= 100) return 'p-progressbar-success'
  if (deviceStatus.value === 200) return 'p-progressbar-info'
  return ''
})

const currentStepTitle = computed(() => {
  const step = stepsList.value.find(s => s.id === currentStepId.value)
  return step?.title || 'Operation in progress...'
})

const currentStepDescription = computed(() => {
  const step = stepsList.value.find(s => s.id === currentStepId.value)
  return step?.description || 'Processing...'
})

const estimatedTime = computed(() => {
  if (!startTime.value || progress.value <= 0) return 0
  const elapsed = (Date.now() - startTime.value) / 1000
  const remaining = (elapsed / progress.value) * (100 - progress.value)
  return Math.max(0, Math.round(remaining))
})

const startTimeFormatted = computed(() => {
  return startTime.value ? new Date(startTime.value).toLocaleTimeString() : ''
})

const userCanClose = computed(() => {
  return progress.value >= 100 || operationCompleted.value
})

const forceCloseAvailable = computed(() => {
  return progress.value >= 70 || deviceStatus.value === 200
})

const showWarning = computed(() => {
  return progress.value > 0 && progress.value < 100 && !userCanClose.value
})

const successMessage = computed(() => {
  const config = operationConfig.value
  return typeof config.successMessage === 'function'
    ? config.successMessage(localOperationData.value)
    : config.successMessage
})

const footerButtonClass = computed(() => {
  if (hasErrors.value) return 'p-button-warning'
  if (progress.value >= 100) return 'p-button-success'
  if (userClosed.value) return 'p-button-warning'
  return 'p-button-secondary'
})

const closeButtonIcon = computed(() => {
  if (progress.value >= 100) return 'pi pi-check'
  if (hasErrors.value) return 'pi pi-exclamation-triangle'
  return 'pi pi-times'
})

// ✅ ФУНКЦИЯ ДЛЯ ИНИЦИАЛИЗАЦИИ ШАГОВ
const initializeSteps = () => {
  const config = operationConfig.value
  // console.log('📊 Initializing steps for operation:', {
  //   operationType: localOperationType.value,
  //   config: config,
  //   operationData: localOperationData.value
  // });
  
  const steps = typeof config.getSteps === 'function' 
    ? config.getSteps(localOperationData.value)
    : config.steps
  
  // console.log('📊 Steps generated:', steps);
  
  stepsList.value = steps.map((step, index) => ({
    ...step,
    status: index === 0 ? 'current' : 'pending',
    details: null,
    error: null
  }))
  
  currentStepId.value = steps[0]?.id || 'initializing'
  // console.log('📊 Initial step set to:', currentStepId.value);
}

// ✅ ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ СТАТУСА ШАГА
const updateStepStatus = (stepId, status, details = null, error = null) => {
  const stepIndex = stepsList.value.findIndex(s => s.id === stepId)
  if (stepIndex === -1) {
    // console.log('⚠️ Step not found:', stepId);
    return;
  }
  
  // console.log('📊 Updating step status:', { stepId, status, details });
  
  // Обновляем статус текущего шага
  stepsList.value[stepIndex].status = status
  if (details) stepsList.value[stepIndex].details = details
  if (error) stepsList.value[stepIndex].error = error
  
  // Если шаг завершен, следующий становится текущим
  if (status === 'completed') {
    const nextStep = stepsList.value[stepIndex + 1]
    if (nextStep) {
      nextStep.status = 'current'
      currentStepId.value = nextStep.id
      // console.log('📊 Next step set to:', nextStep.id);
    }
  }
}

// Methods
const show = (operationType = 'mwsConnection', device = null, operationData = {}) => {
  // console.log('📊 ProgressModal show called:', { operationType, device: device?.hwId, operationData });
  
  // Устанавливаем локальные копии
  localDevice.value = device
  localOperationType.value = operationType
  localOperationData.value = operationData
  
  // Сброс состояния
  visible.value = true
  progress.value = 0
  deviceStatus.value = 0
  startTime.value = Date.now()
  userClosed.value = false
  closingInProgress.value = false
  operationCompleted.value = false
  hasErrors.value = false
  operationLog.value = []
  
  // Сбрасываем защиту от дублей
  lastProgressData.value = null;
  lastProgressTime.value = 0;
  
  // Инициализируем шаги
  initializeSteps()
  
  addLog('info', `${operationConfig.value.title} started`)
  
  // Очищаем старые слушатели и устанавливаем новые
  cleanupListeners()
  setupListeners()
  
  if (localDevice.value?.id) {
    startDeviceMonitoring(localDevice.value.id)
  }
}

// Функция для очистки слушателей
const cleanupListeners = () => {
  socket.off('device:modeChangeProgress')
  socket.off('device:mwsOperationProgress')
  socket.off('device:operationProgress')
  socket.off('device:status')
  // console.log('🧹 Progress listeners cleaned up')
}

const setupListeners = () => {
  // console.log('📊 Setting up progress listeners for device:', localDevice.value?.id);
  
  // Удаляем все старые слушатели
  socket.off('device:mwsOperationProgress');
  socket.off('device:operationProgress');
  socket.off('device:modeChangeProgress');
  socket.off('device:status');
  
  // Добавляем новые слушатели
  socket.on('device:mwsOperationProgress', (data) => {
    // console.log('📊 ProgressModal RECEIVED device:mwsOperationProgress:', data);
    if (data.deviceId === localDevice.value?.id) {
      updateProgress(data.progress, data.step, data.details);
    }
  });

  socket.on('device:operationProgress', (data) => {
    // console.log('📊 ProgressModal RECEIVED device:operationProgress:', data);
    if (data.deviceId === localDevice.value?.id) {
      updateProgress(data.progress, data.step, data.details);
    }
  });

  socket.on('device:modeChangeProgress', (data) => {
    // console.log('📊 ProgressModal RECEIVED device:modeChangeProgress:', data);
    if (data.deviceId === localDevice.value?.id) {
      updateProgress(data.progress, data.step, data.details);
    }
  });
  
  // Добавляем глобальный слушатель для отладки
  socket.onAny((event, ...args) => {
    if (event.includes('progress') || event.includes('Progress')) {
      // console.log(`📡 GLOBAL: ${event}`, args[0]);
    }
  });
  
  console.log('📊 Progress listeners set up');
};

const updateProgress = (newProgress, step, details = null) => {
  // console.log('📥 ProgressModal updateProgress:', { 
  //   newProgress, 
  //   step, 
  //   details,
  //   currentStepId: currentStepId.value,
  //   availableSteps: stepsList.value.map(s => s.id)
  // });
  
  // Защита от дублирующихся событий
  const now = Date.now();
  const progressKey = `${newProgress}-${step}`;
  
  if (lastProgressData.value === progressKey && now - lastProgressTime.value < 2000) {
    // console.log('⚠️ Duplicate progress event ignored:', { newProgress, step });
    return;
  }
  
  lastProgressData.value = progressKey;
  lastProgressTime.value = now;
  
  // Обновляем прогресс (только если новое значение больше текущего)
  if (newProgress > progress.value) {
    progress.value = newProgress;
  }
  
  if (step) {
    // Проверяем, существует ли такой шаг в списке
    const stepExists = stepsList.value.some(s => s.id === step);
    
    if (!stepExists) {
      // console.log('⚠️ Step not found in stepsList:', step);
      
      // Пробуем найти шаг без учета регистра или с частичным совпадением
      const similarStep = stepsList.value.find(s => 
        s.id.toLowerCase() === step.toLowerCase() || 
        step.toLowerCase().includes(s.id.toLowerCase()) ||
        s.id.toLowerCase().includes(step.toLowerCase())
      );
      
      if (similarStep) {
        // console.log('✅ Found similar step:', similarStep.id);
        step = similarStep.id;
      } else {
        addLog('info', details || `Step: ${step} (${newProgress}%)`);
        return;
      }
    }
    
    // Находим текущий шаг
    const currentStep = stepsList.value.find(s => s.id === currentStepId.value);
    
    // Если это новый шаг, завершаем предыдущий
    if (currentStep && currentStep.id !== step) {
      const stepIndex = stepsList.value.findIndex(s => s.id === currentStep.id);
      if (stepIndex !== -1) {
        stepsList.value[stepIndex].status = 'completed';
        // console.log('✅ Completed step:', currentStep.id);
      }
    }
    
    // Делаем новый шаг текущим
    const targetStepIndex = stepsList.value.findIndex(s => s.id === step);
    if (targetStepIndex !== -1) {
      stepsList.value[targetStepIndex].status = 'current';
      currentStepId.value = step;
      addLog('info', `Started: ${stepsList.value[targetStepIndex].title}`);
      //  console.log('✅ Now current step:', step);
    }
    
    // Добавляем детали если есть
    if (details) {
      const stepWithDetails = stepsList.value.find(s => s.id === step);
      if (stepWithDetails) {
        stepWithDetails.details = details;
      }
      addLog('info', details);
    }
  }
  
  // Если прогресс достиг 100%, завершаем операцию
  if (newProgress >= 100) {
    // console.log('🎉 Operation completed!');
    completeOperation();
  }
};

const startDeviceMonitoring = (deviceId) => {
  socket.off('device:status')
  
  socket.on('device:status', (data) => {
    if (data.deviceId === deviceId) {
      deviceStatus.value = data.status
      
      if (data.status === 200) {
        addLog('success', 'Device is back online')
      }
    }
  })
  
  socket.emit('device:forceStatusCheck', deviceId, (response) => {
    if (response?.success) {
      console.log(`✅ Force status check completed: ${response.status}`)
    } else {
      console.log(`⚠️ Force status check failed: ${response?.error}`)
    }
  })
}

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

const getLogIcon = (type) => {
  const icons = {
    info: 'pi pi-info-circle',
    success: 'pi pi-check-circle',
    warning: 'pi pi-exclamation-triangle',
    error: 'pi pi-times-circle'
  }
  return icons[type] || 'pi pi-info-circle'
}

const clearLog = () => {
  operationLog.value = []
}

const completeOperation = () => {
  // console.log('🎉 Operation completed!');
  operationCompleted.value = true
  currentStepId.value = 'completed'
  
  // Завершаем все шаги
  stepsList.value.forEach(step => {
    if (step.id !== 'completed') {
      step.status = 'completed'
    }
  })
  
  // Добавляем шаг завершения если его нет
  if (!stepsList.value.find(s => s.id === 'completed')) {
    stepsList.value.push({
      id: 'completed',
      title: 'Completed',
      description: 'Operation finished',
      status: 'current',
      details: null,
      error: null
    })
  }
  
  addLog('success', operationConfig.value.successMessage)
  
  emit('completed')
  
  setTimeout(() => {
    if (visible.value && !userClosed.value) {
      // console.log('🔒 Auto-closing progress modal after 3 seconds');
      closeModal()
    }
  }, 3000)
}

const getCloseButtonLabel = () => {
  if (closingInProgress.value) return 'Closing...'
  if (progress.value >= 100) return 'Complete'
  if (hasErrors.value) return 'Close with Errors'
  if (userClosed.value) return 'Close Anyway'
  if (forceCloseAvailable.value) return 'Close Early'
  return 'Cancel'
}

const handleClose = async () => {
  if (progress.value >= 100 || hasErrors.value) {
    closeModal()
    return
  }

  if (!userClosed.value && !forceCloseAvailable.value) {
    closingInProgress.value = true
    const confirmed = await confirmEarlyClose()
    if (confirmed) {
      userClosed.value = true
      addLog('warning', 'Operation cancelled by user')
      emit('cancelled')
      closeModal()
    }
    closingInProgress.value = false
  } else {
    userClosed.value = true
    closeModal()
  }
}

const confirmEarlyClose = () => {
  return new Promise((resolve) => {
    const userConfirmed = confirm(
      `Operation for ${localDevice.value?.shortName} is still in progress (${Math.round(progress.value)}%).\n\n` +
      'The operation will continue in background.\n\n' +
      'Are you sure you want to close this window?'
    )
    resolve(userConfirmed)
  })
}

const closeModal = () => {
  visible.value = false
  emit('close')
  
  cleanupListeners()
  
  setTimeout(() => {
    progress.value = 0
    currentStepId.value = 'initializing'
    deviceStatus.value = 0
    userClosed.value = false
    closingInProgress.value = false
    operationCompleted.value = false
    hasErrors.value = false
    stepsList.value = []
    localDevice.value = null
    localOperationType.value = ''
    localOperationData.value = {}
  }, 300)
}

const setStepError = (stepId, errorMessage) => {
  hasErrors.value = true
  const step = stepsList.value.find(s => s.id === stepId)
  if (step) {
    step.status = 'error'
    step.error = errorMessage
  }
  addLog('error', `Error: ${errorMessage}`)
}

onUnmounted(() => {
  cleanupListeners()
})

defineExpose({ 
  show,
  updateProgress,
  setStepError,
  addLog,
  localDevice,
  visible
})
</script>


  <style scoped>
  .ap-connection-badge {
    background: var(--purple-100);
    color: var(--purple-700);
    border: 1px solid var(--purple-200);
  }
  .universal-progress-modal {
    max-height: 85vh;
  }
  
  .progress-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 0.5rem 0;
  }
  
  .operation-info-section {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--surface-50);
    border-radius: 8px;
    border: 1px solid var(--surface-200);
  }
  
  .operation-type-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 20px;
    font-weight: 600;
    font-size: 0.85rem;
  }
  
  .connect-badge {
    background: var(--green-100);
    color: var(--green-700);
    border: 1px solid var(--green-200);
  }
  
  .mode-change-badge {
    background: var(--blue-100);
    color: var(--blue-700);
    border: 1px solid var(--blue-200);
  }
  
  .device-info {
    flex: 1;
  }
  
  .device-name {
    font-weight: 600;
    color: var(--text-color);
    margin-bottom: 0.25rem;
  }
  
  .device-hwid {
    font-size: 0.85rem;
    color: var(--text-color-secondary);
    margin-bottom: 0.25rem;
  }
  
  .operation-details {
    font-size: 0.9rem;
    color: var(--text-color);
  }
  
  .main-progress-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .progress-info {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  
  .status-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }
  
  .progress-text {
    flex: 1;
  }
  
  .progress-title {
    font-weight: 600;
    color: var(--text-color);
    margin-bottom: 0.25rem;
  }
  
  .progress-subtitle {
    font-size: 0.9rem;
    color: var(--text-color-secondary);
  }
  
  .progress-percent {
    font-weight: 600;
    color: var(--primary-color);
    font-size: 1.1rem;
  }
  
  .main-progress-bar {
    height: 8px;
    border-radius: 4px;
  }
  
  .progress-details {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    color: var(--text-color-secondary);
  }
  
  .device-status .online {
    color: var(--green-500);
  }
  
  .device-status .offline {
    color: var(--orange-500);
  }
  
  .steps-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 200px;
    overflow-y: auto;
  }
  
  .step-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 6px;
    transition: all 0.3s ease;
  }
  
  .step-completed {
    background: var(--green-50);
    border-left: 3px solid var(--green-500);
  }
  
  .step-current {
    background: var(--blue-50);
    border-left: 3px solid var(--blue-500);
  }
  
  .step-pending {
    background: var(--surface-50);
    border-left: 3px solid var(--surface-300);
  }
  
  .step-error {
    background: var(--red-50);
    border-left: 3px solid var(--red-500);
  }
  
  .step-indicator {
    flex-shrink: 0;
    margin-top: 0.125rem;
  }
  
  .step-completed .step-indicator {
    color: var(--green-500);
  }
  
  .step-current .step-indicator {
    color: var(--blue-500);
  }
  
  .step-pending .step-indicator {
    color: var(--surface-400);
  }
  
  .step-error .step-indicator {
    color: var(--red-500);
  }
  
  .step-content {
    flex: 1;
  }
  
  .step-title {
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 0.25rem;
  }
  
  .step-completed .step-title {
    color: var(--green-700);
  }
  
  .step-current .step-title {
    color: var(--blue-700);
  }
  
  .step-pending .step-title {
    color: var(--text-color-secondary);
  }
  
  .step-error .step-title {
    color: var(--red-700);
  }
  
  .step-description {
    font-size: 0.8rem;
    color: var(--text-color-secondary);
  }
  
  .step-details {
    color: var(--text-color-secondary);
    font-size: 0.8rem;
    margin-top: 0.25rem;
    font-style: italic;
  }
  
  .step-error {
    color: var(--red-600);
    font-size: 0.8rem;
    margin-top: 0.25rem;
    font-style: italic;
  }
  
  .log-section {
    border: 1px solid var(--surface-200);
    border-radius: 6px;
    overflow: hidden;
  }
  
  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    background: var(--surface-50);
    border-bottom: 1px solid var(--surface-200);
    font-weight: 600;
    font-size: 0.9rem;
  }
  
  .log-content {
    max-height: 120px;
    overflow-y: auto;
    padding: 0.5rem;
  }
  
  .log-entry {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.8rem;
  }
  
  .log-entry i {
    flex-shrink: 0;
    width: 16px;
  }
  
  .log-info { color: var(--blue-600); }
  .log-success { color: var(--green-600); }
  .log-warning { color: var(--orange-600); }
  .log-error { color: var(--red-600); }
  
  .log-time {
    color: var(--text-color-secondary);
    font-size: 0.75rem;
    min-width: 50px;
  }
  
  .log-message {
    flex: 1;
  }
  
  .progress-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }
  
  .footer-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-color-secondary);
    font-size: 0.85rem;
  }
  
  /* Адаптивность */
  @media (max-width: 768px) {
    .operation-info-section {
      flex-direction: column;
      text-align: center;
      gap: 0.75rem;
    }
    
    .progress-info {
      flex-direction: column;
      text-align: center;
      gap: 0.75rem;
    }
    
    .progress-footer {
      flex-direction: column;
      gap: 0.75rem;
    }
    
    .footer-info {
      justify-content: center;
      flex-wrap: wrap;
    }
    
    .steps-section {
      max-height: 150px;
    }
  }
  
  :deep(.p-progressbar-danger .p-progressbar-value) {
    background: var(--red-500) !important;
  }
  </style>