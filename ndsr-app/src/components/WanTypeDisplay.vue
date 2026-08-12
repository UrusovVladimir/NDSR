<template>
  <div class="wan-type-display">
    <span v-if="!isOwnedByCurrentUser" class="text-color-secondary">
      Not available
    </span>
    <div v-else class="flex align-items-center gap-2">
      <!-- Обычный WAN -->
      <Tag 
        v-if="!isDualWan"
        :value="displayWanType" 
        :severity="getWanSeverity(displayWanType)"
        class="wan-tag"
      />
      <!-- Dual WAN -->
      <div v-else class="dual-wan-tags">
        <Tag 
          :value="wan1Display" 
          severity="info"
          class="wan-tag dual-tag"
        />
        <span class="dual-separator">+</span>
        <Tag 
          :value="wan2Display" 
          severity="warning"
          class="wan-tag dual-tag"
        />
      </div>
      
      <Button 
        icon="pi pi-cog" 
        class="p-button-sm p-button-outlined p-button-info p-button-rounded wan-btn"
        v-tooltip.bottom="'Change WAN Type'"
        @click="openModal" 
        :disabled="!canChangeWan || !props.device.booking?.isBooked"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { socket } from '@/socket'
import { useDeviceStore } from '@/stores/useDeviceStore'
import Tag from 'primevue/tag'
import Button from 'primevue/button'

const deviceStore = useDeviceStore()

const props = defineProps({
  device: Object,
  wanTypes: Array,
  currentUserId: [String, Number]
})

const emit = defineEmits(['open-modal'])

const currentWanType = ref(null)
const isDualWan = ref(false)
const wan1 = ref(null)
const wan2 = ref(null)
const isLoading = ref(false)

const isOwnedByCurrentUser = computed(() => {
  return !props.device.booking?.isBooked || 
         props.device.booking?.bookedBy === props.currentUserId
})

const canChangeWan = computed(() => {
  return isOwnedByCurrentUser.value && 
         props.device.type === 'router' && 
         props.device.statusCode === 200
})

// ✅ ОТОБРАЖАЕМОЕ ИМЯ ДЛЯ ОБЫЧНОГО WAN
const displayWanType = computed(() => {
  if (!currentWanType.value) return 'Not configured'
  
  // Если это строка - ищем по vlanId
  if (typeof currentWanType.value === 'string') {
    // Clear WAN type (vlanId = 4094)
    if (currentWanType.value === '4094') {
      return 'Not configured'
    }
    const found = props.wanTypes?.find(w => String(w.vlanId) === String(currentWanType.value))
    return found?.type || currentWanType.value
  }
  
  return 'Not configured'
})

// ✅ ОТОБРАЖАЕМОЕ ИМЯ ДЛЯ WAN 1
const wan1Display = computed(() => {
  if (!wan1.value) return null
  if (wan1.value === '4094') return 'Not configured'
  const found = props.wanTypes?.find(w => String(w.vlanId) === String(wan1.value))
  return found?.type || wan1.value
})

// ✅ ОТОБРАЖАЕМОЕ ИМЯ ДЛЯ WAN 2
const wan2Display = computed(() => {
  if (!wan2.value) return null
  if (wan2.value === '4094') return 'Not configured'
  const found = props.wanTypes?.find(w => String(w.vlanId) === String(wan2.value))
  return found?.type || wan2.value
})

// ✅ СЕВЕРИТИ ДЛЯ ТЕГА
const getWanSeverity = (type) => {
  if (!type || type === 'Not configured') return 'secondary'
  return 'info'
}

// Метод для открытия модального окна
const openModal = () => {
  if (canChangeWan.value) {
    emit('open-modal', props.device, 'wanTypes')
  }
}

// ✅ ОБРАБОТКА ДАННЫХ
const processWanData = (data) => {
  if (!data) {
    isDualWan.value = false
    currentWanType.value = null
    wan1.value = null
    wan2.value = null
    return
  }
  
  // Проверяем на Dual WAN
  if (data && typeof data === 'object' && data.type === 'dual_wan') {
    isDualWan.value = true
    currentWanType.value = data
    wan1.value = data.wan1 || null
    wan2.value = data.wan2 || null
  } else if (data && typeof data === 'object' && data.isDualWan) {
    isDualWan.value = true
    currentWanType.value = data.type || data
    wan1.value = data.wan1 || null
    wan2.value = data.wan2 || null
  } else {
    isDualWan.value = false
    currentWanType.value = data || null
    wan1.value = null
    wan2.value = null
  }
}

// ✅ ЗАГРУЗКА ТЕКУЩЕГО WAN ТИПА
const fetchCurrentWan = async () => {
  try {
    isLoading.value = true
    
    // Сначала проверяем в store
    let wanData = deviceStore.getDeviceWanTypeFromMap?.(props.device.id)
    
    if (wanData) {
      processWanData(wanData)
    } else {
      // Запрашиваем с сервера
      const response = await new Promise((resolve) => {
        socket.emit('device:getCurrentWan', props.device.id, (response) => {
          resolve(response)
        })
        setTimeout(() => resolve({ type: null }), 10000)
      })
      
      if (response) {
        processWanData(response.type || response)
      }
    }
  } catch (error) {
    console.error('❌ Error fetching WAN type:', error)
  } finally {
    isLoading.value = false
  }
}

// ✅ ОБРАБОТЧИК ОБНОВЛЕНИЯ WAN ТИПА
const handleWanTypeUpdate = ({ deviceId, type }) => {
  if (deviceId === props.device.id) {
    processWanData(type)
  }
}

onMounted(() => {
  fetchCurrentWan()
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

/* ✅ СТИЛИ ДЛЯ DUAL WAN */
.dual-wan-tags {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
  justify-content: center;
}

.dual-tag {
  font-size: 0.7rem;
  max-width: 80px;
}

.dual-separator {
  font-weight: bold;
  color: var(--text-color-secondary);
  font-size: 0.7rem;
}

/* Адаптивность */
@media (max-width: 768px) {
  .wan-tag {
    font-size: 0.7rem;
    max-width: 100px;
  }
  
  .dual-tag {
    font-size: 0.65rem;
    max-width: 70px;
  }
}

@media (max-width: 480px) {
  .wan-tag {
    font-size: 0.65rem;
    max-width: 80px;
  }
  
  .dual-tag {
    font-size: 0.6rem;
    max-width: 60px;
  }
  
  .dual-separator {
    font-size: 0.6rem;
  }
}
</style>

<style>
/* Глобальные стили для кнопки WAN - такие же как у extend-btn */
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
  opacity: 0.6 !important;
  cursor: not-allowed;
}

/* Адаптивность для кнопки WAN */
@media (max-width: 768px) {
  .wan-btn.p-button {
      width: 2.25rem !important;
      height: 2.25rem !important;
      border-width: 1.5px !important;
  }
}

@media (max-width: 480px) {
  .wan-btn.p-button {
      width: 2rem !important;
      height: 2rem !important;
      border-width: 1px !important;
  }
}
</style>