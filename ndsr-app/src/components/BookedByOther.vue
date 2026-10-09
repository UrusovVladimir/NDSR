<template>
  <div class="booked-by-other">
    <Tag :value="userName" severity="warning" />
    <span v-if="remaining" class="booked-left" v-tooltip.bottom="untilText">{{ remaining }}</span>
  </div>
</template>

<script setup>
// Бронь чужим пользователем: кто и сколько осталось. expiresAt (unix, сек)
// приходит в device.booking всем клиентам; отсчёт — по общим часам страницы.
import { computed } from 'vue'
import Tag from 'primevue/tag'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useNow } from '@/composables/useNow'

const props = defineProps({
  booking: { type: Object, required: true }
})

const deviceStore = useDeviceStore()
const now = useNow()

const userName = computed(() => deviceStore.getUserName(props.booking.bookedBy))

const remaining = computed(() => {
  if (!props.booking.expiresAt) return ''
  const minutes = Math.ceil((props.booking.expiresAt * 1000 - now.value) / 60000)
  if (minutes <= 0) return 'ending'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h ${mins}m left`
  return `${mins}m left`
})

const untilText = computed(() => props.booking.expiresAt
  ? `Until ${new Date(props.booking.expiresAt * 1000).toLocaleString()}`
  : '')
</script>

<style scoped>
.booked-by-other {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
}

.booked-left {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
  white-space: nowrap;
}
</style>
