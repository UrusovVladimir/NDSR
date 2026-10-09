<template>
  <Dialog
    :visible="visible"
    modal
    :header="header"
    :style="{ width: '450px' }"
    :closable="false"
    @update:visible="v => !v && cancel()"
  >
    <!-- Над ползунком: например, список устройств массовой брони -->
    <slot />

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
              :class="{ 'p-button-warning': sliderValue === time.value }"
              @click="sliderValue = time.value"
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
        :disabled="loading"
        @click="cancel"
      />
      <Button
        :label="actionLabel"
        icon="pi pi-check"
        class="p-button-primary"
        :loading="loading"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>

<script setup>
// Выбор длительности брони (ползунок 10 мин … 7 дней + быстрые кнопки).
// Общий для одиночной брони/продления (BookingStatus) и массовой брони
// (DeviceDataTable). confirm отдаёт длительность в секундах.
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Slider from 'primevue/slider'
import Button from 'primevue/button'

const props = defineProps({
  visible: { type: Boolean, default: false },
  header: { type: String, default: 'Select time to book' },
  actionLabel: { type: String, default: 'Book' },
  // Значение ползунка при открытии (округляется вверх до ближайшего шага)
  initialMinutes: { type: Number, default: 10 },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['update:visible', 'confirm', 'cancel'])

// Шаги: 10–45 мин, 1–11 ч по 30 мин, 12–24 ч по часу, 1–7 дней
const generateTimeSteps = () => {
  const steps = [0, 10, 15, 30, 45]
  for (let h = 1; h <= 11; h++) {
    steps.push(h * 60)
    steps.push(h * 60 + 30)
  }
  steps.push(720)
  for (let h = 13; h <= 24; h++) steps.push(h * 60)
  for (let d = 1; d <= 7; d++) steps.push(d * 1440)
  return [...new Set(steps)].sort((a, b) => a - b)
}

const timeSteps = generateTimeSteps()
const maxSteps = timeSteps.length

const quickTimes = [
  { label: '10 min', value: 2 },
  { label: '15 min', value: 3 },
  { label: '30 min', value: 4 },
  { label: '45 min', value: 5 },
  { label: '1 hour', value: 6 },
  { label: '2 hours', value: 8 },
  { label: '4 hours', value: 12 },
  { label: '8 hours', value: 20 },
  { label: '12 hours', value: 28 },
  { label: '1 day', value: 40 }
]

const getMinutesFromStep = (step) => {
  const index = Math.min(Math.max(step - 1, 0), timeSteps.length - 1)
  return timeSteps[index]
}

const getStepFromMinutes = (minutes) => {
  const i = timeSteps.findIndex(m => m >= minutes)
  return i === -1 ? maxSteps : i + 1
}

const sliderValue = ref(getStepFromMinutes(props.initialMinutes))

// Каждое открытие начинается с initialMinutes
watch(() => props.visible, (v) => {
  if (v) sliderValue.value = getStepFromMinutes(props.initialMinutes)
})

const formatBookingTime = (totalMinutes) => {
  if (totalMinutes === 0) return '0 minutes'
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts = []
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (minutes > 0 && days === 0 && hours === 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
  return parts.join(' ') || '0 minutes'
}

const selectedTimeText = computed(() => formatBookingTime(getMinutesFromStep(sliderValue.value)))

const confirm = () => emit('confirm', getMinutesFromStep(sliderValue.value) * 60)

const cancel = () => {
  emit('update:visible', false)
  emit('cancel')
}
</script>

<style scoped>
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
