<template>
    <div class="device-actions">
      <!-- Кнопки действий -->
      <div class="flex flex-wrap gap-1">
          <!-- Reboot Button -->
          <Button
              v-tooltip="isRebooting ? 'Rebooting...' : 'Reboot Device'"
              :icon="isRebooting ? 'pi pi-spinner pi-spin' : 'pi pi-power-off'"
              class="p-button-sm p-button-outlined p-button-warning p-button-rounded modern-btn"
              :disabled="!canReboot || isAnyOperationInProgress"
              @click="showRebootConfirm = true"
          />
          
          <!-- Reset Config Button -->
          <Button
              v-tooltip="isResetting ? 'Resetting...' : 'Reset Configuration'"
              :icon="isResetting ? 'pi pi-spinner pi-spin' : 'pi pi-refresh'"
              class="p-button-sm p-button-outlined p-button-danger p-button-rounded modern-btn"
              :disabled="!canResetConfig || isAnyOperationInProgress"
              @click="showResetConfirm = true"
          />
          
          <!-- MWS Connection -->
          <Button
              v-if="device.type === 'AP'"
              v-tooltip="'MWS Connection'"
              icon="pi pi-wifi"
              class="p-button-sm p-button-outlined p-button-success p-button-rounded modern-btn"
              :disabled="!canMwsConnect || isAnyOperationInProgress"
              @click="$emit('open-modal', device, 'mwsConnection')"
          />

          <!-- Change Mode -->
          <Button
              v-tooltip="'Change Mode'"
              icon="pi pi-wrench"
              class="p-button-sm p-button-outlined p-button-rounded modern-btn"
              :disabled="!canChangeMode || isAnyOperationInProgress"
              @click="$emit('open-change-mode', device)"
          />

          <!-- Reset DSL Line -->
          <Button
              v-if="device.dslPort"
              v-tooltip="isResettingDsl ? 'Resetting DSL...' : 'Reset DSL Line'"
              :icon="isResettingDsl ? 'pi pi-spinner pi-spin' : 'pi pi-phone'"
              class="p-button-sm p-button-outlined p-button-secondary p-button-rounded modern-btn"
              :disabled="!canResetDsl || isAnyOperationInProgress"
              @click="showDslResetConfirm = true"
          />

          <!-- LAN VNC -->
          <Button
              v-if="device.type === 'router'"
              v-tooltip="'LAN VNC'"
              icon="pi pi-desktop"
              class="p-button-sm p-button-outlined p-button-secondary p-button-rounded modern-btn"
              :disabled="!canOpenVnc || isAnyOperationInProgress"
              @click="openVnc"
          />

          <!-- Индикатор статуса бронирования -->
          <div v-if="!isBookedByCurrentUser && device.statusCode === 200" class="booking-hint">
              <small class="text-muted">Book to access controls</small>
          </div>
      </div>

      <!-- Confirm Reset Dialog -->
      <Dialog 
          v-model:visible="showResetConfirm" 
          modal 
          header="Reset Configuration"
          :style="{ width: '450px' }"
      >
          <div class="confirmation-content">
              <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #e74c3c;" />
              <div>
                  <h4 class="mb-2">Reset device configuration?</h4>
                  <p class="text-color-secondary mb-0">
                      This will erase all settings and restore factory defaults for 
                      <strong>{{ device.hwId }}</strong>. This action cannot be undone.
                  </p>
              </div>
          </div>
          <template #footer>
              <Button 
                  label="Cancel" 
                  icon="pi pi-times" 
                  class="p-button-text" 
                  @click="showResetConfirm = false"
              />
              <Button 
                  label="Reset Configuration" 
                  icon="pi pi-refresh" 
                  class="p-button-danger" 
                  @click="confirmReset"
              />
          </template>
      </Dialog>

      <!-- Confirm Reboot Dialog -->
      <Dialog 
          v-model:visible="showRebootConfirm" 
          modal 
          header="Reboot Device"
          :style="{ width: '450px' }"
      >
          <div class="confirmation-content">
              <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #f39c12;" />
              <div>
                  <h4 class="mb-2">Reboot device?</h4>
                  <p class="text-color-secondary mb-0">
                      Device <strong>{{ device.hwId }}</strong> will be restarted. 
                      This may take 1-2 minutes. All connections will be temporarily interrupted.
                  </p>
              </div>
          </div>
          <template #footer>
              <Button 
                  label="Cancel" 
                  icon="pi pi-times" 
                  class="p-button-text" 
                  @click="showRebootConfirm = false"
              />
              <Button 
                  label="Reboot Device" 
                  icon="pi pi-power-off" 
                  class="p-button-warning" 
                  @click="confirmReboot"
              />
          </template>
      </Dialog>

      <!-- Confirm DSL Reset Dialog -->
      <Dialog 
          v-model:visible="showDslResetConfirm" 
          modal 
          header="Reset DSL Line"
          :style="{ width: '450px' }"
      >
          <div class="confirmation-content">
              <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #3498db;" />
              <div>
                  <h4 class="mb-2">Reset DSL line?</h4>
                  <p class="text-color-secondary mb-0">
                      DSL connection for <strong>{{ device.hwId }}</strong> will be reset. 
                      This may temporarily interrupt internet connectivity.
                  </p>
              </div>
          </div>
          <template #footer>
              <Button 
                  label="Cancel" 
                  icon="pi pi-times" 
                  class="p-button-text" 
                  @click="showDslResetConfirm = false"
              />
              <Button 
                  label="Reset DSL Line" 
                  icon="pi pi-phone" 
                  class="p-button-secondary" 
                  @click="confirmDslReset"
              />
          </template>
      </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, inject } from 'vue'
