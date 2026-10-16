<template>
  <span v-if="total" class="shared-vms">
    <span
      class="shared-vms-count"
      :class="{ 'none-free': free === 0 }"
      role="button"
      tabindex="0"
      v-tooltip.bottom="'Shared VMs — who uses them and for how long'"
      @click="panel.toggle($event)"
      @keydown.enter="panel.toggle($event)"
    >
      <i class="pi pi-desktop"></i>
      {{ free }}/{{ total }} VMs free
    </span>

    <OverlayPanel ref="panel" class="shared-vms-panel">
      <div class="shared-vms-title">
        VMs: {{ free }} of {{ total }} free
      </div>
      <div class="shared-vms-list">
        <div v-for="vm in rows" :key="vm.id" class="shared-vm-row">
          <i class="pi pi-circle-fill shared-vm-dot" :class="vm.attachment ? 'busy' : 'free'"></i>
          <div class="shared-vm-name">
            <span>{{ vm.name }}</span>
            <small v-if="vm.os">{{ vm.os }}</small>
          </div>
          <template v-if="vm.attachment">
            <div class="shared-vm-owner">
              <span :class="{ mine: vm.mine }">{{ vm.mine ? 'You' : vm.user }}</span>
              <small>on {{ vm.device }}</small>
            </div>
            <span class="shared-vm-left" v-tooltip.left="vm.untilText">{{ vm.left }}</span>
          </template>
          <span v-else class="shared-vm-free">Free</span>
        </div>
      </div>
      <div class="shared-vms-hint">
        A VM is attached to a booked device and is released when that booking ends.
      </div>
    </OverlayPanel>
  </span>
</template>

<script setup>
// Сводка общих (shared) тестовых VM в шапке таблицы устройств (рядом со
// счётчиками online/offline/total): сколько свободно, кто занял,
// к какому устройству и на сколько. VM отключается вместе с окончанием брони
// устройства, поэтому «осталось» — время до booking.expiresAt этого устройства.
// Данные — vm:list (рассылается всем) и брони из deviceStore; бэкенд не нужен.
import { ref, computed } from 'vue'
import OverlayPanel from 'primevue/overlaypanel'
import { useVmStore } from '@/stores/useVmStore'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useNow } from '@/composables/useNow'

const vmStore = useVmStore()
const deviceStore = useDeviceStore()
const now = useNow()
const panel = ref(null)

const total = computed(() => vmStore.vms.length)
const free = computed(() => vmStore.vms.filter(vm => !vm.attachment).length)

const formatLeft = (expiresAt) => {
  if (!expiresAt) return ''
  const minutes = Math.ceil((expiresAt * 1000 - now.value) / 60000)
  if (minutes <= 0) return 'ending'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h ${mins}m left`
  return `${mins}m left`
}

const rows = computed(() => vmStore.vms.map(vm => {
  const a = vm.attachment
  if (!a) return { ...vm }
  const device = deviceStore.devices.find(d => String(d.id) === String(a.deviceId))
  const expiresAt = device?.booking?.isBooked ? device.booking.expiresAt : null
  return {
    ...vm,
    mine: a.attachedBy === deviceStore.currentUserId,
    user: deviceStore.getUserName(a.attachedBy),
    device: device ? (device.shortName ? `${device.hwId} · ${device.shortName}` : device.hwId) : a.deviceName,
    left: formatLeft(expiresAt),
    untilText: expiresAt ? `Until ${new Date(expiresAt * 1000).toLocaleString()}` : ''
  }
}).sort((x, y) => String(x.name).localeCompare(String(y.name), undefined, { numeric: true })))
</script>

<style scoped>
.shared-vms-count {
  margin-left: 0.6rem;
  color: #0d9488;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 1px dashed currentColor;
}

.shared-vms-count:hover {
  color: #0f766e;
}

/* Свободных нет — оранжевым */
.shared-vms-count.none-free {
  color: var(--orange-500);
}

.shared-vms-title {
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.shared-vms-list {
  display: flex;
  flex-direction: column;
  min-width: 380px;
  max-height: 60vh;
  overflow-y: auto;
}

.shared-vm-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.25rem;
  border-bottom: 1px solid var(--surface-100);
}

.shared-vm-row:last-child {
  border-bottom: none;
}

.shared-vm-dot {
  font-size: 0.55rem;
}

.shared-vm-dot.free {
  color: var(--green-500);
}

.shared-vm-dot.busy {
  color: var(--orange-500);
}

.shared-vm-name,
.shared-vm-owner {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.shared-vm-name {
  min-width: 110px;
  font-weight: 600;
}

.shared-vm-name small,
.shared-vm-owner small {
  font-weight: 400;
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

.shared-vm-owner .mine {
  color: var(--primary-color);
  font-weight: 600;
}

.shared-vm-left,
.shared-vm-free {
  margin-left: auto;
  font-size: 0.8rem;
  white-space: nowrap;
}

.shared-vm-left {
  color: var(--text-color-secondary);
}

.shared-vm-free {
  color: var(--green-600);
  font-weight: 600;
}

.shared-vms-hint {
  margin-top: 0.6rem;
  font-size: 0.75rem;
  color: var(--text-color-secondary);
  max-width: 380px;
}
</style>
