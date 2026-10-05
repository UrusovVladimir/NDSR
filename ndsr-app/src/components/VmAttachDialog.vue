<template>
  <Dialog
    :visible="visible"
    modal
    :header="`Attach VMs — ${device?.shortName || device?.hwId || ''}`"
    :style="{ width: '640px', maxWidth: '95vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div v-if="vmStore.vms.length === 0" class="vm-empty">
      No test VMs configured (vms.json).
    </div>

    <template v-else>
      <!-- Подключённые к этому устройству -->
      <section v-if="attachedHere.length" class="vm-section">
        <h4 class="vm-section-title">Attached to this device</h4>
        <div v-for="vm in attachedHere" :key="vm.id" class="vm-card attached">
          <div class="vm-card-head">
            <div>
              <div class="vm-name"><i class="bi bi-pc-display mr-2"></i>{{ vm.name }}</div>
              <small class="text-color-secondary">{{ vm.os }}</small>
            </div>
            <Button
              label="Detach"
              icon="pi pi-times"
              class="p-button-sm p-button-outlined p-button-danger"
              :loading="vmStore.isBusy(vm.id)"
              @click="detach(vm)"
            />
          </div>

          <div class="vm-rows">
            <div class="vm-row">
              <span class="vm-label">IP in router LAN</span>
              <span v-if="vm.attachment.ip" class="vm-value mono">{{ vm.attachment.ip }}</span>
              <span v-else-if="vm.attachment.ipPending" class="vm-value">
                <i class="pi pi-spin pi-spinner mr-1"></i> Waiting for DHCP…
              </span>
              <span v-else class="vm-value text-color-secondary">{{ ipReasonText(vm.attachment.ipReason) }}</span>
              <!-- Повтор DHCP доступен всегда (в т.ч. если ожидание «зависло») -->
              <i
                class="pi pi-refresh vm-icon-btn"
                role="button"
                tabindex="0"
                aria-label="Refresh address"
                v-tooltip="'Look up the address in the router DHCP table'"
                @click="renewIp(vm)"
                @keydown.enter="renewIp(vm)"
              ></i>
            </div>

            <template v-if="access[vm.id]">
              <div class="vm-row">
                <span class="vm-label">RDP address</span>
                <span class="vm-value mono">{{ rdpAddress(vm) }}</span>
                <i class="pi pi-copy vm-icon-btn" role="button" tabindex="0" aria-label="Copy RDP address"
                  v-tooltip="'Copy'" @click="copy(rdpAddress(vm), 'RDP address copied')"
                  @keydown.enter="copy(rdpAddress(vm), 'RDP address copied')"></i>
              </div>
              <div class="vm-row">
                <span class="vm-label">User</span>
                <span class="vm-value mono">{{ access[vm.id].username }}</span>
                <i class="pi pi-copy vm-icon-btn" role="button" tabindex="0" aria-label="Copy user"
                  v-tooltip="'Copy'" @click="copy(access[vm.id].username, 'User copied')"
                  @keydown.enter="copy(access[vm.id].username, 'User copied')"></i>
              </div>
              <div class="vm-row">
                <span class="vm-label">Password</span>
                <span class="vm-value mono">{{ access[vm.id].password }}</span>
                <i class="pi pi-copy vm-icon-btn" role="button" tabindex="0" aria-label="Copy password"
                  v-tooltip="'Copy'" @click="copy(access[vm.id].password, 'Password copied')"
                  @keydown.enter="copy(access[vm.id].password, 'Password copied')"></i>
              </div>
              <div class="vm-actions">
                <Button
                  v-if="access[vm.id].browserRdp"
                  label="Open in browser"
                  icon="pi pi-window-maximize"
                  class="p-button-sm"
                  @click="openInBrowser(vm)"
                />
                <Button
                  label="Download .rdp"
                  icon="pi pi-download"
                  class="p-button-sm p-button-outlined"
                  @click="downloadRdp(vm)"
                />
                <small class="text-color-secondary">
                  RDP is open only from your IP while the device is booked.
                </small>
              </div>
            </template>
            <div v-else class="vm-row text-color-secondary">
              <i class="pi pi-spin pi-spinner mr-1"></i> Loading RDP access…
            </div>
          </div>
        </div>
      </section>

      <!-- Остальные -->
      <section class="vm-section">
        <h4 class="vm-section-title">Available VMs</h4>
        <div v-if="others.length === 0" class="vm-empty">All VMs are attached to this device.</div>
        <div v-for="vm in others" :key="vm.id" class="vm-card">
          <div class="vm-card-head">
            <div>
              <div class="vm-name"><i class="bi bi-pc-display mr-2"></i>{{ vm.name }}</div>
              <small class="text-color-secondary">
                {{ vm.os }}
                <template v-if="vm.attachment">
                  · {{ isMine(vm) ? 'your VM on' : `in use by ${userName(vm)} on` }} {{ vm.attachment.deviceName }}
                </template>
              </small>
            </div>
            <Button
              :label="vm.attachment && isMine(vm) ? 'Move here' : 'Attach'"
              icon="pi pi-link"
              class="p-button-sm"
              :disabled="!!vm.attachment && !isMine(vm)"
              :loading="vmStore.isBusy(vm.id)"
              @click="attach(vm)"
            />
          </div>
        </div>
      </section>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { useVmStore } from '@/stores/useVmStore'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useClipboardStore } from '@/stores/useClipboardStore'

