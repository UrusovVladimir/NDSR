<template>
  <!-- WAN = LAN другого роутера (окно WAN Settings, вариант «Router LAN») -->
  <div class="lanwan-panel">
    <h5 class="section-title">WAN from another router's LAN</h5>

    <label class="block text-sm font-semibold mb-1" for="lanwan-upstream">Router whose LAN becomes the WAN of {{ device?.hwId }}</label>
    <Dropdown
      inputId="lanwan-upstream"
      v-model="upstreamId"
      :options="upstreamOptions"
      optionLabel="label"
      optionValue="id"
      optionDisabled="disabled"
      placeholder="Select one of your booked routers"
      class="w-full mb-2"
      :disabled="busy"
    />
    <small v-if="!upstreamOptions.length" class="text-color-secondary block mb-2">
      Book another router first — only your booked routers in router mode can be used.
    </small>

    <div v-if="checking" class="flex align-items-center gap-2 my-2 text-color-secondary">
      <i class="pi pi-spin pi-spinner"></i> Checking LAN subnets of both routers…
    </div>
    <Message v-else-if="planError" severity="error" :closable="false" class="my-2">{{ planError }}</Message>

    <template v-else-if="plan">
      <div class="lanwan-scheme my-2">
        <div class="lanwan-node">
          <b>{{ plan.upstream.hwId }}</b>
          <small>LAN {{ plan.upstream.lan.subnet }} · VLAN {{ plan.upstream.vlan }}</small>
        </div>
        <i class="pi pi-arrow-right"></i>
        <div class="lanwan-node">
          <b>{{ plan.consumer.hwId }}</b>
          <small>WAN ← LAN of {{ plan.upstream.hwId }}</small>
          <small>LAN {{ resultSubnet }}</small>
        </div>
      </div>

      <Message v-if="plan.extenders.length && plan.conflict" severity="error" :closable="false" class="my-2">
        {{ plan.consumer.hwId }} has connected extenders — disconnect them first: its LAN has to change.
      </Message>

      <template v-if="plan.conflict">
        <Message severity="warn" :closable="false" class="my-2">
          Both routers use {{ plan.consumer.lan.subnet }}. The LAN of {{ plan.consumer.hwId }} (and its DHCP pool) must change.
        </Message>
        <div class="flex flex-column gap-2 mb-2">
          <div class="flex align-items-center gap-2">
            <RadioButton v-model="lanMode" inputId="lanwan-auto" value="auto" :disabled="busy" />
            <label for="lanwan-auto">
              Next subnet: <b>{{ plan.suggestion.ip }}/24</b>
              <small v-if="plan.suggestion.pool" class="text-color-secondary">
                (DHCP {{ plan.suggestion.pool.begin }} – {{ plan.suggestion.pool.end }})
              </small>
            </label>
          </div>
          <div class="flex align-items-center gap-2">
            <RadioButton v-model="lanMode" inputId="lanwan-manual" value="manual" :disabled="busy" />
            <label for="lanwan-manual">Manual:</label>
            <InputText v-model="manualIp" placeholder="192.168.5.1" class="p-inputtext-sm" style="width: 10rem"
              :disabled="busy || lanMode !== 'manual'" />
            <span class="text-color-secondary">/24</span>
          </div>
          <small v-if="lanMode === 'manual' && manualError" class="text-red-500">{{ manualError }}</small>
        </div>
      </template>
      <Message v-else severity="success" :closable="false" class="my-2">
        Subnets differ ({{ plan.consumer.lan.subnet }} / {{ plan.upstream.lan.subnet }}) — the LAN of {{ plan.consumer.hwId }} stays as is.
      </Message>

      <small class="text-color-secondary block">
        Switch: WAN primary port of {{ plan.consumer.hwId }} → untagged VLAN {{ plan.upstream.vlan }}, second WAN port off.
        The scheme is dismantled automatically when a router of it is released, its booking ends or it is factory reset.
      </small>
    </template>
  </div>
</template>

<script setup>
// Панель WAN Settings для типа «Router LAN»: выбор вышестоящего роутера (свои
// брони, режим router, без колец), проверка подсетей (lanWan:plan), выбор
// новой подсети потребителя при совпадении. apply() вызывает окно по Apply.
import { ref, computed, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Dropdown from 'primevue/dropdown'
import RadioButton from 'primevue/radiobutton'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useModeStore } from '@/stores/useModeStore'
import { useLanWanStore } from '@/stores/useLanWanStore'
import { isRival } from '@/utils/deviceFlags'

