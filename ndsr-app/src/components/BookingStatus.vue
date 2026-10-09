<template>
  <div class="booking-status">
    <div v-if="localBookingStatus.isBooked" class="flex align-items-center gap-2">
      <Tag 
        :value="bookingText" 
        :severity="bookingSeverity"
        class="booking-tag"
      />
      <Chip 
        v-if="isCurrentUserBooking"
        :label="formatTime(timerSeconds)"
        icon="pi pi-clock"
        class="time-chip"
        :severity="timeSeverity"
      />
      
      <!-- Кнопки управления для текущего пользователя -->
      <div v-if="isCurrentUserBooking" class="flex align-items-center gap-1">
        <Button 
          icon="pi pi-plus" 
          class="p-button-text p-button-sm p-button-success"
          v-tooltip.bottom="'Extend booking'"
          @click="extendBooking"
        />
        <Button 
          icon="pi pi-times" 
          class="p-button-text p-button-sm p-button-danger"
          v-tooltip.bottom="'Release device'"
          @click="releaseBooking"
        />
      </div>
    </div>
    
    <div v-else class="toggle-wrapper">
      <ToggleButton
        v-model="isSelected"
        onLabel="Book"
        offLabel="Available"
        onIcon="pi pi-lock"
        offIcon="pi pi-lock-open"
        class="booking-toggle"
        :disabled="shouldDisableToggle"
        @change="handleBookingChange"
      />
    </div>

    <!-- Выбор длительности: бронь / продление -->
    <BookingDurationDialog
      v-model:visible="showPopup"
      :header="popupTitle"
      :action-label="popupActionButton"
      :initial-minutes="initialMinutes"
      @confirm="confirmAction"
      @cancel="closePopup"
    />

    <!-- Confirm Release Dialog -->
    <Dialog 
      v-model:visible="showReleaseConfirm" 
      modal 
      header="Release Device"
      :style="{ width: '400px' }"
    >
      <div class="confirmation-content">
        <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #e74c3c;" />
        <span>Are you sure you want to release this device?</span>
      </div>
      <template #footer>
        <Button 
          label="No" 
          icon="pi pi-times" 
          class="p-button-text" 
          @click="showReleaseConfirm = false"
        />
        <Button 
          label="Yes" 
          icon="pi pi-check" 
          class="p-button-danger" 
          @click="confirmRelease"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useDeviceStore } from '@/stores/useDeviceStore'
import ToggleButton from 'primevue/togglebutton'
import Tag from 'primevue/tag'
import Chip from 'primevue/chip'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import BookingDurationDialog from './BookingDurationDialog.vue'

const toast = useToast()
const deviceStore = useDeviceStore()

const props = defineProps({
  device: Object,
  currentUserId: [String, Number],
  users: Array
})

// Reactive data
const isSelected = ref(false)
const showPopup = ref(false)
const showReleaseConfirm = ref(false)
const initialMinutes = ref(10)
const timerSeconds = ref(0)
const timerInterval = ref(null)
const isExtending = ref(false)

const localBookingStatus = computed(() => {
  return props.device.booking || {
    isBooked: false,
    bookedBy: null,
    expiresAt: 0,
    timerSeconds: 0,
    accessPassword: null
  }
})

const isCurrentUserBooking = computed(() => {
  return localBookingStatus.value.bookedBy === props.currentUserId
})

const bookingText = computed(() => {
  if (isCurrentUserBooking.value) return 'Your Booking'
  const userName = props.users.find(u => u.ip === localBookingStatus.value.bookedBy)?.name
  return `Booked by ${userName || localBookingStatus.value.bookedBy}`
})

const bookingSeverity = computed(() => {
  return isCurrentUserBooking.value ? 'success' : 'warning'
})

const timeSeverity = computed(() => {
  if (timerSeconds.value > 86400) return 'success'
  if (timerSeconds.value > 3600) return 'warning'
  return 'danger'
})

const shouldDisableToggle = computed(() => {
  return (localBookingStatus.value.isBooked && !isCurrentUserBooking.value) || 
         showPopup.value
})
  
