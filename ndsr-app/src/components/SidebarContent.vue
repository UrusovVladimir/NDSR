<template>
  <div class="sidebar-content">
    <div class="sidebar-header">
      <h3>System Menu</h3>
    </div>
    
    <div class="device-stats p-3 surface-ground border-round mb-3">
      <div class="stat-item">
        <i class="pi pi-check-circle text-green-500"></i>
        <span>Online: {{ onlineCount }}</span>
      </div>
      <div class="stat-item">
        <i class="pi pi-times-circle text-red-500"></i>
        <span>Offline: {{ offlineCount }}</span>
      </div>
      <div class="stat-item">
        <i class="bi bi-calculator-fill text-blue-500"></i>
        <span>Total: {{ totalDevices }}</span>
      </div>
    </div>

    <div class="sidebar-menu">
      <div class="nav-section">
        <div class="nav-item dropdown-trigger" :class="{ 'dropdown-open': isToolsOpen }" @click="toggleToolsDropdown">
          <i class="bi bi-globe"></i>
          <span>Network Tools</span>
          <i class="pi pi-chevron-down dropdown-arrow" :class="{ 'rotated': isToolsOpen }"></i>
        </div>
        <Transition name="dropdown">
          <div v-if="isToolsOpen" class="dropdown-content">
            <div class="dropdown-item server-info">
              <i class="pi pi-sitemap text-blue-500"></i>
              <div class="server-details">
                <span class="server-label">Iperf Server (Internal)</span>
                <span class="server-address">{{ iperfServer }}</span>
              </div>
              <Button icon="pi pi-copy" class="p-button-text p-button-sm" @click="copyServerAddress(iperfServer)" v-tooltip="'Copy to clipboard'" />
            </div>
            <div class="dropdown-item server-info">
              <i class="pi pi-sitemap text-green-500"></i>
              <div class="server-details">
                <span class="server-label">Iperf Server (Public)</span>
                <span class="server-address">{{ iperfServerPublic }}</span>
              </div>
              <Button icon="pi pi-copy" class="p-button-text p-button-sm" @click="copyServerAddress(iperfServerPublic)" v-tooltip="'Copy to clipboard'" />
            </div>
          </div>
        </Transition>
      </div>

      <div class="nav-section">
        <div class="nav-item dropdown-trigger" :class="{ 'dropdown-open': isDeviceMgmtOpen }" @click="toggleDeviceMgmtDropdown">
          <i class="pi pi-wrench"></i>
          <span>Device Management</span>
          <i class="pi pi-chevron-down dropdown-arrow" :class="{ 'rotated': isDeviceMgmtOpen }"></i>
        </div>
        <Transition name="dropdown">
          <div v-if="isDeviceMgmtOpen" class="dropdown-content">
            <div class="dropdown-item tool-item" @click="handleReloadConfigs" :class="{ 'disabled-item': isReloading }">
              <i class="pi pi-refresh text-blue-500" :class="{ 'pi-spin': isReloading }"></i>
              <div class="tool-details">
                <span class="tool-label">Reload Configs</span>
                <span class="tool-desc">Reload devices from JSON files</span>
              </div>
            </div>
            <div class="dropdown-item tool-item" @click="openAddDeviceForm">
              <i class="pi pi-plus text-green-500"></i>
              <div class="tool-details">
                <span class="tool-label">Add Device</span>
                <span class="tool-desc">Add a new device to config</span>
              </div>
            </div>
            <div class="dropdown-item tool-item" @click="toggleRemoveDeviceDropdown">
              <i class="pi pi-trash text-red-500"></i>
              <div class="tool-details">
                <span class="tool-label">Remove Devices</span>
                <span class="tool-desc">{{ selectedDeviceIds.length > 0 ? `${selectedDeviceIds.length} selected` : 'Select devices to remove' }}</span>
              </div>
              <i class="pi pi-chevron-right ml-auto" :class="{ 'rotated': isRemoveDeviceOpen }"></i>
            </div>
            <Transition name="dropdown">
              <div v-if="isRemoveDeviceOpen" class="device-remove-list">
                <div class="dropdown-item bulk-actions" v-if="selectedDeviceIds.length > 0">
                  <Button label="Remove Selected" icon="pi pi-trash" class="p-button-sm p-button-danger w-full" @click="confirmRemoveSelected" />
                </div>
                <div v-for="device in devices" :key="device.id"
                  class="dropdown-item device-remove-item"
                  :class="{ 'device-selected': selectedDeviceIds.includes(device.id) }"
                  @click="toggleDeviceSelection(device.id)">
                  <Checkbox :modelValue="selectedDeviceIds.includes(device.id)" :binary="true" class="mr-2" />
                  <i class="pi pi-circle-fill" :class="device.statusCode === 200 ? 'text-green-500' : 'text-red-500'" style="font-size: 0.5rem"></i>
                  <div class="tool-details">
                    <span class="tool-label">{{ device.shortName }}</span>
                    <span class="tool-desc">{{ device.hwId }}</span>
                  </div>
                </div>
                <div v-if="devices.length === 0" class="dropdown-item text-color-secondary">
                  <i class="pi pi-info-circle"></i>
                  <span>No devices available</span>
                </div>
              </div>
            </Transition>
          </div>
        </Transition>
      </div>

      <Button label="FAQ & Help" icon="pi pi-question-circle" class="p-button-text p-button-secondary w-full justify-start menu-button" @click="$emit('open-faq')" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import { useToast } from 'primevue/usetoast'
