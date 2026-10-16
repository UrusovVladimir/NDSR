// stores/useConsoleLogStore.js — вывод консоли устройства во время перезагрузки
// и сброса (окно прогресса, раскрывающийся блок «Console output»).
//
// Захват ведёт бэкенд (services/consoleCapture.js) по device:consoleCapture:start.
// Порт консоли пускает одного клиента — новое подключение выбивает прежнее,
// поэтому при открытом окне консоли этого устройства захват НЕ запрашиваем
// (иначе выкинули бы пользователя из консоли); окно консоли, открытое во время
// захвата, заберёт порт — бэкенд пришлёт ended с пометкой.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { socket } from '@/socket'
import { useConsoleStore } from './useConsoleStore'

const MAX_CHARS = 200000          // хвост лога на устройство
const STOP_AFTER_MS = 20000       // дочитываем загрузку после конца операции

export const useConsoleLogStore = defineStore('consoleLog', () => {
  const consoleStore = useConsoleStore()

  // deviceId -> { text, notes: [], state: 'starting'|'capturing'|'ended'|'unavailable'|'console-open', message }
  const logs = ref(new Map())
  const stopTimers = new Map()

  const update = (deviceId, patch) => {
    const id = String(deviceId)
    const prev = logs.value.get(id) || { text: '', state: 'starting', message: '' }
    const next = new Map(logs.value)
    next.set(id, { ...prev, ...patch })
    logs.value = next
  }

  socket.on('device:consoleLog', ({ deviceId, text, note, ended }) => {
    const prev = logs.value.get(String(deviceId))
    if (!prev) return
    const patch = {}
    if (text) {
      const all = prev.text + text
      patch.text = all.length > MAX_CHARS ? all.slice(-MAX_CHARS) : all
      patch.state = 'capturing'
    }
    if (note) {
      patch.text = (patch.text ?? prev.text) + `\n[${note}]\n`
      if (!ended && prev.state === 'starting') patch.state = 'capturing'
    }
    if (ended) {
      patch.state = 'ended'
      patch.message = note || ''
    }
    update(deviceId, patch)
  })

  // Начало перезагрузки / сброса
  const begin = (deviceId) => {
    const id = String(deviceId)
    clearTimeout(stopTimers.get(id))
    if (consoleStore.isConsoleOpen(id)) {
      update(id, { text: '', state: 'console-open', message: 'Console is open in a separate window — the output is there' })
      return
    }
    update(id, { text: '', state: 'starting', message: '' })
    socket.emit('device:consoleCapture:start', { deviceId: id }, (res) => {
      if (!res?.success) update(id, { state: 'unavailable', message: res?.error || 'Console output is unavailable' })
    })
  }

  // Конец операции: даём досмотреть загрузку и отключаемся от консоли
  const finish = (deviceId) => {
    const id = String(deviceId)
    const log = logs.value.get(id)
    if (!log || !['starting', 'capturing'].includes(log.state)) return
    clearTimeout(stopTimers.get(id))
    stopTimers.set(id, setTimeout(() => {
      stopTimers.delete(id)
      socket.emit('device:consoleCapture:stop', { deviceId: id })
    }, STOP_AFTER_MS))
  }

  const getLog = (deviceId) => logs.value.get(String(deviceId)) || null

  const forget = (deviceId) => {
    const id = String(deviceId)
    clearTimeout(stopTimers.get(id))
    stopTimers.delete(id)
    const log = logs.value.get(id)
    if (log && ['starting', 'capturing'].includes(log.state)) {
      socket.emit('device:consoleCapture:stop', { deviceId: id })
    }
    const next = new Map(logs.value)
    next.delete(id)
    logs.value = next
  }

  return { logs, begin, finish, getLog, forget }
})