const props = defineProps({
  device: { type: Object, default: null },
  visible: { type: Boolean, default: false }
})
defineEmits(['update:visible'])

const toast = useToast()
const vmStore = useVmStore()
const deviceStore = useDeviceStore()
const clipboardStore = useClipboardStore()

// Учётка RDP по vmId — запрашивается у сервера только для своих VM
const access = ref({})

const attachedHere = computed(() =>
  props.device ? vmStore.vmsForDevice(props.device.id) : []
)
const others = computed(() =>
  vmStore.vms.filter(vm => !attachedHere.value.some(a => a.id === vm.id))
)

// Почему адреса нет (адрес берётся из таблицы DHCP роутера по MAC VM)
const IP_REASONS = {
  'no-mac': 'Unknown — lanMac is not set in vms.json',
  rival: 'Unknown for rival routers — see ipconfig in Windows',
  auth: 'Router login failed — check the device password',
  cooldown: 'Router login paused after a failure — retry in a minute',
  unreachable: 'Router is unreachable',
  'not-found': 'Not in the router DHCP table yet'
}
const ipReasonText = (reason) => IP_REASONS[reason] || 'No address'

const isMine = (vm) => vm.attachment?.attachedBy === deviceStore.currentUserId
const userName = (vm) => deviceStore.getUserName(vm.attachment?.attachedBy)
const rdpAddress = (vm) => `${access.value[vm.id].host}:${access.value[vm.id].port}`

const loadAccess = async () => {
  for (const vm of attachedHere.value) {
    if (access.value[vm.id] || !isMine(vm)) continue
    try {
      access.value = { ...access.value, [vm.id]: await vmStore.getAccess(vm.id) }
    } catch (err) {
      toast.add({ severity: 'error', summary: 'RDP access', detail: err.message, life: 4000 })
    }
  }
}

watch(() => [props.visible, attachedHere.value.map(vm => vm.id).join(',')], ([visible]) => {
  if (visible) loadAccess()
}, { immediate: true })

const attach = async (vm) => {
  try {
    await vmStore.attach(vm.id, props.device.id)
    toast.add({ severity: 'success', summary: 'VM attached', detail: `${vm.name} is joining the router LAN`, life: 3000 })
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Attach failed', detail: err.message, life: 5000 })
  }
}

const detach = async (vm) => {
  try {
    await vmStore.detach(vm.id)
    const { [vm.id]: _, ...rest } = access.value
    access.value = rest
    toast.add({ severity: 'info', summary: 'VM detached', detail: vm.name, life: 3000 })
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Detach failed', detail: err.message, life: 5000 })
  }
}

const renewIp = async (vm) => {
  try {
    await vmStore.renewIp(vm.id)
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Renew IP failed', detail: err.message, life: 4000 })
  }
}

const copy = (text, message) => clipboardStore.copyToClipboard(text, message)

// Окно открываем синхронно по клику (иначе блокировщик попапов), адрес с
// токеном подставляем, когда он придёт. Токен — в #hash: на сервер не уходит.
const openInBrowser = async (vm) => {
  const win = window.open('', `rdp-${vm.id}`, 'width=1280,height=800,resizable=yes')
  try {
    const { token } = await vmStore.getRdpToken(vm.id)
    const hash = new URLSearchParams({ vm: vm.id, t: token, name: vm.name }).toString()
    const url = `${import.meta.env.BASE_URL}rdp.html#${hash}`
    if (win) win.location.href = url
    else window.open(url, `rdp-${vm.id}`)
  } catch (err) {
    win?.close()
    toast.add({ severity: 'error', summary: 'Browser RDP', detail: err.message, life: 5000 })
  }
}

// Пароль в .rdp открытым текстом не кладётся (mstsc его не примет) —
// только адрес и пользователь, пароль вводится при подключении
const downloadRdp = (vm) => {
  const a = access.value[vm.id]
  const content = [
    `full address:s:${a.host}:${a.port}`,
    `username:s:${a.username}`,
    'prompt for credentials:i:1',
    'administrative session:i:0',
    'screen mode id:i:2'
  ].join('\r\n') + '\r\n'
  const url = URL.createObjectURL(new Blob([content], { type: 'application/x-rdp' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${vm.name.replace(/[^\w.-]+/g, '_')}.rdp`
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.vm-section + .vm-section {
  margin-top: 1.25rem;
}

.vm-section-title {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
  font-weight: 600;
}

.vm-card {
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-bottom: 0.5rem;
}

.vm-card.attached {
  border-color: var(--primary-color);
}

.vm-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.vm-name {
  font-weight: 600;
}

.vm-rows {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.vm-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.vm-label {
  min-width: 8.5rem;
  color: var(--text-color-secondary);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.vm-icon-btn {
  cursor: pointer;
  color: var(--primary-color);
  font-size: 0.85rem;
}

.vm-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.vm-empty {
  color: var(--text-color-secondary);
  padding: 0.5rem 0;
}
</style>