const popupTitle = computed(() => {
  return isExtending.value ? 'Extend Booking' : 'Select time to book'
})
  
const popupActionButton = computed(() => {
  return isExtending.value ? 'Extend' : 'Book'
})
  
// Methods
const formatTime = (seconds) => {
  const d = Math.floor(seconds / 86400)
  const h = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0')
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  const dayText = d === 1 ? 'day' : 'days'
  return `${d} ${dayText} ${h}:${m}:${s}`
}

const handleBookingChange = async () => {
  try {
    if (!localBookingStatus.value.isBooked) {
      isExtending.value = false
      initialMinutes.value = 10
      showPopup.value = true
    } else {
      showReleaseConfirm.value = true
    }
  } catch (error) {
    console.error('Booking change error:', error)
  }
}

const releaseBooking = () => {
  showReleaseConfirm.value = true
}

const confirmRelease = async () => {
  try {
    // console.log('Releasing device:', props.device.id)
    await deviceStore.releaseDevice(props.device.id)
    showReleaseConfirm.value = false
    isSelected.value = false
  } catch (error) {
    console.error('Release error:', error)
    toast.add({
      severity: 'error',
      summary: 'Release Failed',
      detail: error.message,
      life: 5000
    })
  }
}

const closePopup = () => {
  showPopup.value = false
  isSelected.value = false
  isExtending.value = false
}

const confirmAction = async (totalSeconds) => {

  try {
    if (isExtending.value) {
      await deviceStore.extendBooking(String(props.device.id), totalSeconds)
    } else {
      await deviceStore.bookDevice(String(props.device.id), totalSeconds)
    }
    
    showPopup.value = false
    isExtending.value = false
  } catch (error) {
    console.error('Action failed:', error)
    toast.add({
      severity: 'error',
      summary: isExtending.value ? 'Extension Failed' : 'Booking Failed',
      detail: error.message,
      life: 5000
    })
  }
}

const extendBooking = async () => {
  try {
    isExtending.value = true
    const currentMinutes = Math.ceil(timerSeconds.value / 60)
    initialMinutes.value = currentMinutes + 60
    showPopup.value = true
  } catch (error) {
    console.warn('Extend booking error:', error)
    toast.add({
      severity: 'error',
      summary: 'Extend Failed',
      detail: error.message,
      life: 5000
    })
  }
}

// Timer functions
const startTimer = (seconds) => {
  timerSeconds.value = seconds
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
  }
  
  timerInterval.value = setInterval(() => {
    if (timerSeconds.value > 0) {
      timerSeconds.value--
    } else {
      clearInterval(timerInterval.value)
      isSelected.value = false
    }
  }, 1000)
}

// Watch for device booking changes
watch(() => props.device.booking, (newBooking) => {
  if (newBooking) {
    isSelected.value = newBooking.isBooked && newBooking.bookedBy === props.currentUserId
    
    if (newBooking.isBooked && newBooking.bookedBy === props.currentUserId) {
      startTimer(newBooking.remainingTime)
    } else {
      if (timerInterval.value) {
        clearInterval(timerInterval.value)
        timerSeconds.value = 0
      }
    }
  }
}, { deep: true })

// Инициализация при монтировании
onMounted(() => {
  if (props.device.booking) {
    isSelected.value = props.device.booking.isBooked && props.device.booking.bookedBy === props.currentUserId
    
    if (props.device.booking.isBooked && props.device.booking.bookedBy === props.currentUserId) {
      startTimer(props.device.booking.remainingTime)
    }
  }
})

onUnmounted(() => {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
  }
})
</script>

<style scoped>
.booking-status {
  display: flex;
  align-items: center;
  justify-content: center; 
  gap: 0.5rem;
  width: 100%;
  min-height: 40px;
}

.toggle-wrapper {
display: flex;
align-items: center;
}

.time-chip {
font-size: 0.75rem;
}

:deep(.booking-toggle .p-button) {
padding: 0 0.75rem;
font-size: 0.875rem;
height: 2rem;

}

.confirmation-content {
display: flex;
align-items: center;
padding: 1rem;
}

</style>