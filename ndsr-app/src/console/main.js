// Окно консоли устройства в браузере (xterm.js) — замена контейнеров webtelnet.
// Открывается из useConsoleStore: /console.html?v=<время>#device=<id>.
// Данные идут через socket.io портала (socket/handlers/consoleTerminal.js):
// console:open / console:input / console:close; бэкенд держит одно
// подключение к порту консоли на устройство и раздаёт его всем окнам и
// захвату вывода при перезагрузке (services/consoleHub.js). Доступ — только
// владельцу брони; бронь закончилась — окно отключается.
//
// Буфер обмена: портал по http, системный буфер странице недоступен —
// копирование через выделение (кнопка Copy, Ctrl+C при выделении,
// Ctrl+Shift+C), вставка — Ctrl+V / Ctrl+Shift+V (браузерное событие paste).
// Ctrl+C без выделения уходит в консоль как обычно (^C).
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { socket } from '@/socket'
import './console.css'

const deviceId = new URLSearchParams(location.hash.slice(1)).get('device')

const titleEl = document.getElementById('con-title')
const statusEl = document.getElementById('con-status')
const passBtn = document.getElementById('con-pass')
const reconnectBtn = document.getElementById('con-reconnect')
const toastEl = document.getElementById('con-toast')

let deviceName = deviceId
let devicePassword = null
// Окно подключено (или хочет подключиться) — после обрыва socket.io
// подключаемся снова сами; после console:end — только кнопкой Reconnect
let wantOpen = true
let opened = false
let everOpened = false

const setStatus = (text, kind = '') => {
  statusEl.textContent = text
  statusEl.classList.toggle('ok', kind === 'ok')
  statusEl.classList.toggle('error', kind === 'error')
}

let toastTimer = null
const showToast = (text) => {
  toastEl.textContent = text
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.hidden = true }, 2500)
}

const term = new Terminal({
  cursorBlink: true,
  scrollback: 20000,
  fontSize: 14,
  fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
  theme: { background: '#1e1e1e' }
})
const fit = new FitAddon()
term.loadAddon(fit)
term.open(document.getElementById('con-screen'))
fit.fit()
window.addEventListener('resize', () => fit.fit())
term.focus()

const note = (text, color = 90) => term.write(`\r\n\x1b[${color}m[${text}]\x1b[0m\r\n`)

// Копирование без navigator.clipboard (нет по http)
const copyText = (text) => {
  if (!text) return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  term.focus()
  return ok
}

const copySelection = () => {
  const text = term.getSelection()
  if (!text) return showToast('Select text in the console first')
  showToast(copyText(text) ? 'Copied' : 'Copy failed — use the browser menu')
}

term.attachCustomKeyEventHandler((e) => {
  if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true
  if (e.code === 'KeyC' && (e.shiftKey || term.hasSelection())) {
    copySelection()
    e.preventDefault()
    return false
  }
  // Пусть браузер вставит (событие paste → xterm отправит текст)
  if (e.code === 'KeyV') return false
  return true
})

const send = (data, binary = false) => {
  if (!opened) return
  socket.emit('console:input', { deviceId, data, binary })
}
term.onData(data => send(data))
term.onBinary(data => send(data, true))

socket.on('console:data', ({ deviceId: id, data }) => {
  if (String(id) !== deviceId) return
  term.write(new Uint8Array(data))
})

socket.on('console:note', ({ deviceId: id, note: text }) => {
  if (String(id) !== deviceId) return
  setStatus(text, 'ok')
})

socket.on('console:end', ({ deviceId: id, note: text }) => {
  if (String(id) !== deviceId) return
  opened = false
  wantOpen = false
  setStatus(`Disconnected: ${text}`, 'error')
  note(`disconnected: ${text}`, 31)
  reconnectBtn.hidden = false
})

function open() {
  if (!deviceId) return setStatus('No device in the address', 'error')
  setStatus('Connecting…')
  reconnectBtn.hidden = true
  // Хвост вывода с бэкенда — только в первый раз, иначе он задвоится
  socket.emit('console:open', { deviceId, replay: !everOpened }, (res) => {
    if (!res?.success) {
      wantOpen = false
      setStatus(res?.error || 'Cannot open console', 'error')
      reconnectBtn.hidden = false
      return
    }
    if (everOpened) note('reconnected')
    opened = true
    everOpened = true
    deviceName = res.deviceName || deviceId
    devicePassword = res.devicePassword || null
    titleEl.textContent = deviceName
    document.title = `Console — ${deviceName}`
    passBtn.hidden = !devicePassword
    setStatus(`Connected to ${res.target}`, 'ok')
    term.focus()
  })
}

socket.on('connect', () => { if (wantOpen) open() })
socket.on('disconnect', () => {
  if (!opened) return
  opened = false
  setStatus('Connection to the portal lost — reconnecting…', 'error')
})
if (socket.connected) open()

reconnectBtn.addEventListener('click', () => {
  wantOpen = true
  open()
})

passBtn.addEventListener('click', () => {
  if (!opened) return showToast('Not connected to the console')
  if (devicePassword) send(devicePassword)
  showToast('Password typed — press Enter')
  term.focus()
})

document.getElementById('con-copy').addEventListener('click', copySelection)

document.getElementById('con-clear').addEventListener('click', () => {
  term.clear()
  term.focus()
})

document.getElementById('con-save').addEventListener('click', () => {
  const buf = term.buffer.active
  const lines = []
  for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
  const blob = new Blob([lines.join('\n').replace(/\n+$/, '\n')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
  link.href = url
  link.download = `console-${String(deviceName).replace(/[^\w.-]+/g, '_')}-${stamp}.txt`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  term.focus()
})

window.addEventListener('beforeunload', () => socket.emit('console:close', { deviceId }))
