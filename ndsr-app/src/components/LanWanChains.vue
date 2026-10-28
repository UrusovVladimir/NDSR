<template>
  <!-- Схемы «LAN роутера как WAN» с участием моих броней -->
  <div v-if="myChains.length" class="lw-chains">
    <div class="lw-header">
      <i class="pi pi-sitemap"></i>
      <span>WAN chains (router LAN as WAN)</span>
    </div>
    <div v-for="chain in myChains" :key="chain.id" class="lw-chain">
      <LanWanChainNode :node="chain" />
      <Button
        label="Dismantle"
        icon="pi pi-times-circle"
        class="p-button-sm p-button-outlined p-button-danger lw-dismantle"
        :loading="busy.has(chain.id)"
        v-tooltip.bottom="'WAN ports of all routers of this chain → off, changed LAN subnets restored'"
        @click="dismantle(chain)"
      />
    </div>
  </div>
</template>

<script setup>
// Наглядно: кто чей WAN, подсети; разборка всей схемы (lanWan:dismantle).
// Снятие брони / сброс любого звена разбирает схему автоматически (сервер).
import { ref, computed } from 'vue'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import LanWanChainNode from './LanWanChainNode.vue'
import { useLanWanStore } from '@/stores/useLanWanStore'
import { useDeviceStore } from '@/stores/useDeviceStore'

const toast = useToast()
const lanWanStore = useLanWanStore()
const deviceStore = useDeviceStore()
const busy = ref(new Set())

const ids = (node) => [node.id, ...node.children.flatMap(ids)]
const myChains = computed(() => lanWanStore.chains.filter(chain =>
  ids(chain).some(id => deviceStore.devices.find(d => String(d.id) === String(id))?.booking?.bookedBy === deviceStore.currentUserId)))

const nameOf = (id) => deviceStore.devices.find(d => String(d.id) === String(id))?.hwId || id

const dismantle = async (chain) => {
  const names = ids(chain).map(nameOf).join(', ')
  if (!window.confirm(`Dismantle the WAN chain ${names}?\n\nWAN ports of the routers are turned off and changed LAN subnets are restored.`)) return
  busy.value = new Set([...busy.value, chain.id])
  try {
    await lanWanStore.dismantle(chain.id)
    toast.add({ severity: 'success', summary: 'WAN chain dismantled', detail: names, life: 4000 })
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Dismantle failed', detail: err.message, life: 8000 })
  } finally {
    const next = new Set(busy.value)
    next.delete(chain.id)
    busy.value = next
  }
}
</script>

<style scoped>
.lw-chains {
  margin: 0.75rem 1rem;
  padding: 0.6rem 0.9rem;
  border: 1px dashed var(--surface-300);
  border-radius: 10px;
  background: var(--surface-50);
}

.lw-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.lw-chain {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.3rem 0;
}

.lw-chain + .lw-chain {
  border-top: 1px solid var(--surface-200);
}

.lw-dismantle {
  margin-top: 0.35rem;
}
</style>
