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

    <!-- Timer Popup -->
    <Dialog 
      v-model:visible="showPopup" 
      modal 
      :header="popupTitle"
      :style="{ width: '450px' }"
      :closable="false"
    >
      <div class="popup-content">
        <div class="slider-container">
          <div class="selected-time text-center mb-4">
            Selected: <strong>{{ selectedTimeText }}</strong>
          </div>
          
          <Slider
            v-model="sliderValue"
            :min="1"
            :max="maxSteps"
            :step="1"
            class="time-slider mb-3"
          />
          
          <div class="slider-labels flex justify-content-between">
            <span>10 min</span>
            <span>7 days</span>
          </div>

          <!-- Быстрый выбор времени -->
          <div class="quick-selection mt-4">
            <h4 class="text-center mb-3">Quick Select:</h4>
            <div class="quick-buttons grid">
              <Button 
                v-for="time in quickTimes" 
                :key="time.value"
                :label="time.label" 
                class="p-button-outlined p-button-sm"
                @click="setQuickTime(time.value)"
                :class="{ 'p-button-warning': sliderValue === time.value }"
              />
            </div>
          </div>
        </div>
      </div>
      
      <template #footer>
        <Button 
          label="Cancel" 
          icon="pi pi-times" 
          class="p-button-text" 
          @click="closePopup"
        />
        <Button 
          :label="popupActionButton" 
          icon="pi pi-check" 
          class="p-button-primary" 
          @click="confirmAction"
        />
      </template>
    </Dialog>

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
import Slider from 'primevue/slider'

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
const sliderValue = ref(2) 
const timerSeconds = ref(0)
const timerInterval = ref(null)
const isExtending = ref(false)

const generateTimeSteps = () => {
  const steps = [0, 10, 15, 30, 45];

  // Зона 2: 1–11 часов (шаг 30 мин)
  for (let h = 1; h <= 11; h++) {
    steps.push(h * 60);        // XX:00
    steps.push(h * 60 + 30);  // XX:30
  }

  // Явно добавляем 12:00 (ровно 12 часов)
  steps.push(720);

  // Зона 3: 13–24 часов (шаг 1 час)
  for (let h = 13; h <= 24; h++) {
    steps.push(h * 60);
  }

  // Зона 4: 1–7 дней (шаг 24 часа)
  for (let d = 1; d <= 7; d++) {
    steps.push(d * 1440);
  }

  return [...new Set(steps)].sort((a, b) => a - b);
};



// console.log(generateTimeSteps().join(', '));
const timeSteps = generateTimeSteps()
const maxSteps = timeSteps.length

// // Проверим правильность генерации
// console.log('Time steps:', timeSteps)
// console.log('1 hour (60 min) at index:', timeSteps.findIndex(min => min === 60) + 1)
// console.log('2 hours (120 min) at index:', timeSteps.findIndex(min => min === 120) + 1)
// console.log('4 hours (240 min) at index:', timeSteps.findIndex(min => min === 240) + 1)
// console.log('8 hours (480 min) at index:', timeSteps.findIndex(min => min === 480) + 1)
// console.log('12 hours (720 min) at index:', timeSteps.findIndex(min => min === 720) + 1)

const quickTimes = [
  { label: '10 min', value: 2 },    // 10 мин → Step 2
  { label: '15 min', value: 3 },    // 15 мин → Step 3
  { label: '30 min', value: 4 },    // 30 мин → Step 4
  { label: '45 min', value: 5 },    // 45 мин → Step 5
  { label: '1 hour', value: 6 },     // 60 мин → Step 6
  { label: '2 hours', value: 8 },    // 120 мин → Step 8
  { label: '4 hours', value: 12 },   // 240 мин → Step 12
  { label: '8 hours', value: 20 },   // 480 мин → Step 20
  { label: '12 hours', value: 28 },  // 720 мин → Step 28
  { label: '1 day', value: 40 }     // 1440 мин → Step 40
];


