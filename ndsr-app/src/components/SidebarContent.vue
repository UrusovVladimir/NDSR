<template>
  <div class="sidebar-content">
    <div class="sidebar-header">
      <h3>System Menu</h3>
    </div>
    
    <!-- Statistics -->
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
        <i class="pi pi-server text-blue-500"></i>
        <span>Total: {{ totalDevices }}</span>
      </div>
    </div>

    <!-- Navigation Menu с Dropdown -->
    <div class="sidebar-menu">
      <div class="nav-section">
        <div 
          class="nav-item dropdown-trigger"
          :class="{ 'dropdown-open': isToolsOpen }"
          @click="toggleToolsDropdown"
        >
          <i class="pi pi-wrench"></i>
          <span>Network Tools</span>
          <i class="pi pi-chevron-down dropdown-arrow" :class="{ 'rotated': isToolsOpen }"></i>
        </div>
        
        <Transition name="dropdown">
          <div v-if="isToolsOpen" class="dropdown-content">
            <!-- Первый сервер -->
            <div class="dropdown-item server-info">
              <i class="pi pi-sitemap text-blue-500"></i>
              <div class="server-details">
                <span class="server-label">Iperf Server (Internal)</span>
                <span class="server-address">{{ iperfServer }}</span>
              </div>
              <Button 
                icon="pi pi-copy" 
                class="p-button-text p-button-sm"
                @click="copyServerAddress(iperfServer)"
                v-tooltip="'Copy to clipboard'"
              />
            </div>
            
            <!-- Второй сервер -->
            <div class="dropdown-item server-info">
              <i class="pi pi-sitemap text-green-500"></i>
              <div class="server-details">
                <span class="server-label">Iperf Server (Public)</span>
                <span class="server-address">{{ iperfServerPublic }}</span>
              </div>
              <Button 
                icon="pi pi-copy" 
                class="p-button-text p-button-sm"
                @click="copyServerAddress(iperfServerPublic)"
                v-tooltip="'Copy to clipboard'"
              />
            </div>
          </div>
        </Transition>
      </div>

      <!-- Остальные пункты меню -->
      <Button 
        label="FAQ & Help" 
        icon="pi pi-question-circle" 
        class="p-button-text p-button-secondary w-full justify-start menu-button"
        @click="$emit('open-faq')"
      />
      <!-- <Button 
        label="System Settings" 
        icon="pi pi-cog" 
        class="p-button-text p-button-secondary w-full justify-start menu-button"
        @click="$emit('open-settings')"
      /> -->
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'

const toast = useToast()
const iperfServer = import.meta.env.VITE_IPERF_SERVER
const iperfServerPublic = import.meta.env.VITE_IPERF_SERVER_PUBLIC
const isToolsOpen = ref(false)

const networkTools = ref([
  { id: 'ping', label: 'Ping Tool', icon: 'pi pi-wifi' },
  { id: 'speedtest', label: 'Speed Test', icon: 'pi pi-chart-line' },
  { id: 'traceroute', label: 'Traceroute', icon: 'pi pi-map-marker' },
  { id: 'portscan', label: 'Port Scanner', icon: 'pi pi-search' },
  { id: 'bandwidth', label: 'Bandwidth Monitor', icon: 'pi pi-chart-bar' }
])

const toggleToolsDropdown = () => {
  isToolsOpen.value = !isToolsOpen.value
}

const selectTool = (tool) => {
  console.log('Selected tool:', tool)
  toast.add({
    severity: 'info',
    summary: 'Tool Selected',
    detail: `Opening ${tool.label}`,
    life: 3000
  })
  
  // Закрываем dropdown после выбора
  isToolsOpen.value = false
  
  // Эмитим событие для родительского компонента
  emit('select-tool', tool)
}

const copyServerAddress = (server) => {
  try {
    // Создаем временный input элемент
    const input = document.createElement('input')
    input.value = server
    document.body.appendChild(input)
    input.select()
    input.setSelectionRange(0, 99999) // Для мобильных устройств
    
    // Копируем
    const successful = document.execCommand('copy')
    document.body.removeChild(input)
    
    if (successful) {
      toast.add({
        severity: 'success',
        summary: 'Copied!',
        detail: 'Server address copied to clipboard',
        life: 2000
      })
    } else {
      showManualCopy()
    }
    
  } catch (err) {
    console.error('Copy failed:', err)
    showManualCopy()
  }
}

defineProps({
  onlineCount: Number,
  offlineCount: Number,
  totalDevices: Number
})

const emit = defineEmits(['open-faq', 'open-settings', 'select-tool'])
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
</style>