// Окно RDP к тестовой VM в браузере (Guacamole). Открывается из VmAttachDialog:
// /rdp.html#vm=<id>&t=<token>&name=<имя>. Токен короткоживущий и одноразовый
// по смыслу — при переподключении берётся новый через socket.io (vm:getRdpToken).
//
// Буфер обмена → VM. Портал открыт по http, браузер не даёт странице читать
// системный буфер, а Ctrl+V перехватывает клавиатура Guacamole (событие paste
// не возникает). Поэтому: пароль устройства (из vm:getRdpToken) кладётся в
// буфер VM при подключении и кнопкой «Device password → VM»; любой текст —
// через поле в панели (вставить туда Ctrl+V → Enter/Send). Пока фокус в поле,
// клавиши в VM не уходят. Дальше в VM — обычный Ctrl+V.
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

let devicePassword = null
let deviceName = null

const statusEl = document.getElementById('rdp-status')
const passBtn = document.getElementById('rdp-pass')
const clipInput = document.getElementById('rdp-clip')
const toastEl = document.getElementById('rdp-toast')
const CLIP_PLACEHOLDER = clipInput.placeholder

// Заметное подтверждение поверх экрана VM
let toastTimer = null
const showToast = (text) => {
  toastEl.textContent = text
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.hidden = true }, 6000)
}

// Короткий фрагмент вставленного текста — чтобы было видно, что именно ушло
const preview = (text) => {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 24 ? `${oneLine.slice(0, 24)}…` : oneLine
}
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

// Токен + пароль устройства, к которому подключена VM
const fetchToken = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('No response from server')), 15000)
  socket.emit('vm:getRdpToken', { vmId }, (res) => {
    clearTimeout(timer)
    if (!res?.success) return reject(new Error(res?.error || 'Cannot get RDP token'))
    devicePassword = res.devicePassword || null
    deviceName = res.deviceName || null
    passBtn.hidden = !devicePassword
    if (deviceName) passBtn.title = `Put the password of ${deviceName} into the VM clipboard, then press Ctrl+V inside the VM`
    resolve(res.token)
  })
})

// Текст → буфер обмена VM (вставка в VM — Ctrl+V уже внутри неё)
// what — что показать пользователю (для пароля — имя устройства, не сам пароль)
const sendToVmClipboard = (text, what = 'Text') => {
  if (!text) return false
  if (!client) {
    showToast('Not connected to the VM yet — try again after it connects')
    return false
  }
  const stream = client.createClipboardStream('text/plain')
  const writer = new Guacamole.StringWriter(stream)
  writer.sendText(text)
  writer.sendEnd()
  setStatus(`${what} is in the VM clipboard — press Ctrl+V inside the VM`)
  showToast(`✓ ${what} is in the VM clipboard — press Ctrl+V inside the VM`)
  return true
}

// Фокус в поле панели — клавиши остаются браузеру, в VM не уходят
const typingLocally = () => !!document.activeElement?.closest?.('#rdp-toolbar input')

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
    if (state === 3) {
      screenEl.focus()
      // Сразу кладём пароль устройства — в веб роутера внутри VM просто Ctrl+V
      if (devicePassword) sendToVmClipboard(devicePassword, `Password of ${deviceName || 'the device'}`)
    }
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
// true — клавиша остаётся браузеру (ввод в поле панели)
keyboard.onkeydown = (keysym) => {
  if (typingLocally()) return true
  client?.sendKeyEvent(1, keysym)
  return false
}
keyboard.onkeyup = (keysym) => {
  if (typingLocally()) return
  client?.sendKeyEvent(0, keysym)
}

// Поле панели: вставка (Ctrl+V) или ввод + Enter/Send → буфер VM
// После отправки поле на несколько секунд зелёное с подсказкой, что дальше
let clipSentTimer = null
const sendClipInput = () => {
  const text = clipInput.value
  if (!text) return
  if (sendToVmClipboard(text, `«${preview(text)}» (${text.length} chars)`)) {
    clipInput.value = ''
    clipInput.classList.add('sent')
    clipInput.placeholder = '✓ Sent — Ctrl+V in the VM'
    clearTimeout(clipSentTimer)
    clipSentTimer = setTimeout(() => {
      clipInput.classList.remove('sent')
      clipInput.placeholder = CLIP_PLACEHOLDER
    }, 6000)
    screenEl.focus()
  }
}
clipInput.addEventListener('paste', () => setTimeout(sendClipInput, 0))
clipInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendClipInput()
  if (e.key === 'Escape') { clipInput.value = ''; screenEl.focus() }
})
document.getElementById('rdp-clip-send').addEventListener('click', sendClipInput)

passBtn.addEventListener('click', () => {
  sendToVmClipboard(devicePassword, `Password of ${deviceName || 'the device'}`)
  screenEl.focus()
})

// Клик по экрану возвращает клавиатуру в VM
screenEl.addEventListener('mousedown', () => {
  if (document.activeElement !== screenEl) screenEl.focus()
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
  // Свежий токен вместе с паролем устройства; не вышло — токен из адреса
  fetchToken()
    .then((fresh) => { token = fresh })
    .catch(() => {})
    .finally(connect)
}
