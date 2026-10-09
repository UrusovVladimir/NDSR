<template>
  <Dialog
    v-model:visible="adminStore.showBulkPower"
    modal
    header="Bulk Power / Reset"
    :style="{ width: '820px', maxWidth: '95vw' }"
    class="admin-bulk-dialog"
  >
    <div class="bulk-toolbar">
      <span class="p-input-icon-left bulk-filter">
        <i class="pi pi-search" />
        <InputText v-model="filter" placeholder="Filter devices..." class="w-full" />
      </span>
      <Button label="All" class="p-button-sm p-button-outlined" :disabled="adminStore.running" @click="selectAll" />
      <Button label="None" class="p-button-sm p-button-outlined" :disabled="adminStore.running" @click="selected = new Set()" />
      <Button
        label="Refresh power"
        icon="pi pi-sync"
        class="p-button-sm p-button-text"
        :disabled="adminStore.running || !selected.size"
        v-tooltip.bottom="'Read power state of the selected devices from PowerHub'"
        @click="start('status')"
      />
      <span class="bulk-count">Selected {{ selected.size }} of {{ allDevices.length }}</span>
    </div>

    <div class="bulk-list">
      <div
        v-for="d in visibleDevices"
        :key="d.id"
        class="bulk-row"
        :class="{ 'is-selected': selected.has(String(d.id)) }"
        @click="toggle(d)"
      >
        <Checkbox :model-value="selected.has(String(d.id))" binary class="bulk-row-check" />
        <i class="pi pi-circle-fill status-dot" :class="d.statusCode === 200 ? 'online' : 'offline'"
           v-tooltip.bottom="d.statusCode === 200 ? 'Online' : 'Offline'" />
        <div class="bulk-device">
          <span class="bulk-device-name">{{ d.hwId }}</span>
          <span class="bulk-device-sub">{{ d.shortName }}</span>
        </div>
        <Tag v-if="isRival(d)" value="Rival" severity="secondary" class="bulk-tag" />
        <Tag :value="`Power: ${powerOf(d)}`" :severity="powerSeverity(d)" class="bulk-tag" />
        <span v-if="d.booking?.isBooked" class="bulk-booked">
          <i class="pi pi-lock"></i> {{ deviceStore.getUserName(d.booking.bookedBy) }}
        </span>
        <span class="bulk-state" :class="jobItem(d)?.state">
          <template v-if="jobItem(d)">
            <i v-if="jobItem(d).state === 'running'" class="pi pi-spin pi-spinner"></i>
            <i v-else-if="jobItem(d).state === 'done'" class="pi pi-check"></i>
            <i v-else-if="jobItem(d).state === 'error'" class="pi pi-times"></i>
            <i v-else class="pi pi-clock"></i>
            {{ jobItem(d).message }}
          </template>
        </span>
      </div>
      <div v-if="!visibleDevices.length" class="bulk-empty">No devices</div>
    </div>

    <div v-if="adminStore.job && !adminStore.job.running" class="bulk-summary">
      {{ actionLabels[adminStore.job.action] }}: {{ adminStore.job.done }} ok<span v-if="adminStore.job.failed?.length">, {{ adminStore.job.failed.length }} failed</span>
    </div>

    <template #footer>
      <div class="bulk-actions">
        <Button label="Power On" icon="pi pi-power-off" class="p-button-success p-button-sm"
                :disabled="!canRun" @click="askConfirm('on')" />
        <Button label="Power Off" icon="pi pi-power-off" class="p-button-warning p-button-sm"
                :disabled="!canRun" @click="askConfirm('off')" />
        <Button label="Reboot" icon="pi pi-refresh" class="p-button-info p-button-sm"
                :disabled="!canRun" @click="askConfirm('reboot')" />
        <Button label="Factory Reset" icon="pi pi-replay" class="p-button-danger p-button-sm"
                :disabled="!canRun" @click="askConfirm('reset')" />
        <span v-if="adminStore.running" class="bulk-running">
          <i class="pi pi-spin pi-spinner"></i> {{ actionLabels[adminStore.job.action] }} in progress…
        </span>
      </div>
    </template>
  </Dialog>

  <!-- Подтверждение -->
  <Dialog
    v-model:visible="confirm.visible"
    modal
    :header="`${actionLabels[confirm.action] || ''}: ${confirmTargets.length} device(s)`"
    :style="{ width: '480px' }"
  >
    <p class="mt-0">
      {{ actionLabels[confirm.action] }} for:
      <strong>{{ confirmTargets.map(d => d.hwId).join(', ') }}</strong>
    </p>
    <Message v-if="bookedByOthers.length" severity="warn" :closable="false">
      Booked by other users: {{ bookedByOthers.map(d => `${d.hwId} (${deviceStore.getUserName(d.booking.bookedBy)})`).join(', ') }}
    </Message>
    <Message v-if="skippedRivals.length" severity="info" :closable="false">
      Rival devices are never factory reset — skipped: {{ skippedRivals.map(d => d.hwId).join(', ') }}
    </Message>
    <template #footer>
      <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="confirm.visible = false" />
      <Button
        :label="actionLabels[confirm.action]"
        icon="pi pi-check"
        :class="confirm.action === 'reset' ? 'p-button-danger' : 'p-button-primary'"
        :disabled="!confirmTargets.length"
        @click="confirmRun"
      />
    </template>
  </Dialog>
</template>

