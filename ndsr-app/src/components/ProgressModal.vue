<template>
    <Dialog 
      v-model:visible="visible" 
      :modal="true" 
      :closable="userCanClose"
      :closeOnEscape="userCanClose"
      :dismissableMask="userCanClose"
      :header="modalHeader"
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
            <div class="device-name">{{ device?.shortName }}</div>
            <div class="device-hwid">{{ device?.hwId }}</div>
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
            v-for="step in currentSteps" 
            :key="step.id"
            class="step-item"
            :class="{
              'step-completed': stepCompleted(step),
              'step-current': currentStepId === step.id,
              'step-pending': !stepCompleted(step) && currentStepId !== step.id,
              'step-error': stepError(step)
            }"
          >
            <div class="step-indicator">
              <i class="pi pi-check" v-if="stepCompleted(step)"></i>
              <i class="pi pi-spin pi-spinner" v-else-if="currentStepId === step.id && !stepError(step)"></i>
              <i class="pi pi-exclamation-triangle" v-else-if="stepError(step)"></i>
              <i class="pi pi-circle" v-else></i>
            </div>
            <div class="step-content">
              <div class="step-title">{{ step.title }}</div>
              <div class="step-description">{{ step.description }}</div>
              <div class="step-details" v-if="step.details && (currentStepId === step.id || stepCompleted(step))">
                {{ step.details }}
              </div>
              <div class="step-error" v-if="stepError(step)">
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
  import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
  import { useToast } from 'primevue/usetoast'
  import Dialog from 'primevue/dialog'
  import ProgressBar from 'primevue/progressbar'
  import Button from 'primevue/button'
  import Message from 'primevue/message'
  import { socket } from '@/socket'
  
  const toast = useToast()
  
  const props = defineProps({
    device: {
      type: Object,
      default: null
    },
    operationType: {
      type: String,
      default: 'mwsConnection' // 'mwsConnection' or 'modeChange'
    },
    operationData: {
      type: Object,
      default: () => ({})
    }
  })
  
  const emit = defineEmits(['close', 'completed', 'cancelled'])
  
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
  

  const operationConfigs = {
    mwsConnection: {
        title: 'MWS Connection',
        icon: 'pi pi-link',
        badgeClass: 'connect-badge',
        getSteps: (operationData) => {
            console.log('🔍 ProgressModal operationData:', operationData); // ДЛЯ ОТЛАДКИ
            
            const isDisconnect = operationData?.action === 'disconnect';
            
            if (isDisconnect) {
                console.log('🔧 Setting up steps for DISCONNECT');
                return [
                    { id: 'initializing', title: 'Initializing', description: 'Validating devices and parameters' },
                    { id: 'switch_config', title: 'Switch Configuration', description: 'Setting up VLANs and ports' },
                    { id: 'port_forwarding', title: 'Port Forwarding', description: 'Removing firewall rules' },
                    { id: 'device_reboot', title: 'Device Reboot', description: 'Restarting device with new settings' },
                    { id: 'verification', title: 'Verification', description: 'Checking device status' },
                    { id: 'completed', title: 'Completed', description: 'Disconnection finished' }
                ];
            } else {
                console.log('🔧 Setting up steps for CONNECT');
                return [
                    { id: 'initializing', title: 'Initializing', description: 'Validating devices and parameters' },
                    { id: 'switch_config', title: 'Switch Configuration', description: 'Setting up VLANs and ports' },
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
      steps: [
        { id: 'initializing', title: 'Initializing', description: 'Preparing mode change' },
        { id: 'applying_config', title: 'Applying Configuration', description: 'Sending new settings' },
        { id: 'rebooting', title: 'Device Rebooting', description: 'Restarting with new mode' },
        { id: 'waiting_online', title: 'Waiting for Device', description: 'Monitoring device status' },
        { id: 'finalizing', title: 'Finalizing', description: 'Completing mode transition' },
        { id: 'completed', title: 'Completed', description: 'Mode change finished' }
      ],
      successMessage: 'Device mode changed successfully'
    }
}

  // Computed properties
  const mobileView = computed(() => window.innerWidth <= 768)
  
  const operationConfig = computed(() => {
    return operationConfigs[props.operationType] || operationConfigs.mwsConnection
  })
  
  const modalHeader = computed(() => {
    return `${operationConfig.value.title}: ${props.device?.shortName || 'Device'}`
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
    if (props.operationType === 'modeChange') {
      return `Changing from ${props.operationData.oldMode} to ${props.operationData.newMode}`
    } else if (props.operationType === 'mwsConnection') {
      return props.operationData.action === 'disconnect' 
        ? 'Disconnecting from router' 
        : 'Connecting to router'
    }
    return ''
  })
  
  const currentSteps = computed(() => {
    const config = operationConfig.value;
    const steps = typeof config.getSteps === 'function' 
        ? config.getSteps(props.operationData)
        : config.steps;
    
    return steps.map(step => ({
        ...step,
        completed: false,
        progress: 0,
        error: null,
        details: null
    }));
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
    const step = currentSteps.value.find(s => s.id === currentStepId.value)
    return step?.title || 'Operation in progress...'
  })
  
  const currentStepDescription = computed(() => {
    const step = currentSteps.value.find(s => s.id === currentStepId.value)
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
    const config = operationConfig.value;
    return typeof config.successMessage === 'function'
        ? config.successMessage(props.operationData)
        : config.successMessage;
});
  
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
  
  // Methods
  const show = (operationType = 'mwsConnection', device = null, operationData = {}) => {
    visible.value = true
    progress.value = 0
    currentStepId.value = 'initializing'
    deviceStatus.value = 0
    startTime.value = Date.now()
    userClosed.value = false
    closingInProgress.value = false
    operationCompleted.value = false
    hasErrors.value = false
    operationLog.value = []
    
    // Update props if provided
    if (device) {
      props.device = device
    }
    if (operationType) {
      props.operationType = operationType
    }
    if (operationData) {
      props.operationData = operationData
    }
    
    addLog('info', `${operationConfig.value.title} started`)
    
    // Start device status monitoring
    if (props.device?.id) {
      startDeviceMonitoring(props.device.id)
    }
    
    // Listen for progress events
    startProgressListening()
  }
  
  const startProgressListening = () => {
  const progressHandler = (data) => {
    if (data.deviceId === props.device?.id) {
      updateProgress(data.progress, data.step, data.details)
    }
  }

  const mwsProgressHandler = (data) => {
    if (data.deviceId === props.device?.id) {
      updateProgress(data.progress, data.step, data.details)
    }
  }

  const modeProgressHandler = (data) => {
    if (data.deviceId === props.device?.id) {
      updateProgress(data.progress, data.step, data.details)
    }
  }

  // ✅ СЛУШАЕМ ВСЕ ТИПЫ СОБЫТИЙ ПРОГРЕССА
  socket.on('device:operationProgress', progressHandler)
  socket.on('device:mwsOperationProgress', mwsProgressHandler)
  socket.on('device:modeChangeProgress', modeProgressHandler)

  onUnmounted(() => {
    socket.off('device:operationProgress', progressHandler)
    socket.off('device:mwsOperationProgress', mwsProgressHandler)
    socket.off('device:modeChangeProgress', modeProgressHandler)
  })
}

const updateProgress = (newProgress, step, details = null) => {
  console.log('📥 ProgressModal received progress:', { 
    newProgress, 
    step, 
    details,
    currentStepId: currentStepId.value,
    operationData: props.operationData 
  });
  
  progress.value = Math.max(progress.value, newProgress);
  
  // ✅ ВАЖНОЕ ИСПРАВЛЕНИЕ: Всегда обновляем currentStepId при получении step
  if (step && step !== currentStepId.value) {
    console.log(`🔄 Switching step: ${currentStepId.value} -> ${step}`);
    currentStepId.value = step;
    addLog('info', `Started: ${getStepTitle(step)}`);
  }
  
  // Обновляем детали шага если есть
  if (details) {
    addLog('info', details);
  }
  
  // Проверяем завершение
  if (newProgress >= 100) {
    console.log('🎉 Operation completed!');
    completeOperation();
  }
}
  const getStepTitle = (stepId) => {
    const step = currentSteps.value.find(s => s.id === stepId)
    return step?.title || stepId
  }
  
  const startDeviceMonitoring = (deviceId) => {
  const statusHandler = (data) => {
    if (data.deviceId === deviceId) {
      deviceStatus.value = data.status
      
      if (data.status === 200) {
        addLog('success', 'Device is back online')
      }
    }
  }

  socket.on('device:status', statusHandler)
  
  // ✅ БЕЗОПАСНЫЙ ВЫЗОВ С CALLBACK
  socket.emit('device:forceStatusCheck', deviceId, (response) => {
    if (response?.success) {
      console.log(`✅ Force status check completed: ${response.status}`)
    } else {
      console.log(`⚠️ Force status check failed: ${response?.error}`)
    }
  })

  onUnmounted(() => {
    socket.off('device:status', statusHandler)
  })
}
  const stepCompleted = (step) => {
    const stepIndex = currentSteps.value.findIndex(s => s.id === step.id)
    const currentStepIndex = currentSteps.value.findIndex(s => s.id === currentStepId.value)
    return stepIndex < currentStepIndex
  }
  
  const stepError = (step) => {
    return step.error !== null
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
    operationCompleted.value = true
    currentStepId.value = 'completed'
    
    addLog('success', operationConfig.value.successMessage)
    
    emit('completed')
    
    // Auto-close after 3 seconds
    setTimeout(() => {
      if (visible.value && !userClosed.value) {
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
        `Operation for ${props.device?.shortName} is still in progress (${Math.round(progress.value)}%).\n\n` +
        'The operation will continue in background.\n\n' +
        'Are you sure you want to close this window?'
      )
      resolve(userConfirmed)
    })
  }
  
  const closeModal = () => {
    visible.value = false
    emit('close')
    
    setTimeout(() => {
      progress.value = 0
      currentStepId.value = 'initializing'
      deviceStatus.value = 0
      userClosed.value = false
      closingInProgress.value = false
      operationCompleted.value = false
      hasErrors.value = false
    }, 300)
  }
  
  // Helper to update step with error
  const setStepError = (stepId, errorMessage) => {
    hasErrors.value = true
    addLog('error', `Error: ${errorMessage}`)
  }
  
  defineExpose({ 
    show,
    updateProgress,
    setStepError,
    addLog
  })
  </script>
  
  <style scoped>
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