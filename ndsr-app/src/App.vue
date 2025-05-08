<template>
  <div>
    <header>
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
          
          <div class="container d-flex justify-content-end">
            <div class="password-content bg-white rounded-bottom shadow-sm px-3 py-2">
              <div class="d-flex align-items-center">
                <span class=" me-2  date-time">
                  {{ formattedDateTime }} UTC+3
                </span>
                <span class="text-muted me-2">|</span>
                <span class="text-dark me-0">
                  Today, please use the password for <b>admin</b>: 
                  <span class="password-group">
                    <span class="text-primary fw-bold">{{ todayPassword || 'Loading...' }}</span>
                    <span 
                      tabindex="-1"
                      @click.prevent="copyToClipboard"
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
                <!-- <div class="d-flex align-items-center mt-0"> -->
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
              <!-- </div> -->
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </header>

    <div v-if="isLoading" class="d-flex justify-content-center mt-5">
      <div class="spinner-border" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>
    
    <main v-else>      
      <div class="album py-5 bg-light">
        <!-- Кнопка управления панелью -->
        <div class="d-flex justify-content-end">
          <div class="toggle-btn-container">
            <button 
              @click="togglePanel"
              class="btn btn-sm toggle-btn"
              :class="{ 'expanded': isPanelExpanded }"
            >
              <i class="bi" :class="isPanelExpanded ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
            </button>
          </div>
        </div>
        
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



// Состояние UI
const isPanelExpanded = ref(true)
const isCopied = ref(false)
const isLoading = ref(true)
const searchQuery = ref("")
const { cronEnabled, toggleCron } = useCronStatus()

// Данные приложения
const todayPassword = ref('')
const devices = ref([])
const wanTypes = ref([])
const users = ref([])
const currentUserId = ref(null)

provide('todayPassword', todayPassword);

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
  // Обновляем только если секунда изменилась
  if (now.getSeconds() !== currentDateTime.value.getSeconds()) {
    currentDateTime.value = now;
  }
  timer = setTimeout(updateTime, 1000 - now.getMilliseconds());
}

// Получение данных

onMounted(() => {
  currentDateTime.value = new Date();
  setTimeout(() => {
    updateTime();
  }, 1000 - (Date.now() % 1000));
  
  socket.on('DAILY_PASSWORD', (data) => {
    todayPassword.value = data.password
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

const copyToClipboard = async () => {
  if (!todayPassword.value) return

  const scrollY = window.scrollY

  try {
    await navigator.clipboard.writeText(todayPassword.value)
    isCopied.value = true
    if (document.activeElement) {
      document.activeElement.blur()
    }
    setTimeout(() => (isCopied.value = false), 500)
  } catch (err) {
    // Fallback для Safari/iOS
    // Fallback для Safari/iOS
  const textarea = document.createElement('textarea')
  textarea.value = todayPassword.value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.top = `${window.scrollY}px`
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

try {
  const successful = document.execCommand('copy')
  if (successful) {
    isCopied.value = true
    setTimeout(() => (isCopied.value = false), 500)
  } else {
    console.error('execCommand failed')
  }
} catch (fallbackErr) {
  console.error('Fallback error:', fallbackErr)
} finally {
  document.body.removeChild(textarea)
}
  }

  // Всегда восстанавливаем scroll
  window.scrollTo({ top: scrollY })
}

const handleReservation = (deviceId, isReserved) => {
  if (isReserved) {
    socket.emit('device:book', deviceId)
  } else {
    socket.emit('device:release', deviceId)
  }
}

onUnmounted(() => {
  clearTimeout(timer)
})


</script>

<style scoped>
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
  transform-origin:bottom;  /* Точка трансформации - верх */
  opacity: 0;
  height: 0;             /* Полное скрытие */
  padding-bottom: 0;
}

.password-panel.expanded {
  transform: scaleY(1);  /* Плавное раскрытие */
  opacity: 1;
  height: auto;          /* Автовысота */
  padding-bottom: 15px;
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
}



.copy-icon {
  flex-shrink: 0; /* Запрещаем сжатие иконки */
}

.toggle-btn-container {
  position: relative;
  z-index: 10;
  margin-top: -15px;
  margin-right: 20px;
  transform: translateY(-170%);
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
.copy-icon {
  cursor: pointer;
  transition: all 0.2s;
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

@media (min-width: 1200px) {
  .px-xxl-5 {
    padding-left: 3rem;
    padding-right: 3rem;
  }
}

</style>