const props = defineProps({ device: { type: Object, default: null } })
const emit = defineEmits(['can-apply'])

const toast = useToast()
const deviceStore = useDeviceStore()
const modeStore = useModeStore()
const lanWanStore = useLanWanStore()

const upstreamId = ref(lanWanStore.linkOf(props.device?.id)?.upstreamId || null)
const plan = ref(null)
const planError = ref('')
const checking = ref(false)
const busy = ref(false)
const lanMode = ref('auto')
const manualIp = ref('')

// Вверх по цепочке кандидата не должно быть самого устройства (кольцо)
const leadsTo = (fromId, targetId) => {
  let cur = String(fromId)
  const seen = new Set()
  while (cur && !seen.has(cur)) {
    if (cur === String(targetId)) return true
    seen.add(cur)
    cur = lanWanStore.linkOf(cur)?.upstreamId
  }
  return false
}

const upstreamOptions = computed(() => deviceStore.devices
  .filter(d => d.type === 'router' && String(d.id) !== String(props.device?.id) && !isRival(d) &&
    d.booking?.isBooked && d.booking.bookedBy === deviceStore.currentUserId)
  .map(d => {
    const mode = modeStore.getDeviceModeInfo(d.id)?.mode
    const extender = mode === 'extender' || mode === 'extender_connect'
    const loop = leadsTo(d.id, props.device?.id)
    return {
      id: String(d.id),
      label: `${d.hwId}${d.shortName ? ` · ${d.shortName}` : ''}${extender ? ' — extender mode' : ''}${loop ? ' — would make a loop' : ''}`,
      disabled: extender || loop
    }
  }))

const runPlan = async () => {
  plan.value = null
  planError.value = ''
  if (!upstreamId.value || !props.device) return
  checking.value = true
  try {
    plan.value = await lanWanStore.plan(String(props.device.id), upstreamId.value)
    lanMode.value = 'auto'
  } catch (err) {
    planError.value = err.message
  } finally {
    checking.value = false
  }
}
watch(upstreamId, runPlan, { immediate: true })

const isIpv4 = (ip) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(o => Number(o) <= 255)
const manualError = computed(() => {
  if (lanMode.value !== 'manual') return ''
  if (!isIpv4(manualIp.value)) return 'Enter an IPv4 address, e.g. 192.168.5.1'
  const net = (ip) => ip.split('.').slice(0, 3).join('.')
  if (plan.value && net(manualIp.value) === net(plan.value.upstream.lan.ip)) return `Overlaps the LAN of ${plan.value.upstream.hwId}`
  return ''
})

const resultSubnet = computed(() => {
  if (!plan.value) return ''
  if (!plan.value.conflict) return plan.value.consumer.lan.subnet
  if (lanMode.value === 'manual') return isIpv4(manualIp.value) ? `${manualIp.value.split('.').slice(0, 3).join('.')}.0/24` : '…'
  return `${plan.value.suggestion.ip.split('.').slice(0, 3).join('.')}.0/24`
})

const canApply = computed(() => !!plan.value && !busy.value &&
  !(plan.value.conflict && plan.value.extenders.length) &&
  !(plan.value.conflict && lanMode.value === 'manual' && manualError.value))
watch(canApply, (v) => emit('can-apply', v), { immediate: true })

const apply = async () => {
  if (!canApply.value) return false
  busy.value = true
  try {
    const lan = !plan.value.conflict ? { mode: 'keep' }
      : lanMode.value === 'manual' ? { mode: 'manual', ip: manualIp.value } : { mode: 'auto' }
    await lanWanStore.apply(String(props.device.id), upstreamId.value, lan)
    toast.add({
      severity: 'success',
      summary: 'WAN from router LAN',
      detail: `${plan.value.consumer.hwId}: WAN = LAN of ${plan.value.upstream.hwId}`,
      life: 5000
    })
    return true
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Router LAN as WAN failed', detail: err.message, life: 8000 })
    return false
  } finally {
    busy.value = false
  }
}

defineExpose({ apply })
</script>

<style scoped>
.lanwan-panel {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--surface-200);
}

.lanwan-scheme {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.lanwan-node {
  display: flex;
  flex-direction: column;
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--surface-300);
  border-radius: 8px;
  background: var(--surface-50);
  line-height: 1.3;
}

.lanwan-node small {
  color: var(--text-color-secondary);
}
</style>
