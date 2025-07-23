<template>
  <div>
    <DeviceModal ref="deviceModal" />
    <header class="header">
      <div class="collapse bg-dark" id="navbarHeader">
      </div>
      <div class="navbar navbar-dark bg-dark shadow-sm">
        <div class="container">
          <div class="navbar-brand d-flex align-items-center">
            <img src="/img/logo.svg" width="100%" height="100%">
          </div>
          <form class="d-flex">
            <input v-model="searchQuery" class="form-control me-2" type="search" 
                  placeholder="Search Device" aria-label="Search Device">
          </form>
        </div>
      </div>
      <div class="password-panel-container">
        <div class="password-panel" :class="{ 'expanded': isPanelExpanded }">    
          <div class="d-flex justify-content-center">
            <div class="password-content bg-white rounded-bottom shadow-sm px-3 py-2">
              <div class="d-flex align-items-center">

                <span class=" me-2  date-time">
                  {{ formattedDateTime }} UTC+3
                </span>
                <span class="text-muted me-2">|</span>
                <span class="text-dark me-0">
                <span class="day-toggle" @click="toggleDay">
                    <span :class="{ 'active-day': currentDay === 0 }">Today</span> / 
                    <span :class="{ 'active-day': currentDay === 1 }">Yesterday</span>
                  </span>, please use the password for <b>admin</b>:
                  <span class="password-group" :class="{ 'switching': isSwitching }">
                    <span class="text-primary fw-bold">{{ passwordOfDays[currentDay].password || 'Loading...' }}</span>
                    <span 
                        tabindex="-1"
                        @click.prevent="copyToClipboard(passwordOfDays[currentDay].password)"
                        class="copy-icon text-muted ms-1"
                        :class="{ 'text-success': isCopied }"
                        title="Copy password">
                        <template v-if="isCopied">
                          <i class="bi bi-check-square-fill"></i> 
                        </template>
                        <template v-else>
                          📋
                        </template>
                      </span>
                  </span>
                </span>
                <div class="cron-group">
                <span class="text-dark me-1 ">| Automatically reset devices at <a style="color: #c09207;font-family: monospace;">03:00 UTC+3</a></span>
                <vue-toggles
                  v-model="cronEnabled"
                  @update:modelValue="toggleCron"
                  checkedText="Enable"
                  uncheckedText="Disable"
                  checkedTextColor="#343a40"
                  checkedBg="#ffc107"
                  :height="20"
                  :width="61"
                  :fontSize="9.8"
                  :dotSize="14"
                  :fontWeight="'bold'"
                />
              </div>
              <span class="text-muted me-2">|</span>
              <span 
               class="me-2 info"
               title="FAQ"
               @click="openFaqModal"
               >💡</span>
            </div>
          </div>
        </div>
      </div>
      </div>
      <!-- Кнопка управления панелью -->
      <div class="toggle-btn-container">
        <button
          @click="togglePanel"
          class="btn btn-sm toggle-btn"
          :class="{ 'expanded': isPanelExpanded }"
        >
          <i class="bi" :class="isPanelExpanded ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
        </button>
      </div>
    </header>

    <div v-if="isLoading" class="d-flex justify-content-center mt-5">
      <div class="spinner-border" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>
    
    <main v-else>      
      <div class="album py-5 bg-light">
        
        <div class="container-fluid px-xxl-5">
          <div class="row row-cols-1 row-cols-sm-2 row-cols-lg-3 g-3 justify-content-start">
        <template v-if="devices">
          <card 
            v-for="device in filteredDevices" 
            :key="device.id"
            :device="device" 
            :wan-types="wanTypes"
            :current-user-id="currentUserId"
            :filtered-devices="routerDevices"
            :users="users"
            @reservation-change="handleReservation" 
          />
        </template>
      </div>
        </div>
      </div>
      
      <section v-if="devices.length > 3" class="text-muted py-5" style="margin-top: -2rem;">
        <div class="container">
          <p class="float-end mb-1">
            <a class="btn btn-outline-secondary" href="#">^</a>
          </p>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted,onUnmounted,provide } from 'vue'
import { socket } from '@/socket'
import card from "@/components/Device.vue"
import { useCronStatus } from '@/composables/useCronStatus'
import VueToggles from 'vue-toggles';
import DeviceModal from "@/components/DeviceModals.vue"



