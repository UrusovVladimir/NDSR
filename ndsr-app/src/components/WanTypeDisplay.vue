<template>
  <div class="wan-type-display">
    <div class="flex align-items-center gap-2">
      <Tag 
        :value="currentWanType" 
        severity="info"
        class="wan-tag"
      />
      <Button 
        icon="pi pi-cog" 
        class="p-button-sm p-button-outlined p-button-info p-button-rounded wan-btn"
        v-tooltip.bottom="'Change WAN Type'"
        @click="openModal" 
        :disabled="!canChangeWan"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { socket } from '@/socket'
import Tag from 'primevue/tag'
import Button from 'primevue/button'

const props = defineProps({
  device: Object,
  wanTypes: Array,
  currentUserId: [String, Number]
})

const emit = defineEmits(['open-modal'])

const currentWanType = ref('Not configured')

// ✅ УБРАНА ПРОВЕРКА БРОНИРОВАНИЯ
const canChangeWan = computed(() => {
  return props.device.type === 'router' && 
         props.device.statusCode === 200
})

// Метод для открытия модального окна
const openModal = () => {
  if (canChangeWan.value) {
    emit('open-modal', props.device, 'wanTypes')
  }
}

const updateWanType = (response) => {
  currentWanType.value = !response?.type || response?.type === 'Clear WAN type'
    ? 'Not configured'
    : response.type
}

const handleWanTypeUpdate = ({ deviceId, type }) => {
  if (deviceId === props.device.id) {
    currentWanType.value = type === 'Clear WAN type'
      ? 'Not configured'
      : type || 'Not configured'
  }
}

onMounted(() => {
  // Загружаем текущий WAN тип
  socket.emit('device:getCurrentWan', props.device.id, updateWanType)
  socket.on('device:wanTypeUpdated', handleWanTypeUpdate)
})

onUnmounted(() => {
  socket.off('device:wanTypeUpdated', handleWanTypeUpdate)
})
</script>

<style scoped>
.wan-type-display {
  display: flex;
  justify-content: center;
  align-items: center;
}

.wan-tag {
  max-width: 120px;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
}
</style>

<style>
/* Глобальные стили для кнопки WAN */
.wan-btn.p-button {
  border-radius: 50% !important;
  width: 2.5rem !important;
  height: 2.5rem !important;
  transition: all 0.3s ease !important;
  border: 2px solid var(--blue-300) !important;
  color: var(--blue-600) !important;
  background: transparent !important;
}

.wan-btn.p-button:hover {
  background: var(--blue-50) !important;
  border-color: var(--blue-500) !important;
  color: var(--blue-700) !important;
  transform: translateY(-2px) !important;
  box-shadow: 0 4px 8px rgba(59, 130, 246, 0.2) !important;
}

.wan-btn.p-button:active {
  transform: translateY(0) !important;
}

.wan-btn.p-button:disabled {
  opacity: 0.3 !important;
  cursor: not-allowed !important;
  transform: none !important;
  box-shadow: none !important;
}

/* Адаптивность */
@media (max-width: 768px) {
  .wan-btn.p-button {
    width: 2.25rem !important;
    height: 2.25rem !important;
    border-width: 1.5px !important;
  }
  
  .wan-tag {
    font-size: 0.7rem;
    max-width: 100px;
  }
}

@media (max-width: 480px) {
  .wan-btn.p-button {
    width: 2rem !important;
    height: 2rem !important;
    border-width: 1px !important;
  }
  
  .wan-tag {
    font-size: 0.65rem;
    max-width: 80px;
  }
  
  .flex.align-items-center.gap-2 {
    gap: 0.5rem !important;
  }
}
:deep(.wan-column .wan-type-display) {
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
  width: 100% !important;
}
</style>