// Computed properties
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
  
const selectedTimeText = computed(() => {
  // console.group('SelectedTimeText Calculation');
  // console.log('Slider value (step):', sliderValue.value);
  
  const totalMinutes = getMinutesFromStep(sliderValue.value);
  // console.log('Total minutes:', totalMinutes);
  
  const formatted = formatBookingTime(totalMinutes);
  // console.log('Formatted:', formatted);
  
  console.groupEnd();
  return formatted;
});

  
const popupTitle = computed(() => {
  return isExtending.value ? 'Extend Booking' : 'Select time to book'
})
  
const popupActionButton = computed(() => {
  return isExtending.value ? 'Extend' : 'Book'
})
  
// Methods
const getMinutesFromStep = (step) => {
  const index = Math.min(Math.max(step - 1, 0), timeSteps.length - 1)
  const minutes = timeSteps[index]
  // console.log(`Step ${step} = ${minutes} minutes (${minutes/60} hours)`)
  return minutes
}

const getStepFromMinutes = (minutes) => {
  for (let i = 0; i < timeSteps.length; i++) {
    if (timeSteps[i] >= minutes) {
      return i + 1
    }
  }
  return maxSteps
}

const formatBookingTime = (totalMinutes) => {
  if (totalMinutes === 0) return '0 minutes';

  const days = Math.floor(totalMinutes / 1440);
  const remainingMinutes = totalMinutes % 1440;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  // console.log(`Форматирование: ${totalMinutes} мин = ${days} д. ${hours} ч. ${minutes} мин`);

  const parts = [];

  // Дни
  if (days > 0) {
    parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  }

  // Часы
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  }

  // Минуты (только если нет дней и часов)
  if (minutes > 0 && days === 0 && hours === 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  }

  return parts.join(' ') || '0 minutes';
};



const formatTime = (seconds) => {
  const d = Math.floor(seconds / 86400)
  const h = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0')
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  const dayText = d === 1 ? 'day' : 'days'
  return `${d} ${dayText} ${h}:${m}:${s}`
}

const setQuickTime = (step) => {
  sliderValue.value = step
  const minutes = getMinutesFromStep(step)
  const expectedLabel = quickTimes.find(t => t.value === step)?.label
  // console.log(`Quick time: step=${step}, minutes=${minutes}, expected=${expectedLabel}`)
}

const handleBookingChange = async () => {
  try {
    if (!localBookingStatus.value.isBooked) {
      isExtending.value = false
      sliderValue.value = 2
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

const confirmAction = async () => {
  const totalMinutes = getMinutesFromStep(sliderValue.value)
  const totalSeconds = totalMinutes * 60

  // console.log(`Confirming: slider=${sliderValue.value}, minutes=${totalMinutes}, formatted=${formatBookingTime(totalMinutes)}`)

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
    const defaultExtendMinutes = currentMinutes + 60
    sliderValue.value = getStepFromMinutes(defaultExtendMinutes)
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
  // console.table(
  //   timeSteps.map((min, idx) => ({
  //     Step: idx + 1,
  //     Minutes: min,
  //     Hours: (min / 60).toFixed(1),
  //     Label: formatBookingTime(min),
  //   }))
  // );
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

.popup-content {
padding: 1rem 0;
}

.time-slider {
width: 100%;
}

.slider-labels {
font-size: 0.875rem;
color: var(--text-color-secondary);
}

.confirmation-content {
display: flex;
align-items: center;
padding: 1rem;
}

.quick-selection {
border-top: 1px solid var(--surface-200);
padding-top: 1rem;
}

.quick-buttons {
grid-template-columns: repeat(4, 1fr);
gap: 0.5rem;
}

:deep(.quick-buttons .p-button) {
font-size: 0.75rem;
padding: 0.5rem;
}

@media (max-width: 480px) {
.quick-buttons {
  grid-template-columns: repeat(2, 1fr);
}
}
</style>