// Состояние UI
const isPanelExpanded = ref(true)
const isCopied = ref(false)
const isLoading = ref(true)
const searchQuery = ref("")
const { cronEnabled, toggleCron } = useCronStatus()
const isSwitching = ref(false)
// Данные приложения
const todayPassword = ref('')
provide('todayPassword', todayPassword)
const devices = ref([])
const wanTypes = ref([])
const users = ref([])
const currentUserId = ref(null)
const deviceModal = ref(null)
const currentDay = ref(0);
const passwordOfDays = ref([
  { label: 'Today', password: '' },
  { label: 'Yesterday', password: '' }
])

const toggleDay = () => {
  isSwitching.value = true;
  setTimeout(() => {
    currentDay.value = (currentDay.value + 1) % passwordOfDays.value.length;
    isSwitching.value = false;
  }, 200);
};

const openFaqModal = () => {
  if (!deviceModal.value) {
    console.error('DeviceModal ref is not available')
    return
  }
  if (typeof deviceModal.value.show !== 'function') {
    console.error('show method is not available on DeviceModal')
    return
  }
  deviceModal.value.show('faq')
}

const currentDateTime = ref(new Date());
let timer = null;

const formattedDateTime = computed(() => {
  return currentDateTime.value?.toLocaleString('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // second: '2-digit',
    hour12: false
  }) ?? 'N/A'
});
const updateTime = () => {
  const now = new Date();
  if (!currentDateTime.value || now.getSeconds() !== currentDateTime.value.getSeconds()) {
    currentDateTime.value = now;
  }
}

// Получение данных

onMounted(() => {
  currentDateTime.value = new Date();
  timer = setInterval(updateTime, 1000);

  
  socket.on('DAILY_PASSWORDS', (data) => {
    console.log('Received daily passwords:', data);
    todayPassword.value = data.today.value
    
    passwordOfDays.value = [
      { label: 'Today', password: data.today.value },
      { label: 'Yesterday', password: data.yesterday.value }
    ];
  });
  
  socket.on('CLIENT_IP', (ip) => {
    currentUserId.value = ip
  });

  socket.on("device:list", (data) => {
    devices.value = data
    isLoading.value = false
  });

  socket.on("device:statuses", (data) => {
    devices.value.forEach((device, key) => {
      if (device.checkUrl in data)
        devices.value[key].statusCode = data[device.checkUrl]
    })
  });

  socket.on('device:wanTypes', (data) => {
    wanTypes.value = data
  });

  socket.on('device:users', (data) => {
    users.value = data
  });
})

// Фильтрация устройств
const routerDevices = computed(() => devices.value.filter(device => device.type === 'router'))

const filteredDevices = computed(() => {
  if (!devices.value) return []
  
  return searchQuery.value 
    ? devices.value.filter(device => 
        device.hwId.toLowerCase().includes(searchQuery.value.toLowerCase()) || 
        device.id.toLowerCase().includes(searchQuery.value.toLowerCase()) || 
        device.shortName.toLowerCase().includes(searchQuery.value.toLowerCase())
      ):[...devices.value]
})

// Обработчики событий
const togglePanel = () => {
  isPanelExpanded.value = !isPanelExpanded.value
}


const copyToClipboard = async (text) => {
  if (!text) return;

  // Пытаемся современный API
  try {
    await navigator.clipboard.writeText(text);
    onCopied();
    return;
  } catch (err) {
    // падаем в fallback
  }

  // --- Fallback без скролла ---
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const activeEl = document.activeElement;

  const textarea = document.createElement('textarea');
  textarea.value = text;

  // не даём браузеру прыгнуть к элементу
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';          // фиксированно вверху
  textarea.style.left = '-9999px';   // вне экрана
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);

  // Некоторые мобильные браузеры требуют focus, но попробуем с preventScroll
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    document.execCommand('copy');
  } catch (err) {
    console.warn('Fallback copy failed', err);
  }

  // Чистка
  document.body.removeChild(textarea);

  // Возвращаем фокус
  if (activeEl && typeof activeEl.focus === 'function') {
    try { activeEl.focus({ preventScroll: true }); } catch(_) {}
  }

  // Возвращаем scroll, если сдвинуло
  window.scrollTo(scrollX, scrollY);

  onCopied();
};