import { storeToRefs } from 'pinia'
import { useToast } from 'primevue/usetoast'
import { useDeviceActionsStore } from '@/stores/useDeviceActionsStore'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

const toast = useToast()
const deviceActionsStore = useDeviceActionsStore()
const todayPassword = inject('todayPassword')

const { activeOperations, isAnyOperationActive } = storeToRefs(deviceActionsStore)

const props = defineProps({
  device: Object,
  currentUserId: [String, Number],
  wanTypes: Array,
  filteredDevices: Array
})

const emit = defineEmits(['open-modal', 'open-console', 'open-change-mode'])

// Диалоги подтверждения
const showResetConfirm = ref(false)
const showRebootConfirm = ref(false)
const showDslResetConfirm = ref(false)

// ✅ ИСПРАВЛЕНО: Добавляем методы для проверки статусов операций
const isResetting = computed(() => 
  deviceActionsStore.getDeviceOperation(props.device.id) === 'resetting'
)

const isRebooting = computed(() => 
  deviceActionsStore.getDeviceOperation(props.device.id) === 'rebooting'
)

const isResettingDsl = computed(() => 
  deviceActionsStore.getDeviceOperation(props.device.id) === 'resettingDsl'
)

const isInitializing = computed(() => 
  deviceActionsStore.getDeviceOperation(props.device.id) === 'initializing'
)

const isAnyOperationInProgress = computed(() => 
  deviceActionsStore.isAnyOperationActive
)

// ✅ Остальные computed свойства без изменений
const isBookedByCurrentUser = computed(() => {
  return props.device.booking?.isBooked && 
      props.device.booking?.bookedBy === props.currentUserId
})

const isOffline = computed(() => props.device.statusCode !== 200)

// ✅ Логика доступности кнопок
const canInitialize = computed(() => isBookedByCurrentUser.value && !isOffline.value)
const canOpenInterface = computed(() => isBookedByCurrentUser.value && !isOffline.value && props.device.URL)
const canMwsConnect = computed(() => isBookedByCurrentUser.value && !isOffline.value)
const canChangeMode = computed(() => isBookedByCurrentUser.value && !isOffline.value)
const canOpenVnc = computed(() => isBookedByCurrentUser.value && !isOffline.value && props.device.vncUrl)
const canReboot = computed(() => isBookedByCurrentUser.value)
const canResetConfig = computed(() => isBookedByCurrentUser.value)
const canResetDsl = computed(() => isBookedByCurrentUser.value && props.device.dslPort)
const canOpenConsole = computed(() => isBookedByCurrentUser.value)

// ✅ Обработчики
const confirmReset = () => {
  console.log('🔄 Component: Starting reset for', props.device.id)
  showResetConfirm.value = false
  deviceActionsStore.resetConfig(props.device)
}

const confirmReboot = () => {
  console.log('🔄 Component: Starting reboot for', props.device.id)
  showRebootConfirm.value = false
  deviceActionsStore.rebootDevice(props.device)
}

const confirmDslReset = () => {
  console.log('🔄 Component: Starting DSL reset for', props.device.id)
  showDslResetConfirm.value = false
  deviceActionsStore.resetDslLine(props.device)
}


// const handleInitialization = () => {
//   console.log('🔄 Component: Starting initialization for', props.device.id)
//   deviceActionsStore.initializationDevice(props.device, todayPassword.value)
// }

// ✅ Остальные методы без изменений
const openVnc = () => {
  const params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`
  window.open(props.device.vncUrl, props.device.hwId, params)

  const debianPassword = 'password'
  toast.add({
      severity: 'info',
      summary: 'VNC Connection',
      detail: `VNC connection established. Password: ${debianPassword}`,
      life: 5000
  })

  if (navigator.clipboard) {
      navigator.clipboard.writeText(debianPassword)
  }
}

const openDeviceInterface = () => {
  if (props.device.URL && canOpenInterface.value) {
      window.open(props.device.URL, '_blank')
      toast.add({
          severity: 'info',
          summary: 'Device Interface',
          detail: `Opening ${props.device.hwId} interface`,
          life: 2000
      })
  }
}
</script>

<style scoped>
.device-actions {
  display: flex;
  justify-content: center;
}

.flex {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: center;
}

.booking-hint {
  width: 100%;
  text-align: center;
  margin-top: 0.25rem;
}

.text-muted {
  color: var(--text-color-secondary);
  font-size: 0.75rem;
  font-style: italic;
}

.operation-content {
  text-align: left;
}

.operation-text h4 {
  margin: 0;
  color: #2c3e50;
  font-size: 1.1rem;
}

.operation-text p {
  margin: 0;
  color: #6c757d;
  font-size: 0.9rem;
}

.confirmation-content {
  display: flex;
  align-items: flex-start;
  padding: 0.5rem 0;
}

/* Адаптивность для диалогов */
@media (max-width: 480px) {
  .confirmation-content {
    flex-direction: column;
    text-align: center;
  }

  .confirmation-content i {
    margin-bottom: 1rem;
    margin-right: 0;
  }
}
</style>