import { useDeviceStore } from '@/stores/useDeviceStore'

const emit = defineEmits(['open-faq', 'show-remove-confirm', 'show-add-device'])

const toast = useToast()
const deviceStore = useDeviceStore()

const iperfServer = import.meta.env.VITE_IPERF_SERVER
const iperfServerPublic = import.meta.env.VITE_IPERF_SERVER_PUBLIC
const isToolsOpen = ref(false)
const isDeviceMgmtOpen = ref(false)
const isRemoveDeviceOpen = ref(false)
const selectedDeviceIds = ref([])
const isReloading = ref(false)
const devices = ref([])

const toggleToolsDropdown = () => { isToolsOpen.value = !isToolsOpen.value }
const toggleDeviceMgmtDropdown = () => {
  isDeviceMgmtOpen.value = !isDeviceMgmtOpen.value
  if (isDeviceMgmtOpen.value) { devices.value = [...deviceStore.devices] }
}
const toggleRemoveDeviceDropdown = () => { isRemoveDeviceOpen.value = !isRemoveDeviceOpen.value }

const toggleDeviceSelection = (deviceId) => {
  const index = selectedDeviceIds.value.indexOf(deviceId)
  if (index === -1) { selectedDeviceIds.value.push(deviceId) }
  else { selectedDeviceIds.value.splice(index, 1) }
}

const confirmRemoveSelected = () => {
  if (selectedDeviceIds.value.length === 0) {
    toast.add({ severity: 'warn', summary: 'No Selection', detail: 'Please select devices to remove', life: 3000 })
    return
  }
  const selectedDevices = devices.value.filter(d => selectedDeviceIds.value.includes(d.id))
  emit('show-remove-confirm', selectedDevices)
}

const openAddDeviceForm = () => {
  emit('show-add-device')
}

const handleReloadConfigs = async () => {
  isReloading.value = true
  try {
    await deviceStore.reloadConfigs()
    devices.value = [...deviceStore.devices]
    selectedDeviceIds.value = []
    toast.add({ severity: 'success', summary: 'Configs Reloaded', detail: 'Device configurations reloaded successfully', life: 3000 })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: error.message, life: 5000 })
  } finally {
    isReloading.value = false
  }
}

const copyServerAddress = (server) => {
  try { navigator.clipboard.writeText(server); toast.add({ severity: 'success', summary: 'Copied!', life: 2000 }) }
  catch (err) { console.error('Copy failed:', err) }
}

