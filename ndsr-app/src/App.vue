<template>
  <div>
    <DeviceModal ref="deviceModal" />
    
    <!-- Кнопка для открытия боковой панели -->
    <button 
      class="sidebar-toggle-btn"
      @click="toggleSidebar"
      :class="{ 'sidebar-open': isSidebarOpen }"
    >
      <i class="bi" :class="isSidebarOpen ? 'bi-x' : 'bi-list'"></i>
    </button>

    <!-- Боковая панель -->
    <div class="sidebar" :class="{ 'sidebar-open': isSidebarOpen }">
      <div class="sidebar-content">
        <h5>Menu</h5>
        <ul class="sidebar-menu">
          <li><a href="#">Настройки</a></li>
          <li><a href="#">Статистика</a></li>
          <li><a  style="cursor: pointer;" @click="openFaqModal">FAQ</a></li>
        </ul>
      </div>
    </div>

    <!-- Затемнение фона -->
    <div 
      class="sidebar-overlay" 
      :class="{ 'sidebar-open': isSidebarOpen }"
      @click="toggleSidebar"
    ></div>
    <header class="header">
      <div class="collapse bg-dark" id="navbarHeader">
      </div>
      <div class="navbar navbar-dark bg-dark shadow-sm">
        <div class="container">
          <div class="navbar-brand d-flex align-items-center">
            <img src="/img/logo.svg" width="100%" height="100%">
          </div>
    <div class="search-container">
        <div class="search-icon" @click="toggleSearch">
          <i class="bi bi-search"></i>
        </div>
        <div class="search-input-wrapper" :class="{ 'expanded': isSearchExpanded }">
          <input 
            v-model="searchQuery" 
            class="form-control search-input" 
            type="search" 
            placeholder="Search Device" 
            aria-label="Search Device"
            @blur="onSearchBlur"
          >
        </div>
      </div>
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
                <span class="text-dark me-0 day-switcher-container">
                  <span class="day-toggle" @click="toggleDay">
                    <span class="day-option" :class="{ 'active': currentDay === 0 }">Today</span>
                    <span class="day-separator">/</span> 
                    <span class="day-option" :class="{ 'active': currentDay === 1 }">Yesterday</span>
                  </span>, please use the password for 
                </span><b>admin</b>:
                <span 
                  class="password-group clickable" 
                  :class="{ 'switching': isSwitching }"
                  @click.prevent="copyToClipboard(passwordOfDays[currentDay].password)"
                  role="button"
                  tabindex="0"
                  aria-label="Copy password"
                >
                  <span class="text-primary fw-bold">
                    {{ passwordOfDays[currentDay].password || 'Loading.' }}
                  </span>
                  <span 
                    class="copy-icon text-muted ms-1"
                    :class="{ 'text-success': isCopied }"
                  >
                    <template v-if="isCopied">
                      <i class="bi bi-check-square-fill"></i> 
                    </template>
                    <template v-else>
                      📋
                    </template>
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
import { nextTick } from 'vue'

const isSidebarOpen = ref(false)

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
  
  // Добавляем/убираем класс на body
  if (isSidebarOpen.value) {
    document.body.classList.add('sidebar-open')
  } else {
    document.body.classList.remove('sidebar-open')
  }
}

// Закрытие по ESC
const handleKeydown = (event) => {
  if (event.key === 'Escape' && isSidebarOpen.value) {
    isSidebarOpen.value = false
    document.body.classList.remove('sidebar-open')
  }
}

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
const isSearchExpanded = ref(false)

const toggleSearch = () => {
  // Всегда переключаем состояние, независимо от условий
  isSearchExpanded.value = !isSearchExpanded.value
  
  if (isSearchExpanded.value) {
    nextTick(() => {
      const searchInput = document.querySelector('.search-input')
      if (searchInput) {
        searchInput.focus()
        searchInput.select()
      }
    })
  }
}

