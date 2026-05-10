<template>
  <header class="app-header">
    <div class="header-left">
      <Button 
        icon="pi pi-bars" 
        class="p-button-text sidebar-toggle"
        @click="$emit('toggle-sidebar')"
        :disabled="false"
      />
      <div class="header-title">
        <h1>Device Administration Panel</h1>
        <span class="datetime">{{ formattedDateTime }}</span>
      </div>
    </div>

    <div class="header-right">
      <div class="password-display" @click="handleCopyPassword">
        <div class="password-content">
          <i class="pi pi-key password-icon"></i>
          <div class="password-info">
            <span class="password-label">{{ passwordOfDays[currentDay].label }}</span>
            <span class="password-value">{{ passwordOfDays[currentDay].password || "Loading..." }} </span>
          </div>
          <i class="pi pi-copy copy-icon" v-tooltip="'Copy password'"></i>
        </div>
      </div>
      
      <!-- Кнопка File Manager -->
      <Button 
        icon="pi pi-folder" 
        class="action-toggle"
        @click="openFileManager"
        v-tooltip.bottom="'File Manager'"
      />

      <div class="header-actions">
        <Button 
          :icon="cronEnabled ? 'pi pi-times' : 'pi pi-stopwatch'" 
          class="action-toggle"
          :class="{ 'cron-enabled': cronEnabled }"
          @click="$emit('toggle-cron')"
          v-tooltip.bottom="cronEnabled ? 'Disable auto-reset all devices' : 'Enable auto-reset all devices'"
        />
        
        <Button 
          icon="pi pi-sync" 
          class="action-toggle"
          @click="$emit('change-password')"
          v-tooltip.bottom="'Generate new device password'"
        />
      </div>
    </div>

    <FileManager ref="fileManagerRef" />
  </header>
</template>

<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import FileManager from '@/components/FileManager.vue'

const props = defineProps({
  isSidebarOpen: Boolean,
  formattedDateTime: String,
  passwordOfDays: Array,
  currentDay: Number,
  cronEnabled: Boolean,
  searchQuery: String
})

const emit = defineEmits([
  'toggle-sidebar', 
  'change-password', 
  'toggle-cron', 
  'update-search',
  'copy-password'
])

const fileManagerRef = ref(null)

const handleCopyPassword = () => {
  const password = props.passwordOfDays[props.currentDay].password
  if (password) {
    emit('copy-password', password)
  }
}

const openFileManager = () => {
  if (fileManagerRef.value) {
    fileManagerRef.value.show()
  } else {
    console.error('FileManager ref is not available')
  }
}
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: linear-gradient(135deg, #343a40 0%, #495057 100%);
  border-bottom: 2px solid #ffc107;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(10px);
  color: #ffc107;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  min-width: 0;
}

.sidebar-toggle {
  color: #ffc107 !important;
  border: 1px solid rgba(255, 193, 7, 0.3) !important;
  background: rgba(255, 193, 7, 0.1) !important;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.sidebar-toggle:hover {
  background: rgba(255, 193, 7, 0.2) !important;
  border-color: #ffc107 !important;
  transform: scale(1.05);
}

.header-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.header-title h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #ffc107;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.datetime {
  font-size: 0.875rem;
  color: #ffd54f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.password-display {
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 200px;
  backdrop-filter: blur(10px);
}

.password-display:hover {
  background: rgba(255, 193, 7, 0.15);
  border-color: #ffc107;
  transform: translateY(-1px);
}

.password-display:active {
  transform: translateY(0);
}

.password-content {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #ffc107;
}

.password-icon {
  font-size: 1.1rem;
  color: #ffc107;
}

.password-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.password-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #ffd54f;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.password-value {
  font-size: 0.9rem;
  font-weight: 700;
  color: #ffc107;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Courier New', monospace;
}

.copy-icon {
  font-size: 1rem;
  color: #ffd54f;
  transition: all 0.2s ease;
}

.password-display:hover .copy-icon {
  color: #ffc107;
  transform: scale(1.1);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Единый стиль для всех кнопок-переключателей */
.action-toggle {
  color: #ffc107 !important;
  border: 1px solid rgba(255, 193, 7, 0.3) !important;
  background: rgba(255, 193, 7, 0.1) !important;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.action-toggle:hover {
  background: rgba(255, 193, 7, 0.2) !important;
  border-color: #ffc107 !important;
  transform: scale(1.05);
}

/* Специальный стиль для включенного cron */
.cron-enabled {
  background: rgba(76, 175, 80, 0.2) !important;
  border-color: rgba(76, 175, 80, 0.5) !important;
  color: #4caf50 !important;
}

.cron-enabled:hover {
  background: rgba(76, 175, 80, 0.3) !important;
  border-color: #4caf50 !important;
}

/* Мобильные стили */
@media (max-width: 768px) {
  .app-header {
    padding: 0.75rem 1rem;
  }

  .header-left {
    gap: 0.75rem;
    flex: 1;
  }

  .header-title h1 {
    font-size: 1.1rem;
  }

  .datetime {
    font-size: 0.8rem;
  }

  .header-right {
    gap: 0.75rem;
  }

  .password-display {
    min-width: auto;
    padding: 0.5rem 0.75rem;
    flex: 1;
    max-width: 160px;
  }

  .password-content {
    gap: 0.5rem;
  }

  .password-info {
    gap: 0.125rem;
  }

  .password-label {
    font-size: 0.7rem;
  }

  .password-value {
    font-size: 0.8rem;
  }

  .password-icon,
  .copy-icon {
    font-size: 0.9rem;
  }

  .header-actions {
    gap: 0.375rem;
  }

  .action-toggle,
  .sidebar-toggle {
    width: 2.25rem;
    height: 2.25rem;
  }
}

/* Планшеты */
@media (min-width: 769px) and (max-width: 1024px) {
  .app-header {
    padding: 1rem;
  }

  .header-title h1 {
    font-size: 1.15rem;
  }

  .password-display {
    min-width: 180px;
  }
}

/* Улучшения для touch devices */
@media (hover: none) and (pointer: coarse) {
  .sidebar-toggle,
  .action-toggle,
  .password-display {
    min-height: 44px;
  }

  .password-display {
    min-height: 52px;
  }

  .sidebar-toggle:active,
  .action-toggle:active,
  .password-display:active {
    transform: scale(0.98);
    opacity: 0.8;
  }
}

/* Убираем подсветку при тапе на iOS */
.sidebar-toggle,
.action-toggle,
.password-display {
  -webkit-tap-highlight-color: transparent;
}

/* Анимация пульсации для cron при включении */
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(76, 175, 80, 0); }
  100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); }
}

.cron-enabled {
  animation: pulse 2s infinite;
}
</style>