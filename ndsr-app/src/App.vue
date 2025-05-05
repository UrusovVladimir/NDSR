<template>
  <div>
    <header>
      <div class="collapse bg-dark" id="navbarHeader"></div>
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
                <span class="text-muted me-2 small">
                  {{ new Date() }} 
                </span>
                <span class="text-muted me-2">|</span>
                <span class="text-dark me-0">
                  Today, please use the password for <b>admin</b>: <span class="text-primary fw-bold">{{ todayPassword || 'Loading...' }}</span>
                </span>
                <span 
                  @click="copyToClipboard"
                  class="copy-icon text-muted ms-2"
                  :class="{ 'text-success': isCopied }"
                  title="Copy password">
                  <template v-if="isCopied">
                    <i class="bi bi-check-square-fill"></i> 
                  </template>
                  <template v-else>
                    📋
                  </template>
                </span>
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
        
        <div class="container">
          <div class="row row-cols-1 row-cols-sm-2 row-cols-md-3 g-3 justify-content-start">
            <template v-if="devices">
              <card 
                v-for="device in filteredDevices" 
                :key="device.id"
                :device="device" 
                :wan-types="wanTypes"
                :current-user-id="currentUserId"
                :filtered-devices="routerDevices"
                @reservation-change="handleReservation" 
              />
            </template>
          </div>
        </div>
      </div>
      
      <section v-if="devices.length > 3" class="text-muted py-5" style="margin-top: -2rem;">
        <div class="container">
          <p class="float-end mb-1">
            <a class="btn btn-secondary" href="#">^</a>
          </p>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { socket } from '@/socket'
import card from "@/components/Device.vue"

// Состояние UI
const isPanelExpanded = ref(true)
const isCopied = ref(false)
const isLoading = ref(true)
const searchQuery = ref("")

// Данные приложения
const todayPassword = ref('')
const devices = ref([])
const wanTypes = ref([])
const currentUserId = ref(null)

// Получение данных
onMounted(() => {
  socket.on('DAILY_PASSWORD', (data) => {
    todayPassword.value = data.password
  })
  
  socket.on('CLIENT_IP', (ip) => {
    currentUserId.value = ip
  })

  socket.on("device:list", (data) => {
    devices.value = data
    isLoading.value = false
  })

  socket.on("device:statuses", (data) => {
    devices.value.forEach((device, key) => {
      if (device.checkUrl in data)
        devices.value[key].statusCode = data[device.checkUrl]
    })
  })

  socket.on('device:wanTypes', (data) => {
    wanTypes.value = data
  })
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
  try {
    await navigator.clipboard.writeText(todayPassword.value)
    isCopied.value = true
    setTimeout(() => (isCopied.value = false), 500)
  } catch (err) {
    console.error('Ошибка копирования:', err)
  }
}

const handleReservation = (deviceId, isReserved) => {
  if (isReserved) {
    socket.emit('device:book', deviceId)
  } else {
    socket.emit('device:release', deviceId)
  }
}
</script>

<style scoped>

.spinner-border {
  width: 6rem;
  height: 6rem;
}

.password-panel {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease, padding-bottom 0.3s ease;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  padding-bottom: 0;
}

.password-panel.expanded {
  max-height: 13vh; 
  padding-bottom: 15px; 
}

.password-content {
  width: fit-content;
  border-left: 1px solid #dee2e6;
  border-right: 1px solid #dee2e6;
  border-bottom: 1px solid #dee2e6;
  margin-top: -1px;
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
</style>