function onCopied() {
  isCopied.value = true;
  setTimeout(() => (isCopied.value = false), 1000);
}



const handleReservation = (deviceId, isReserved) => {
  if (isReserved) {
    socket.emit('device:book', deviceId)
  } else {
    socket.emit('device:release', deviceId)
  }
}
const cleanupSocketListeners = () => {
  socket.off('DAILY_PASSWORDS');
  socket.off('CLIENT_IP');
  socket.off('device:list');
  socket.off('device:statuses');
  socket.off('device:wanTypes');
  socket.off('device:users');
}

onUnmounted(() => {
  if (timer) clearInterval(timer);
  cleanupSocketListeners();
});


</script>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 1000;
}

.navbar {
  position: sticky;
  top: 0;
  width: 100%;
  padding-right: var(--scrollbar-width);
  background-color: #343a40; /* Цвет вашей шапки */
}
.spinner-border {
  width: 6rem;
  height: 6rem;
}

.password-panel {
  overflow: hidden;
  transition: 
    opacity 0.3s ease-out,
    transform 0.3s ease-out,
    padding-bottom 0.1s ease-out;
  transform: scaleY(0);  /* Изначально скрыта */
  transform-origin: top;  /* Точка трансформации - верх */
  opacity: 0;
  height: 0;             /* Полное скрытие */
  padding-bottom: 0;
}

.password-panel.expanded {
  transform: scaleY(1);  /* Плавное раскрытие */
  opacity: 1;
  height: auto;          /* Автовысота */
  padding-bottom: 15px;
  background-color: white;
}

.password-content {
  min-width: 300px;
  overflow-x: auto;
  white-space: nowrap;
  border-left: 1px solid #dee2e6;
  border-right: 1px solid #dee2e6;
  border-bottom: 1px solid #dee2e6;
  margin-top: -1px;
}
.password-content > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}


@media (max-width: 768px) {
  .password-content {
    width: 100%;
    white-space: normal;
  }
  .date-time {
    min-width: 100%;
  }
  
}

.password-group {
  display: inline-flex;
  align-items: center;
  white-space: nowrap; /* Запрещаем перенос внутри группы */
  margin-right: 8px; /* Отступ от следующего элемента */
  transition: opacity 0.2s ease;
}

.password-group .fw-bold {
  font-family: monospace;
  display: inline-block;
}

.copy-icon {
  display: inline-block;
  width: 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-btn-container {
  position: absolute;
  z-index: 10;
  bottom: -10px;
  right: 20px;
}

.toggle-btn {
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-shadow: 0 3px 5px rgba(0,0,0,0.2); 
}

.toggle-btn:hover {
  background: #f8f9fa;
}

.copy-icon:hover {
  transform: scale(1.1);
}

.bi-check-square-fill{
  color: #28a745 !important; 
  font-size: 1rem;

}

.date-time {
  font-family: monospace;
  color: #c09207 !important; /* !important гарантирует переопределение */
  display: inline-block;
  min-width: 180px; /* Фиксированная ширина для стабильности */
  transition: none;
  will-change: contents; /* Оптимизация для браузера */
}


/* Группа для текста и тумблера cron */
.cron-group {
  display: inline-flex;  /* Текст и тумблер в одной строке */
  align-items:flex-end;  /* Выравнивание по центру */
  white-space: nowrap;  /* Запрет переноса */
  margin-right: 1px;    /* Отступ от других элементов */
}

/* Чтобы тумблер не сжимался при узком экране */
.cron-group .vue-toggles {
  flex-shrink: 0;
}


.container-fluid {
  max-width: 1400px; /* Ограничиваем максимальную ширину */
}

.info {
  font-size: 1.2rem;
  cursor: pointer;
  transition: all 0.2s;
}
.info:hover {
  transform: scale(1.1);
}

@media (min-width: 1200px) {
  .px-xxl-5 {
    padding-left: 3rem;
    padding-right: 3rem;
  }
}

.day-toggle {
  cursor: pointer;
  user-select: none;
  position: relative;
  display: inline-block;
  margin: 0 4px;
}

.day-toggle span {
  padding: 2px 4px;
  border-radius: 3px;
  transition: all 0.2s;
}

.active-day {
  background-color: #e9f7ef;
  color: #28a745;
  font-weight: bold;
}

.password-group.switching {
  opacity: 0.5;
}
</style>