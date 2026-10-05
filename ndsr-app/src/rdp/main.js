// Окно RDP к тестовой VM в браузере (Guacamole). Открывается из VmAttachDialog:
// /rdp.html#vm=<id>&t=<token>&name=<имя>. Токен короткоживущий и одноразовый
// по смыслу — при переподключении берётся новый через socket.io (vm:getRdpToken).
import Guacamole from 'guacamole-common-js'
import { socket } from '@/socket'
import './rdp.css'

const params = new URLSearchParams(location.hash.slice(1))
const vmId = params.get('vm')
let token = params.get('t')
const vmName = params.get('name') || vmId
// Токен в адресной строке не оставляем
history.replaceState(null, '', location.pathname)

document.title = `RDP — ${vmName}`
document.getElementById('rdp-title').textContent = vmName

const statusEl = document.getElementById('rdp-status')
const screenEl = document.getElementById('rdp-screen')
const reconnectBtn = document.getElementById('rdp-reconnect')
const setStatus = (text, isError = false) => {
  statusEl.textContent = text
  statusEl.classList.toggle('error', isError)
}

// Пусто — тот же адрес, что у страницы (nginx проксирует /guacamole/)
const wsUrl = import.meta.env.VITE_GUAC_WS_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/guacamole/`

let client = null
let keyboard = null
let fitDisplay = () => {}

const screenSize = () => ({
  width: Math.max(640, screenEl.clientWidth),
  height: Math.max(480, screenEl.clientHeight)
})

const fetchToken = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('No response from server')), 15000)
  socket.emit('vm:getRdpToken', { vmId }, (res) => {
    clearTimeout(timer)
    if (res?.success) resolve(res.token)
    else reject(new Error(res?.error || 'Cannot get RDP token'))
  })
})

const STATE_TEXT = {
  1: 'Connecting…',
  2: 'Waiting for VM…',
  3: 'Connected',
  4: 'Disconnecting…',
  5: 'Disconnected'
}

function connect() {
  reconnectBtn.hidden = true
  setStatus('Connecting…')
  screenEl.replaceChildren()

  const tunnel = new Guacamole.WebSocketTunnel(wsUrl)
  client = new Guacamole.Client(tunnel)
  const display = client.getDisplay()
  screenEl.appendChild(display.getElement())

  client.onstatechange = (state) => {
    setStatus(STATE_TEXT[state] || '')
    if (state === 3) screenEl.focus()
    if (state === 5) reconnectBtn.hidden = false
  }
  client.onerror = (status) => {
    setStatus(status?.message || 'Connection error', true)
    reconnectBtn.hidden = false
  }
  // Буфер обмена VM → локальный (если браузер разрешит)
  client.onclipboard = (stream, mimetype) => {
    if (!/^text\//.test(mimetype)) return
    const reader = new Guacamole.StringReader(stream)
    let text = ''
    reader.ontext = (chunk) => { text += chunk }
    reader.onend = () => navigator.clipboard?.writeText(text).catch(() => {})
  }

  // Удалённый экран больше окна (сервер не поменял размер сессии) —
  // уменьшаем под окно; координаты мыши пересчитываем обратно
  const fit = () => {
    const w = display.getWidth()
    const h = display.getHeight()
    if (!w || !h) return
    display.scale(Math.min(1, screenEl.clientWidth / w, screenEl.clientHeight / h))
  }
  display.onresize = fit
  fitDisplay = fit

  const mouse = new Guacamole.Mouse(display.getElement())
  mouse.onEach(['mousedown', 'mousemove', 'mouseup'], (e) => {
    const scale = display.getScale() || 1
    const st = e.state
    client.sendMouseState(new Guacamole.Mouse.State({
      x: st.x / scale,
      y: st.y / scale,
      left: st.left,
      middle: st.middle,
      right: st.right,
      up: st.up,
      down: st.down
    }), true)
  })

  const { width, height } = screenSize()
  const dpi = Math.round(96 * (window.devicePixelRatio || 1))
  client.connect(`token=${encodeURIComponent(token)}&width=${width}&height=${height}&dpi=${dpi}`)
}

// Клавиатура — на весь документ, но только когда окно в фокусе
keyboard = new Guacamole.Keyboard(document)
keyboard.onkeydown = (keysym) => { client?.sendKeyEvent(1, keysym) }
keyboard.onkeyup = (keysym) => { client?.sendKeyEvent(0, keysym) }

// Вставка из локального буфера → VM
document.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text/plain')
  if (!text || !client) return
  const stream = client.createClipboardStream('text/plain')
  const writer = new Guacamole.StringWriter(stream)
  writer.sendText(text)
  writer.sendEnd()
})

document.getElementById('rdp-cad').addEventListener('click', () => {
  if (!client) return
  const keys = [0xFFE3, 0xFFE9, 0xFFFF] // Control_L, Alt_L, Delete
  keys.forEach(k => client.sendKeyEvent(1, k))
  keys.reverse().forEach(k => client.sendKeyEvent(0, k))
})

reconnectBtn.addEventListener('click', async () => {
  try {
    token = await fetchToken()
    connect()
  } catch (err) {
    setStatus(err.message, true)
  }
})

let resizeTimer = null
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    const { width, height } = screenSize()
    client?.sendSize(width, height)
    fitDisplay()
  }, 300)
})

window.addEventListener('beforeunload', () => client?.disconnect())

if (!vmId || !token) {
  setStatus('Open this window from the portal (Test VMs → Open in browser)', true)
} else {
  connect()
}
