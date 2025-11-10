<template>
    <div class="countdown-timer" :class="timerClass">
      <span v-if="!expiresAt || expiresAt === undefined" class="no-time">
        No time data
      </span>
      <span v-else-if="timeLeft <= 0" class="expired">
        Expired
      </span>
      <span v-else class="time-left">
        {{ formatTime(timeLeft) }}
      </span>
    </div>
  </template>
  
  <script setup>
  import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
  
  const props = defineProps({
    expiresAt: {
      type: Number,
      default: 0 // ✅ Защита по умолчанию
    }
  })
  
  const emit = defineEmits(['expired'])
  
  const timeLeft = ref(0)
  let interval = null
  
  // ✅ ЗАЩИТА: Проверяем корректность expiresAt
  const isValidExpiresAt = computed(() => {
    return props.expiresAt && typeof props.expiresAt === 'number' && props.expiresAt > 0
  })
  
  const timerClass = computed(() => {
    if (!isValidExpiresAt.value) return 'invalid'
    if (timeLeft.value <= 0) return 'expired'
    if (timeLeft.value < 3600) return 'warning' // Меньше часа
    if (timeLeft.value < 7200) return 'caution' // Меньше 2 часов
    return 'normal'
  })
  
  const calculateTimeLeft = () => {
    if (!isValidExpiresAt.value) {
      timeLeft.value = 0
      return
    }
    
    const now = Math.floor(Date.now() / 1000)
    timeLeft.value = Math.max(0, props.expiresAt - now)
    
    if (timeLeft.value <= 0) {
      clearInterval(interval)
      emit('expired')
    }
  }
  
  const formatTime = (seconds) => {
    if (!seconds || seconds <= 0) return '00:00:00'
    
    const d = Math.floor(seconds / 86400)
    const h = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0')
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
    const s = String(seconds % 60).padStart(2, '0')
    
    if (d > 0) {
      return `${d}d ${h}:${m}:${s}`
    }
    return `${h}:${m}:${s}`
  }
  
  onMounted(() => {
    calculateTimeLeft()
    
    if (isValidExpiresAt.value) {
      interval = setInterval(calculateTimeLeft, 1000)
    }
  })
  
  onUnmounted(() => {
    if (interval) {
      clearInterval(interval)
    }
  })
  
  // Следим за изменениями expiresAt
  watch(() => props.expiresAt, (newExpiresAt) => {
    console.log('CountdownTimer: expiresAt changed', newExpiresAt)
    
    if (interval) {
      clearInterval(interval)
    }
    
    if (newExpiresAt && typeof newExpiresAt === 'number' && newExpiresAt > 0) {
      calculateTimeLeft()
      interval = setInterval(calculateTimeLeft, 1000)
    } else {
      timeLeft.value = 0
    }
  })
  </script>
  
  <style scoped>
  .countdown-timer {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }
  
  .countdown-timer.normal {
    background: var(--green-50);
    color: var(--green-700);
    border: 1px solid var(--green-200);
  }
  
  .countdown-timer.caution {
    background: var(--yellow-50);
    color: var(--yellow-700);
    border: 1px solid var(--yellow-200);
  }
  
  .countdown-timer.warning {
    background: var(--orange-50);
    color: var(--orange-700);
    border: 1px solid var(--orange-200);
  }
  
  .countdown-timer.expired {
    background: var(--red-50);
    color: var(--red-700);
    border: 1px solid var(--red-200);
  }
  
  .countdown-timer.invalid {
    background: var(--gray-50);
    color: var(--gray-500);
    border: 1px solid var(--gray-200);
    font-style: italic;
  }
  
  .no-time, .expired {
    font-size: 0.8rem;
  }
  </style>