const onSearchBlur = (event) => {
  // Не закрываем если кликнули на саму иконку поиска
  if (event.relatedTarget === document.querySelector('.search-icon')) {
    return
  }
  
  // Даем небольшую задержку перед закрытием
  setTimeout(() => {
    if (!searchQuery.value) {
      isSearchExpanded.value = false
    }
  }, 150)
}
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
  window.addEventListener('keydown', handleKeydown)
  currentDateTime.value = new Date();
  timer = setInterval(updateTime, 1000);

  
  socket.on('DAILY_PASSWORDS', (data) => {
    // console.log('Received daily passwords:', data);
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
  window.removeEventListener('keydown', handleKeydown)
  document.body.classList.remove('sidebar-open')
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

.copy-icon {
  display: inline-block;
  width: 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-btn-container {
  position: absolute;
  z-index: 1004; /* Выше чем sidebar (1003) и password панель */
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
  z-index: 1005; /* Еще выше чем контейнер */
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

.day-switcher-container {
  display: inline-flex;
  align-items: center;
}

.day-toggle {
  cursor: pointer;
  user-select: none;
  display: flex;
  position: relative;
  min-width: 180px; /* Фиксированная ширина для стабильности */
}

.day-option {
  --active-bg: #e9f7ef;
  --active-text: #28a745;
  
  padding: 0.125rem 0.5rem; /* 2px 8px в rem */
  border-radius: 1.1875rem; /* 3px */
  transition: 
    transform 0.2s cubic-bezier(0.25, 2.8, 0.25, 0.95),
    background-color 0.2s ease,
    opacity 0.2s ease;
  text-align: center;
  margin-left: 0.1875rem; 
  cursor: pointer; 
}
.day-option.active {
  background-color: var(--active-bg);
  color: var(--active-text);
  font-weight: bold;
  opacity: 1;
  transform: scale(1.05);
}

.day-option:focus-visible {
  outline: 2px solid var(--active-text);
  outline-offset: 2px;
}


.day-separator {
  padding: 0 4px;
  color: #6c757d;
}

.password-group {
  display: inline-flex;
  align-items: center;
  position: relative;
  transition: opacity 0.3s ease;
}

.password-group.switching {
  opacity: 0.5;
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




/* Стили для боковой панели (справа) */
.sidebar-toggle-btn {
  position: fixed;
  bottom: 85px; /* Сдвигаем ниже search панели */
  right: 15px;
  z-index: 1002; /* Выше header но ниже sidebar */
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: #343a40;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0,0,0,0.3);
  transition: all 0.3s ease;
}

.sidebar-toggle-btn:hover {
  background: #495057;
  transform: scale(1.05);
}

.sidebar-toggle-btn.sidebar-open {
  right: 215px;
}

.sidebar {
  position: fixed;
  top: 0;
  right: -200px;
  width: 200px;
  height: 100vh;
  background: #343a40;
  z-index: 1003; /* Выше кнопки и header */
  transition: right 0.3s ease;
  overflow-y: auto;
}

.sidebar.sidebar-open {
  right: 0;
}

.sidebar-content {
  padding: 20px;
  color: white;
}

.sidebar-content h5 {
  color: #ffc107;
  margin-bottom: 20px;
  border-bottom: 1px solid #495057;
  padding-bottom: 10px;
}

.sidebar-menu {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sidebar-menu li {
  margin-bottom: 10px;
}

.sidebar-menu a {
  color: #adb5bd;
  text-decoration: none;
  display: block;
  padding: 8px 0;
  transition: color 0.3s ease;
}

.sidebar-menu a:hover {
  color: white;
}

.sidebar-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.5);
  z-index: 1001; /* Ниже sidebar но выше всего остального */
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
}

.sidebar-overlay.sidebar-open {
  opacity: 1;
  visibility: visible;
}

/* Обновляем z-index для header и password панели */
.header {
  position: sticky;
  top: 0;
  z-index: 1000; /* Ниже sidebar */
}

.password-panel-container {
  position: relative;
  z-index: 999; /* Ниже header */
}

.password-panel.expanded {
  z-index: 998; /* Ниже password-panel-container */
}

/* Адаптивность для мобильных */
@media (max-width: 768px) {
  .sidebar-toggle-btn {
    bottom: 15px; /* Ниже на мобильных */
    right: 10px;
  }
  
  .sidebar {
    width: 80%;
    right: -80%;
  }
  
  .sidebar-toggle-btn.sidebar-open {
    right: calc(80% + 10px);
  }
  
  /* На мобильных скрываем кнопку когда открыта password панель */
  .password-panel.expanded ~ .sidebar-toggle-btn {
    display: none;
  }
}

/* На десктопе - правильное наложение */
@media (min-width: 769px) {
  .password-panel.expanded {
    z-index: 997; /* Password панель под sidebar */
  }
  
  .sidebar.sidebar-open {
    z-index: 1003; /* Sidebar поверх всего */
  }
}
/* Стили для поисковой строки */
.search-container {
  display: flex;
  align-items: center;
  position: relative;
}

.search-icon {
  cursor: pointer;
  font-size: 1.2rem;
  padding: 0.5rem;
  color: white;
  transition: all 0.3s ease;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 101;
  position: relative;
  flex-shrink: 0; /* Запрещаем сжатие иконки */
}

.search-icon.active {
  color: #ffc107;
  background: rgba(255, 193, 7, 0.1);
}

.search-icon:hover {
  color: #ffc107;
  background: rgba(255, 255, 255, 0.1);
  transform: scale(1.1);
}

.search-input-wrapper {
  position: absolute;
  right: calc(100% + 10px); /* Добавляем отступ от иконки */
  top: 50%;
  transform: translateY(-50%) scaleX(0);
  transform-origin: right center;
  opacity: 0;
  transition: all 0.3s ease;
  width: 220px;
}

.search-input-wrapper.expanded {
  transform: translateY(-50%) scaleX(1);
  opacity: 1;
}

.search-input {
  width: 100%;
  border: 2px solid transparent;
  border-radius: 30px;
  padding: 0.5rem 1.2rem; /* Уменьшаем padding для меньшей высоты */
  background: rgba(255, 255, 255, 0.1);
  color: white;
  transition: all 0.3s ease;
  box-sizing: border-box;
  height: 40px; /* Фиксированная высота как у иконки */
  font-size: 0.9rem;
}

.search-input:focus {
  outline: none;
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 193, 7, 0.5);
  box-shadow: none;
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.7);
}

@media (max-width: 768px) {
  .search-container {
    position: relative;
    margin-left: auto;
  }
  
  .search-icon {
    position: relative;
    z-index: 1003;
  }
  
  .search-input-wrapper {
    position: absolute;
    top: 50%;
    right: 100%; /* Слева от иконки */
    transform: translateY(-50%) scaleX(0);
    transform-origin: right center;
    width: 0;
    opacity: 0;
    transition: all 0.3s ease;
    overflow: visible;
  }
  
  .search-input-wrapper.expanded {
    width: 300px;
    transform: translateY(-50%) scaleX(1);
    opacity: 1;
    right: calc(100% + 10px); /* Отступ от иконки */
  }
  
  .search-input {
    width: 100%;
    padding: 0.7rem 1rem;
    height: 38px;
    font-size: 14px;
    background: rgba(52, 58, 64, 0.98);
  }
  
  /* Запрещаем выезд за экран */
  @media (max-width: 480px) {
    .search-input-wrapper.expanded {
      width: calc(100vw - 80px);
      right: calc(100% + 5px);
    }
  }
}
</style>