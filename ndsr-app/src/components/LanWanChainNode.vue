<template>
  <!-- Узел схемы «LAN как WAN»: роутер и его потребители (рекурсивно) -->
  <div class="lw-node-wrap" :class="{ child: depth > 0 }">
    <div class="lw-node" :class="{ mine: isMine, offline: device && device.statusCode !== 200 }">
      <i class="pi pi-circle-fill lw-dot"></i>
      <div class="lw-text">
        <b>{{ device ? device.hwId : node.id }}<span v-if="device?.shortName" class="lw-short"> · {{ device.shortName }}</span></b>
        <small v-if="node.link">
          WAN ← LAN of {{ parentName }} (VLAN {{ node.link.vlan }})
          <template v-if="node.link.lanSubnet"> · LAN {{ node.link.lanSubnet }}<span v-if="node.link.lanChanged"> (changed)</span></template>
        </small>
        <small v-else>WAN source for {{ node.children.length }} router{{ node.children.length === 1 ? '' : 's' }}</small>
      </div>
    </div>
    <div v-if="node.children.length" class="lw-children">
      <LanWanChainNode v-for="c in node.children" :key="c.id" :node="c" :depth="depth + 1" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDeviceStore } from '@/stores/useDeviceStore'

const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 }
})

const deviceStore = useDeviceStore()
const device = computed(() => deviceStore.devices.find(d => String(d.id) === String(props.node.id)))
const isMine = computed(() => device.value?.booking?.bookedBy === deviceStore.currentUserId)
const parentName = computed(() => {
  const id = props.node.link?.upstreamId
  return deviceStore.devices.find(d => String(d.id) === String(id))?.hwId || id
})
</script>

<style scoped>
.lw-node-wrap.child {
  margin-left: 1.25rem;
  padding-left: 0.9rem;
  border-left: 2px solid var(--primary-200, #c7d2fe);
  position: relative;
}

.lw-node-wrap.child::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 1.15rem;
  width: 0.9rem;
  border-top: 2px solid var(--primary-200, #c7d2fe);
}

.lw-node {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.3rem 0;
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--surface-300);
  border-radius: 8px;
  background: var(--surface-0);
}

.lw-node.mine {
  border-color: var(--primary-300, #a5b4fc);
}

.lw-dot {
  font-size: 0.5rem;
  color: var(--green-500);
}

.lw-node.offline .lw-dot {
  color: var(--red-500);
}

.lw-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.lw-text small,
.lw-short {
  color: var(--text-color-secondary);
  font-weight: 400;
}
</style>
