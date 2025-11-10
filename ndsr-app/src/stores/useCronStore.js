// stores/useCronStore.js
import { defineStore } from 'pinia'
import { ref, onMounted, onUnmounted } from 'vue'
import { socket } from '@/socket'
import { useToast } from 'primevue/usetoast'
  

export const useCronStore = defineStore('cron', () => {
  const toast = useToast()
  const cronEnabled = ref(false)
  const isLoading = ref(false)
  const isInitialized = ref(false)


  const initializeSocketListeners = () => {
    socket.on('cron:status', handleCronStatus)
  }

  const cleanupSocketListeners = () => {
    socket.off('cron:status', handleCronStatus)
  }

  const handleCronStatus = (status) => {
    // console.log('✅ Cron status received:', status, typeof status)
    
    if (status === true || status === false) {
      cronEnabled.value = status
      isInitialized.value = true
    } else {
      console.warn('⚠️ Unexpected cron status format:', status)
      cronEnabled.value = false
      isInitialized.value = true
    }
  }

  const toggleCron = async (newValue) => {
    if (isLoading.value) {
      console.log('⏳ Cron toggle already in progress')
      return
    }
    
    const booleanValue = !!newValue
    console.log(`🔄 Toggling cron to: ${booleanValue}`)
    
    isLoading.value = true
    
    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Server is not responding'))
        }, 5000)

        socket.emit('cron:toggle', booleanValue, (response) => {
          clearTimeout(timeoutId)
          
          if (response?.success) {
            resolve(response)
          } else {
            reject(new Error(response?.error || 'Toggle failed'))
          }
        })
      })
      
      toast.add({
        severity: 'success',
        summary: `Auto-release ${booleanValue ? 'enabled' : 'disabled'}`,
        detail: booleanValue 
          ? 'All devices that are not booked will be reset at 3:00 a.m.'
          : '',
        life: booleanValue 
          ? 5000 
          : 2000
      });
      
    } catch (error) {
      console.error('❌ Cron toggle failed:', error)
      toast.add({ severity: 'error', summary: `Failed to update auto-release: ${error.message}`})
      
      
    } finally {
      isLoading.value = false
    }
  }

  const getCronStatus = () => {
    console.log('🔄 Requesting cron status...')
    socket.emit('cron:get-status')
  }

  onMounted(() => {
    // console.log('🔌 Setting up cron listeners...')
    
    socket.on('cron:status', handleCronStatus)
    
    setTimeout(() => {
      getCronStatus()
    }, 1000)
    
    setTimeout(() => {
      if (!isInitialized.value) {
        console.warn('⚠️ Cron initialization timeout, assuming false')
        isInitialized.value = true
        cronEnabled.value = false
      }
    }, 10000)

    onUnmounted(() => {
    //   console.log('🔌 Cleaning up cron listeners...')
      socket.off('cron:status', handleCronStatus)
    })
  })

  return {
    cronEnabled,
    isLoading,
    isInitialized,
    toggleCron,
    getCronStatus,
    initializeSocketListeners,
    cleanupSocketListeners
  }
})