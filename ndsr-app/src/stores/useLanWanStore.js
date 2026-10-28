// stores/useLanWanStore.js — схема «LAN роутера как WAN» (сервер:
// services/lanWanService.js). links — [{ consumerId, upstreamId, vlan,
// owner, lanSubnet, lanChanged }], рассылка lanWan:links всем.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { socket } from '@/socket'

const ask = (event, data, timeoutMs) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('No response from server')), timeoutMs)
  socket.emit(event, data, (res) => {
    clearTimeout(timer)
    if (res?.success) resolve(res)
    else reject(new Error(res?.error || res?.message || 'Operation failed'))
  })
})

export const useLanWanStore = defineStore('lanWan', () => {
  const links = ref([])

  socket.on('lanWan:links', (list) => { links.value = Array.isArray(list) ? list : [] })
  const refresh = () => socket.emit('lanWan:list', (res) => { if (res?.success) links.value = res.links })
  socket.on('connect', refresh)
  if (socket.connected) refresh()

  const linkOf = (id) => links.value.find(l => l.consumerId === String(id)) || null
  const consumersOf = (id) => links.value.filter(l => l.upstreamId === String(id))
  const isInChain = (id) => !!linkOf(id) || consumersOf(id).length > 0

  // Схемы: корень (сам WAN не из LAN) → дерево потребителей
  const chains = computed(() => {
    const roots = new Set()
    for (const l of links.value) {
      let top = l.upstreamId
      const seen = new Set()
      while (linkOf(top) && !seen.has(top)) { seen.add(top); top = linkOf(top).upstreamId }
      roots.add(top)
    }
    const build = (id, depth = 0) => ({
      id,
      depth,
      link: linkOf(id),
      children: depth > 20 ? [] : consumersOf(id).map(c => build(c.consumerId, depth + 1))
    })
    return [...roots].map(r => build(r))
  })

  // Роутеры одной схемы (для подтверждения снятия брони)
  const componentOf = (id) => {
    const seen = new Set()
    const queue = [String(id)]
    while (queue.length) {
      const cur = queue.shift()
      if (seen.has(cur)) continue
      seen.add(cur)
      const l = linkOf(cur)
      if (l) queue.push(l.upstreamId)
      queue.push(...consumersOf(cur).map(c => c.consumerId))
    }
    return seen.size > 1 ? [...seen] : []
  }

  const plan = (consumerId, upstreamId) => ask('lanWan:plan', { consumerId, upstreamId }, 60000).then(r => r.plan)
  const apply = (consumerId, upstreamId, lan) => ask('lanWan:apply', { consumerId, upstreamId, lan }, 5 * 60000)
  const dismantle = (deviceId) => ask('lanWan:dismantle', { deviceId }, 5 * 60000)

  return { links, chains, linkOf, consumersOf, isInChain, componentOf, plan, apply, dismantle, refresh }
})
