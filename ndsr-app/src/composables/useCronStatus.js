import { ref, onMounted, onUnmounted } from 'vue'
import { socket } from '@/socket'

export function useCronStatus() {
  const cronEnabled = ref(false)

  const handleCronStatus = (status) => {
    cronEnabled.value = status
    console.log('Received current cron status:', status)
  }

  const toggleCron = (newValue) => {
    cronEnabled.value = newValue
    socket.emit('cron:toggle', newValue)
    // console.log(`Auto-release cron is now ${newValue ? 'ENABLED' : 'DISABLED'}`)
  }

  onMounted(() => {
    socket.on('cron:status', handleCronStatus)
    socket.emit('cron:get-status') // <-- Это важно
  })

  onUnmounted(() => {
    socket.off('cron:status', handleCronStatus)
  })

  return {
    cronEnabled,
    toggleCron
  }
}