defineProps({ onlineCount: Number, offlineCount: Number, totalDevices: Number })
</script>

<style scoped>
.sidebar-content {
  padding: 1rem 0;
}

.sidebar-header {
  padding: 0 1rem 1rem;
  border-bottom: 1px solid var(--surface-border);
  margin-bottom: 1rem;
}

.sidebar-header h3 {
  margin: 0;
  color: var(--text-color);
}

.device-stats {
  margin: 0 1rem;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.stat-item:last-child {
  margin-bottom: 0;
}

.sidebar-menu {
  padding: 0.5rem 0;
}

.nav-section {
  margin-bottom: 0.5rem;
}

.dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: all 0.2s;
  border-radius: var(--border-radius);
  color: var(--text-color);
}

.dropdown-trigger:hover {
  background-color: var(--surface-hover);
}

.dropdown-trigger.dropdown-open {
  background-color: var(--surface-hover);
  color: var(--primary-color);
}

.dropdown-arrow {
  margin-left: auto;
  transition: transform 0.2s;
}

.dropdown-arrow.rotated {
  transform: rotate(180deg);
}

.dropdown-content {
  background: var(--surface-ground);
  border: 1px solid var(--surface-border);
  border-radius: var(--border-radius);
  margin: 0.25rem 1rem;
  overflow: hidden;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.dropdown-item:hover {
  background-color: var(--surface-hover);
}

.dropdown-item.server-info {
  background: var(--surface-section);
  cursor: default;
}

.server-details {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.server-label {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  font-weight: 500;
}

.server-address {
  font-size: 0.75rem;
  color: var(--text-color);
  font-family: monospace;
  background: var(--surface-card);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  margin-top: 0.25rem;
}

.dropdown-divider {
  height: 1px;
  background: var(--surface-border);
  margin: 0.25rem 0;
}

.tool-item i {
  width: 1rem;
  text-align: center;
}

.menu-button {
  margin: 0.125rem 1rem;
  border-radius: var(--border-radius);
}

/* Анимации */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.3s ease;
  max-height: 300px;
  opacity: 1;
}

.dropdown-enter-from,
.dropdown-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-10px);
}

:deep(.p-button) {
  margin: 0.125rem 0;
}

.tool-details {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.tool-label {
  font-size: 0.875rem;
  color: var(--text-color);
  font-weight: 500;
}

.tool-desc {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

.disabled-item {
  opacity: 0.5;
  pointer-events: none;
}

.device-remove-list {
  background: var(--surface-card);
  border-top: 1px solid var(--surface-border);
  max-height: 200px;
  overflow-y: auto;
}

.device-remove-item {
  padding-left: 2rem;
  border-bottom: 1px solid var(--surface-border);
}

.device-remove-item:last-child {
  border-bottom: none;
}

.confirmation-content {
  display: flex;
  align-items: flex-start;
  padding: 0.5rem 0;
}

.rotated {
  transform: rotate(90deg);
}
.device-remove-list {
  background: var(--surface-card);
  border-top: 1px solid var(--surface-border);
  max-height: 300px;
  overflow-y: auto;
}

.device-remove-item {
  padding-left: 1rem;
  border-bottom: 1px solid var(--surface-border);
  cursor: pointer;
}

.device-remove-item:hover {
  background-color: var(--surface-hover);
}

.device-remove-item.device-selected {
  background-color: var(--primary-50);
}

.bulk-actions {
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-ground);
  position: sticky;
  top: 0;
  z-index: 1;
}

/* Список устройств в диалоге */
.device-list {
  max-height: 150px;
  overflow-y: auto;
  background: var(--surface-50);
  border-radius: 4px;
  padding: 0.5rem 0.5rem 0.5rem 1.5rem;
  border: 1px solid var(--surface-200);
}

.device-list li {
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--surface-100);
  font-size: 0.85rem;
}

.device-list li:last-child {
  border-bottom: none;
}
.add-device-form {
  max-height: 60vh;
  overflow-y: auto;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.form-field label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-color-secondary);
}

@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>