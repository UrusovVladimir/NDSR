<template>
  <div class="flex align-items-center gap-2">
    <div class="status-indicator" :class="indicatorClass">
      <i :class="statusIcon"></i>
    </div>
    <span class="status-text">{{ statusText }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: Number,
  type: String
})

const statusText = computed(() => {
  // console.log('🔍 StatusIndicator: status =', props.status) // ДЛЯ ОТЛАДКИ
  if (props.status === undefined || props.status === null) return 'Unknown'
  return props.status === 200 ? 'Online' : 'Offline'
})

const indicatorClass = computed(() => {
  if (props.status === undefined || props.status === null) return 'status-unknown'
  return props.status === 200 ? 'status-online' : 'status-offline'
})

const statusIcon = computed(() => {
  if (props.status === undefined || props.status === null) return 'pi pi-question-circle'
  return props.status === 200 ? 'pi pi-check-circle' : 'pi pi-times-circle'
})
</script>

<style scoped>
.status-indicator {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 0.875rem;
  flex-shrink: 0;
}

.status-online {
  background-color: #22c55e;
}

.status-offline {
  background-color: #ef4444;
}

.status-unknown {
  background-color: #6b7280;
}

.status-text {
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
}

/* Адаптивность */
@media (max-width: 768px) {
  .status-indicator {
    width: 20px;
    height: 20px;
    font-size: 0.75rem;
  }
  
  .status-text {
    font-size: 0.8rem;
  }
}
</style>