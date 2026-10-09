// stores/useAdminStore.js — администратор портала (ADMIN_IPS на бэкенде) и
// массовые операции с питанием/сбросом (admin:bulkPower). Права проверяет
// бэкенд; флаг isAdmin только прячет/показывает UI.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { socket } from '@/socket'

export const useAdminStore = defineStore('admin', () => {
  const isAdmin = ref(false)
  const showBulkPower = ref(false)

  // Текущая/последняя массовая операция
  const job = ref(null) // { jobId, action, total, running, items: { [deviceId]: { state, message } } }
  const running = computed(() => !!job.value?.running)

  const checkAdmin = () => {
    socket.emit('admin:whoami', (res) => {
      isAdmin.value = !!res?.isAdmin
    })
  }

  let initialized = false
  const init = () => {
    if (initialized) return
    initialized = true
    if (socket.connected) checkAdmin()
    socket.on('connect', checkAdmin)

    socket.on('admin:bulkProgress', ({ jobId, deviceId, state, message }) => {
      if (job.value?.jobId !== jobId) return
      job.value.items = { ...job.value.items, [deviceId]: { state, message: message || '' } }
    })
    socket.on('admin:bulkDone', (data) => {
      if (job.value?.jobId !== data.jobId) return
      job.value = { ...job.value, running: false, done: data.done, failed: data.failed }
    })
  }

  const runBulk = (action, deviceIds) => new Promise((resolve, reject) => {
    socket.emit('admin:bulkPower', { action, deviceIds }, (res) => {
      if (!res?.success) return reject(new Error(res?.error || 'Bulk operation failed'))
      const items = Object.fromEntries(deviceIds.map(id => [String(id), { state: 'queued', message: '' }]))
      job.value = { jobId: res.jobId, action, total: res.total, running: true, items }
      resolve(res)
    })
  })

  return { isAdmin, showBulkPower, job, running, init, checkAdmin, runBulk }
})
