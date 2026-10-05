// stores/useVmStore.js — тестовые Windows VM, подключаемые в LAN устройства.
// Список приходит событием vm:list (init-пакет и любое изменение); логин и
// пароль RDP — только по запросу vm:getAccess и только тому, кто подключил VM.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { socket } from '@/socket'

const ACK_TIMEOUT = 30000

function emitWithAck(event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No response from server')), ACK_TIMEOUT)
    const done = (response) => {
      clearTimeout(timer)
      if (response?.success) resolve(response)
      else reject(new Error(response?.error || response?.message || 'Operation failed'))
    }
    if (payload === undefined) socket.emit(event, done)
    else socket.emit(event, payload, done)
  })
}

export const useVmStore = defineStore('vms', () => {
  const vms = ref([])
  const busyVmIds = ref(new Set())

  const setVms = (list) => {
    if (Array.isArray(list)) vms.value = list
  }

  // vm:list может прийти до создания стора — дозапрашиваем сами
  socket.on('vm:list', setVms)
  const refresh = () => emitWithAck('vm:list').then(r => setVms(r.vms)).catch(() => {})
  socket.on('connect', refresh)
  if (socket.connected) refresh()

  const vmsForDevice = (deviceId) =>
    vms.value.filter(vm => vm.attachment && String(vm.attachment.deviceId) === String(deviceId))

  const isBusy = (vmId) => busyVmIds.value.has(String(vmId))

  const withBusy = async (vmId, fn) => {
    const key = String(vmId)
    busyVmIds.value = new Set(busyVmIds.value).add(key)
    try {
      return await fn()
    } finally {
      const next = new Set(busyVmIds.value)
      next.delete(key)
      busyVmIds.value = next
    }
  }

  const attach = (vmId, deviceId) => withBusy(vmId, () => emitWithAck('vm:attach', { vmId, deviceId }))
  const detach = (vmId) => withBusy(vmId, () => emitWithAck('vm:detach', { vmId }))
  const renewIp = (vmId) => emitWithAck('vm:renewIp', { vmId })
  const getAccess = (vmId) => emitWithAck('vm:getAccess', { vmId }).then(r => r.access)
  const getRdpToken = (vmId) => emitWithAck('vm:getRdpToken', { vmId })

  return { vms, vmsForDevice, isBusy, attach, detach, renewIp, getAccess, getRdpToken, refresh }
})