<script setup>
// Массовое управление питанием и сбросом — только администратору (ADMIN_IPS).
// Брони не учитываются: администратор управляет стендом целиком; чужие брони
// показываются в подтверждении. Ход операции — по событиям admin:bulkProgress.
import { ref, reactive, computed, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Checkbox from 'primevue/checkbox'
import { useAdminStore } from '@/stores/useAdminStore'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useDeviceActionsStore } from '@/stores/useDeviceActionsStore'
import { isRival } from '@/utils/deviceFlags'

const adminStore = useAdminStore()
const deviceStore = useDeviceStore()
const actionsStore = useDeviceActionsStore()
const toast = useToast()

const actionLabels = {
  status: 'Refresh power',
  on: 'Power On',
  off: 'Power Off',
  reboot: 'Reboot',
  reset: 'Factory Reset'
}

const filter = ref('')
const selected = ref(new Set())
const confirm = reactive({ visible: false, action: null })

const allDevices = computed(() =>
  [...deviceStore.devices].sort((a, b) => String(a.hwId).localeCompare(String(b.hwId)))
)

const visibleDevices = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return allDevices.value
  return allDevices.value.filter(d =>
    [d.hwId, d.shortName, d.id].some(v => String(v || '').toLowerCase().includes(q)))
})

const selectedDevices = computed(() => allDevices.value.filter(d => selected.value.has(String(d.id))))
const canRun = computed(() => !adminStore.running && selected.value.size > 0)

const toggle = (d) => {
  if (adminStore.running) return
  const next = new Set(selected.value)
  const id = String(d.id)
  next.has(id) ? next.delete(id) : next.add(id)
  selected.value = next
}

// «All» — все видимые (с учётом фильтра)
const selectAll = () => {
  selected.value = new Set([...selected.value, ...visibleDevices.value.map(d => String(d.id))])
}

const powerOf = (d) => actionsStore.getPowerStatus(d.id) || 'unknown'
const powerSeverity = (d) => ({ on: 'success', off: 'danger' }[powerOf(d)] || 'secondary')
const jobItem = (d) => adminStore.job?.items?.[String(d.id)]

const confirmTargets = computed(() =>
  confirm.action === 'reset' ? selectedDevices.value.filter(d => !isRival(d)) : selectedDevices.value)
const skippedRivals = computed(() =>
  confirm.action === 'reset' ? selectedDevices.value.filter(d => isRival(d)) : [])
const bookedByOthers = computed(() => confirmTargets.value.filter(d =>
  d.booking?.isBooked && d.booking.bookedBy !== deviceStore.currentUserId))

const askConfirm = (action) => {
  confirm.action = action
  confirm.visible = true
}

const start = async (action, devicesList = selectedDevices.value) => {
  try {
    await adminStore.runBulk(action, devicesList.map(d => String(d.id)))
  } catch (error) {
    toast.add({ severity: 'error', summary: actionLabels[action], detail: error.message, life: 6000 })
  }
}

const confirmRun = () => {
  const targets = confirmTargets.value
  confirm.visible = false
  start(confirm.action, targets)
}

// Итог операции — тостом
watch(() => adminStore.job?.running, (now, before) => {
  const job = adminStore.job
  if (before && !now && job) {
    const failed = job.failed?.length || 0
    toast.add({
      severity: failed ? 'warn' : 'success',
      summary: actionLabels[job.action],
      detail: `${job.done} of ${job.total} done${failed ? `, ${failed} failed` : ''}`,
      life: 6000
    })
  }
})
</script>

<style scoped>
.bulk-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.bulk-filter {
  flex: 1 1 220px;
}

.bulk-count {
  margin-left: auto;
  font-size: 0.85rem;
  color: var(--text-color-secondary);
  white-space: nowrap;
}

.bulk-list {
  max-height: 55vh;
  overflow-y: auto;
  border: 1px solid var(--surface-200);
  border-radius: 8px;
}

.bulk-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--surface-100);
  cursor: pointer;
}

.bulk-row:last-child {
  border-bottom: none;
}

.bulk-row:hover {
  background: var(--surface-50);
}

.bulk-row.is-selected {
  background: var(--primary-50, #eef2ff);
}

/* Галочка только показывает состояние — переключает клик по строке */
.bulk-row-check {
  pointer-events: none;
}

.status-dot {
  font-size: 0.55rem;
}

.status-dot.online {
  color: var(--green-500);
}

.status-dot.offline {
  color: var(--red-500);
}

.bulk-device {
  display: flex;
  flex-direction: column;
  min-width: 140px;
}

.bulk-device-name {
  font-weight: 600;
}

.bulk-device-sub {
  font-size: 0.8rem;
  color: var(--text-color-secondary);
}

.bulk-tag {
  font-size: 0.7rem;
}

.bulk-booked {
  font-size: 0.8rem;
  color: var(--orange-600);
  white-space: nowrap;
}

.bulk-state {
  margin-left: auto;
  font-size: 0.8rem;
  text-align: right;
  max-width: 260px;
  color: var(--text-color-secondary);
}

.bulk-state.done {
  color: var(--green-600);
}

.bulk-state.error {
  color: var(--red-600);
}

.bulk-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-color-secondary);
}

.bulk-summary {
  margin-top: 0.75rem;
  font-size: 0.9rem;
}

.bulk-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.bulk-running {
  margin-left: auto;
  font-size: 0.85rem;
  color: var(--text-color-secondary);
}
</style>
