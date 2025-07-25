<template>
  <div class="col">
    <div class="position-relative"  style="min-height: 1px;" >
    <TimerPopup 
            :isVisible="showPopup"
            :isBookedByCurrentUser="localBookingStatus.bookedBy === currentUserId"
            @close="showPopup = false"
            @confirm="handleTimeConfirm"
            @reset-toggle="handleResetToggle"
            />
    </div>
    <div class="card shadow-sm position-relative h-100 justify-content-between"
  :class="[
    localBookingStatus.isBooked && localBookingStatus.bookedBy !== currentUserId ? 'card-booked' : '',
    isSelected ? 'custom-highlight' : '',
    isLoading || isApplyingChanges ? 'opacity-50 pointer-events-none' : ''
  ]">
  <div class="position-absolute start-0 mt-1 d-flex flex-column" style="padding-left: 75px; gap: 0.5rem;">
    <div>
      <Popper  :arrow="true" :hover="true" :offset-distance="'10'" style="z-index: 9999;">
        <template v-if="!isOffline" #content>
          <div style="font-size: 12px; color: white; width: 148px;">
            <strong>Extensions connected:</strong> {{ connectedExtensions }}
            <br>
            <strong>Device Password:</strong> <span style="cursor:pointer;" @click="copy(localBookingStatus.accessPassword)">{{ localBookingStatus.accessPassword || 'Not set' }}</span>
          </div>
        </template>
        <template v-else #content>
          <div style="font-size: 12px; color: white; width: 148px;">
            <strong>Device is not reachable</strong>
          </div>
        </template>
        <template v-if="!localBookingStatus.isBooked && device.type === 'router'|| String(localBookingStatus.bookedBy) === String(props.currentUserId) && device.type === 'router'">
          <svg v-if="!isOffline" class="bi bi-check-circle-fill text-success" width="20" height="20">
            <use :href="`http://${baseUrl}/img/info.svg#info-fill`"  crossorigin="anonymous" color="#4a994d"/>
          </svg>
          <svg v-else class="bi bi-exclamation-triangle-fill text-danger" width="20" height="20">
            <use :href="`http://${baseUrl}/img/info.svg#exclamation-triangle-fill`" crossorigin="anonymous"/>
          </svg>
        </template>
      </Popper>
    </div>
  </div>
   <div v-if="isApplyingChanges" class="spinner-border spinner-border-sm position-absolute text-white"  style="top:35px; left:10px"></div>
   <div v-if="localBookingStatus.isBooked" class="position-absolute top-0 end-0 m-2 d-flex flex-wrap gap-1 align-items-center">
  <!-- Основной бейдж -->
    <span class="badge badge-locked-timer text-dark flex-shrink-0">
      <template  v-if="String(localBookingStatus.bookedBy) === String(props.currentUserId)">
         Your booking
      </template>
      <template  v-else>
          <span class="lock-icon pe-n1">🔒 Booked by {{ usersNames[localBookingStatus.bookedBy] || localBookingStatus.bookedBy }}</span>
      </template>
        <span class="ps-1"> 🕒 {{ formatTime(timerSeconds) }}</span>
        <button 
          v-if="String(localBookingStatus.bookedBy) === String(props.currentUserId)" 
            @click="extendBooking" 
            class="icon-button ms-2"
            title="Extend the lease"
            aria-label="Extend booking time" 
          >
          🔄
        </button>
   </span>
</div>
<div 
  v-if="localBookingStatus.isBooked && localBookingStatus.bookedBy !== currentUserId" 
  class="card-overlay">
</div>
      <!-- Toogle выбора -->
      <div class="toggle-wrapper form-check position-absolute align-items-start p-2">
        <vue-toggles
        v-model="isSelected"
        @click="handleBookingChange"
        checkedText="Unbook"
        uncheckedText="Book"
        checkedTextColor="#343a40"
        checkedBg="#ffc107"
        :height="20"
        :width="61"
        :fontSize="9.8"        
        :dotSize="14"
        :disabled="shouldDisableToggle"
        :fontWeight="'bold'"
      />
      </div>
        <div class="led-box" >
         <div v-if="device.type === 'AP'"
             :class="{
                 'led-grey': !device.statusCode,
                 'led-blue': device.statusCode && (currentMwsRouterDisplay === 'None' || currentMwsRouterDisplay === 'Device not connected'),
                 'led-green': device.statusCode && !(currentMwsRouterDisplay === 'None' || currentMwsRouterDisplay === 'Device not connected')
        }">
        </div>
          <div v-else :class="[!isOffline ? 'led-green' : 'led-red', { 'led-grey': !device.statusCode }]"></div>
        </div>
      <a :href="isOwnedByCurrentUser ? device.URL : undefined"  target="_blank" :class="{ 'cursor-not-allowed': !isOwnedByCurrentUser }" >
        <svg
        class="bd-placeholder-img card-img-top"
        width="100%"
        height="225"
        role="button"
        focusable="false"
        :class="{ 'svg-disabled': !isOwnedByCurrentUser }"
      >
        <title>{{ device.shortName }} {{ device.hwId }}</title>
        <rect width="100%" height="100%" fill="#55595c"/>
        <text x="50%" y="50%" fill="#eceeef" dy=".3em">
          {{ device.shortName }} {{ device.hwId }}
        </text>
      </svg>
      </a>
    <div v-if="isLoading" class="spinner-border spinner-border-sm position-absolute text-white" style="top:10px; left:100px"></div>
       <div class="d-flex flex-column gap-1 p-2">
          <div class="d-flex flex-wrap gap-1 align-items-center">
  
      <button
      v-if="device.type === 'router'" 
      @click="openModal('wanTypes')" 
      :disabled="isLoading || isOffline || !isOwnedByCurrentUser" 
      type="button" 
      class="btn btn-outline-primary d-flex align-items-center high-100 gap-2"
      style="height: 35px; white-space: nowrap;"> 
      <i class="bi bi-hand-index-thumb"></i>
      Select WAN Type
      <span class="badge bg-dark mt-2 bg-opacity-10 text-dark d-flex align-items-center" style=" white-space: wrap; height: 26px;">
        <i class="bi bi-globe me-2"></i>
        {{ currentWanTypeDisplay || 'ISP not configured' }}
      </span>
     </button>

  
    <span  v-if="device.type === 'AP'" class="badge rounded-pill bg-dark bg-opacity-10 text-dark p-2 d-flex align-items-center">
      <i class="bi bi-router me-1"></i> AP Connected: {{ currentMwsRouterDisplay }}
      <Popper :offset-distance="'10'" :content="'Extender connected to router:' + currentMwsRouterDisplay" :arrow="true" :hover="true">
        <i class="bi bi-info-circle ms-1"></i>
      </Popper>
    </span>
  </div>

  <!-- Основные кнопки -->
  <div class="d-flex flex-wrap gap-2">
    <button @click="consoleOpen" :disabled="!isOwnedByCurrentUser || isLoading || consoleTimer > 0 || isConsoleOpen" type="button" class="btn btn-sm btn-outline-secondary flex-grow-1">
      <i class="bi bi-terminal me-1"></i> 
      <template v-if="consoleTimer === 0">Console</template>
      <template v-else>{{ consoleTimer }}s</template>
    </button>
    
    <button @click="resetConfig" :disabled="!isOwnedByCurrentUser || isLoading" type="button" class="btn btn-sm btn-outline-danger flex-grow-1">
      <i class="bi bi-arrow-counterclockwise me-1"></i> Reset config
    </button>
    
    <button @click="rebootDevice" :disabled="isLoading || !isOwnedByCurrentUser" type="button" class="btn btn-sm btn-outline-warning flex-grow-1">
      <i class="bi bi-power me-1"></i> Reboot
    </button>
    
    <button v-if="device.dslPort" @click="resetDslLine" :disabled="isLoading || isOffline || !isOwnedByCurrentUser" type="button" class="btn btn-sm btn-outline-secondary flex-grow-1">
      <i class="bi bi-phone me-1"></i> Reset DSL line
    </button>
  </div>

  <!-- Специальные кнопки -->
  <div class="d-flex flex-wrap gap-2">
    <button v-if="device.dslPort === 'yes'" :disabled="!isOwnedByCurrentUser" @click="openModal('dslSettings')" type="button" class="btn btn-sm btn-outline-info flex-grow-1">
      <i class="bi bi-gear me-1"></i> Setup DSL
    </button>
    
    <button v-if="device.type === 'AP'" :disabled="!isOwnedByCurrentUser" @click="openModal('mwsConnection')" type="button" class="btn btn-sm btn-outline-success flex-grow-1">
      <i class="bi bi-router me-1"></i> MWS Connection
    </button>
    

    
    <button v-if="device.type === 'router'" @click="vncOpen" :disabled="isLoading || isOffline || !isOwnedByCurrentUser" type="button" class="btn btn-sm btn-outline-secondary flex-grow-1">
      <i class="bi bi-display me-1"></i> LAN VNC
    </button>
    
    <button v-if="device.type === 'router'" @click="initializationDevice(todayPassword)" :disabled="isLoading || isOffline || !isOwnedByCurrentUser" type="button" class="btn btn-sm btn-outline-warning flex-grow-1">
      <i class="bi bi-toggle-off me-1"></i> Disable EasyConfig
    </button>
  </div>
</div>
</div>
    </div>


  <!-- Универсальное модальное окно -->

  <DeviceModal 
  ref="deviceModal" 
  :device="device"
  :wan-types="wanTypes"
  :filtered-devices="filteredDevices"
  :current-wan-type="currentWanTypeDisplay"
  @save="handleModalSave"
  @saveMws="handleModalSave"
/>


</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch,inject } from 'vue';
import { socket } from '@/socket';
import { toast } from 'vue3-toastify';
import DeviceModal from '@/components/DeviceModals.vue';
import { useDeviceBooking } from '@/composables/useDeviceBooking';
import { useDeviceActions } from '@/composables/useDeviceActions';
import Popper from "vue3-popper";
import VueToggles from 'vue-toggles';
import TimerPopup from '@/components/TimerPopup.vue';

const emit = defineEmits(['reservationChange'])
const props = defineProps({
  device: Object,
  wanTypes: Array,
  filteredDevices: Array,
  currentUserId: [String, Number],
  users: Array
});
const baseUrl = import.meta.env.VITE_WS_IP;
const deviceModal = ref(null);
const currentWanTypeDisplay = ref('ISP not configured');
const currentMwsRouterDisplay = ref('Device not connected');
const todayPassword = inject('todayPassword');
const isOffline = computed(() => props.device.statusCode !== 200);
const isApplyingChanges = ref(false);
const consoleTimer = ref(0);
const consoleInterval = ref(null);
const isConsoleOpen = ref(localStorage.getItem(`consoleOpen_${props.device.id}`) === 'true');




console.log("Status console Window:", props.device.id, isConsoleOpen.value);
const usersNames = computed(() => {
  return props.users.reduce((map, user) => {
    map[user.ip] = user.name;
    return map;
  }, {}); 
});
const connectedExtensions = computed(() => {
  const parts = []
  if (props.device.modem) parts.push(props.device.modem)
  if (props.device.phone) parts.push(props.device.phone)
  return parts.length ? parts.join(', ') : 'None'
})
const {
  showPopup,
  handleTimeConfirm,
  localBookingStatus,
  isSelected: bookingSelected,
  isLoading: isBookingLoading,
  handleBookingChange,
  timerSeconds,
  extendBooking
} = useDeviceBooking(
  props.device.id,
  computed(() => props.currentUserId),
  emit
);
const {
  isLoading: isActionLoading,
  resetConfig,
  rebootDevice,
  resetDslLine,
  initializationDevice
} = useDeviceActions(props.device, isOffline);
const isLoading = computed(() => isBookingLoading.value || isActionLoading.value);
const isSelected = ref(bookingSelected.value)

watch(showPopup, (val) => {
  if (!val && !isSelected.value && bookingSelected.value) {
    bookingSelected.value = false;
  }
});

watch(bookingSelected, (val) => {
  isSelected.value = val
})

watch(isSelected, (val) => {
  if (val !== bookingSelected.value) {
    handleBookingChange()
  }
})

const shouldDisableToggle = computed(() => {
  return (localBookingStatus.value.isBooked &&
          localBookingStatus.value.bookedBy !== props.currentUserId) ||
         showPopup.value || isApplyingChanges.value;
});

const isOwnedByCurrentUser = computed(() => {
  return !localBookingStatus.value.isBooked ||
         localBookingStatus.value.bookedBy === props.currentUserId;
});

const handleResetToggle = () => {
  isSelected.value = false;
  bookingSelected.value = false;
  handleBookingChange(false);
};

const openModal = (type) => {
  if (!deviceModal.value) return;

  let initialValue = null;

  if (type === 'wanTypes') {
    const currentWan = props.wanTypes.find(w => w.type === currentWanTypeDisplay.value);
    initialValue = currentWan?.vlanId || null;
  }
  if (type === 'mwsConnection') {
    initialValue = currentMwsRouterDisplay.value === 'None' ? null : currentMwsRouterDisplay.value;
  }
  if (type === 'dslSettings') {
    initialValue = props.wanTypes.find(w => w.description === currentWanTypeDisplay.value)?.vlanId || null;
  }
  if (deviceModal.value?.show) {
    deviceModal.value.show(type, initialValue);
  }
};

const handleWanSave = async (vlanId) => {
  return new Promise((resolve, reject) => {
    socket.emit('device:wanTypes:save', props.device.id, vlanId, (response) => {
      if (!response) return reject(new Error('No response from server'));
      if (response?.status === 'ok') return resolve();
      reject(new Error(response?.message || 'Save failed'));
    });

    setTimeout(() => reject(new Error('Request timeout')), 10000);
  });
};

const handleMwsSave = async (routerId, action) => {
  return new Promise((resolve, reject) => {
    socket.emit('device:mwsConnected', props.device.id, routerId, action, (response) => {
      if (!response) return reject(new Error('No response from server'));
      if (response?.status === 'ok') {
        currentMwsRouterDisplay.value = action === 'disconnect' ? 'None' : routerId;
        return resolve();
      }
      reject(new Error(response?.message || 'Save failed'));
    });

    setTimeout(() => reject(new Error('Request timeout')), 10000);
  });
};

const handleDslSave = async (settings) => {
  try {
    toast.success('DSL settings updated successfully',{ autoClose: 4000, hideProgressBar: false });
  } catch (error) {
    toast.error(`Failed to update DSL settings: ${error.message}`,{ autoClose: 4000, hideProgressBar: false });;
  }
};

const handleModalSave = async ({ value, type, action, callback }) => {
  isApplyingChanges.value = true;
  try {
    if (type === 'wanTypes') await handleWanSave(value);
    else if (type === 'mwsConnection') await handleMwsSave(value, action);
    else if (type === 'dslSettings') await handleDslSave(value);
    callback(true);
  } catch (error) {
    console.error('Modal save error:', error);
    callback(false, error.message);
  } finally {
    isApplyingChanges.value = false;
  }
};

const consoleOpen = () => {
  const params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`;
  const openWindow = window.open(`http://${import.meta.env.VITE_WEB_TELNET_IP}/remote/telnet/telnet/${props.device.consolePort}`, props.device.hwId, params);
  localStorage.setItem(`consoleOpen_${props.device.id}`, 'true');
  isConsoleOpen.value = true;
  const interval = setInterval(() => {
  if (!openWindow || openWindow.closed) {
    startConsoleTimer(openWindow);
    localStorage.setItem(`consoleOpen_${props.device.id}`, 'false');
    isConsoleOpen.value = false;
    clearInterval(interval);
  }
  }, 500);
};

const vncOpen = () => {
  const params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`;
  window.open(`${props.device.vncUrl}`, props.device.hwId, params);
  const debian = 'debian';
  toast.info(`VNC connection established. Connection password: ${debian}. It's copied to your clipboard.`, {
   autoClose: 5000,
   hideProgressBar: false,
   enableHtml: true
  });
   navigator.clipboard.writeText(debian);
};

const formatTime = (seconds) => {
  const d = Math.floor(seconds / 86400);
  const h = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  const dayText = d === 1 ? 'day' : 'days';
  return `${d} ${dayText} ${h}:${m}:${s}`;
};


const startConsoleTimer = (openWindow) => {
  if (!isOwnedByCurrentUser.value || consoleTimer.value > 0) return;

  // Начать таймер
  consoleTimer.value = import.meta.env.VITE_CONSOLE_TIMER;
  console.log('Console timer started:', consoleTimer.value);
  consoleInterval.value = setInterval(() => {
    if (consoleTimer.value > 0) {
      consoleTimer.value--;
      sessionStorage.setItem(`consoleTimer_${props.device.id}`, JSON.stringify({
        timestamp: Date.now(),
        secondsLeft: consoleTimer.value
      }));
    } else {
      clearInterval(consoleInterval.value);
      sessionStorage.removeItem(`consoleTimer_${props.device.id}`);
    }
  }, 1000);
};

const copy = (text) => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .then(() => toast.success('The password was copied to your clipboard!', { autoClose: 2000, hideProgressBar: false }))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
};

const fallbackCopy = (text) => {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  
  try {
    document.execCommand('copy');
    toast.success('The password was copied to your clipboard.', { autoClose: 2000, hideProgressBar: false });
  } catch (err) {
    toast.error('Failed to copy', { autoClose: 2000, hideProgressBar: false });
  } finally {
    document.body.removeChild(textarea);
  }
};

onMounted(() => {
  socket.emit('device:getCurrentWan', props.device.id, (response) => {
    currentWanTypeDisplay.value = !response?.type || response?.type === 'Clear WAN type'
      ? 'ISP not configured'
      : response.type;
  });

  socket.on('device:wanTypeUpdated', ({ deviceId, type }) => {
    if (deviceId === props.device.id) {
      currentWanTypeDisplay.value = type === 'Clear WAN type'
        ? 'ISP not configured'
        : type || 'ISP not configured';
    }
  });
  const savedTimer = sessionStorage.getItem(`consoleTimer_${props.device.id}`);
  if (savedTimer) {
    const { timestamp, secondsLeft } = JSON.parse(savedTimer);
    const elapsed = Math.floor((Date.now() - timestamp) / 1000);
    const remaining = secondsLeft - elapsed;

    if (remaining > 0) {
      consoleTimer.value = remaining;
      consoleInterval.value = setInterval(() => {
        if (consoleTimer.value > 0) {
          consoleTimer.value--;
          sessionStorage.setItem(`consoleTimer_${props.device.id}`, JSON.stringify({
            timestamp: Date.now(),
            secondsLeft: consoleTimer.value
          }));
        } else {
          clearInterval(consoleInterval.value);
          sessionStorage.removeItem(`consoleTimer_${props.device.id}`);
        }
      }, 1000);
    } else {
      sessionStorage.removeItem(`consoleTimer_${props.device.id}`);
    }
  }
});

onUnmounted(() => {
  socket.off('device:wanTypeUpdated');
  if (consoleInterval.value) {
    clearInterval(consoleInterval.value);
  }
  sessionStorage.removeItem(`consoleTimer_${props.device.id}`);
  localStorage.removeItem(`consoleOpen_${props.device.id}`);
  isConsoleOpen.value = false;
  consoleTimer.value = 0;
});

watch(isConsoleOpen, (val) => {
    localStorage.setItem(`consoleOpen_${props.device.id}`,val ? 'true' : 'false');
  });

  watch(
  () => localBookingStatus.value.accessPassword,
  (newPassword) => {
    console.log('Password changed:', newPassword);
  }
);

</script>

<style scoped>
.icon-button {
  background: none;
  margin-left: 3px ;
  border: none;
  padding: 0;
  cursor: pointer;
  pointer-events: auto !important;
}

.form-check-input {
  cursor: pointer;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  word-wrap: break-word;
  overflow: hidden;
  transition: box-shadow 0.3s ease;
}

.card:hover {
  box-shadow: 0 2px 8px rgba(0, 151, 220, 1), 
              0 2px 8px rgba(0, 151, 220, 1) !important;
}

  .card-body {
  flex-grow: 1;
}


.position-absolute.top-0.start-0 {
  max-width: calc(100% - 70px);
}

.position-absolute.top-0.end-0 {
  right: 5px;
}

.card-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background-color: rgba(0, 0, 0, 0.05); 
}

.card-booked .badge.bg-warning.text-dark {
  opacity: 1;
  background-color: #ffc107; 
  color: #343a40;
}

.badge-locked-timer {
  background-color: #ffc107;
  color:  #343a40;
  padding: 0.5rem 0.8rem;
  font-size: 0.75rem;
  z-index: 1;
  border-radius: 1rem;
  pointer-events: none;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.4);
  transition: all 0.3s ease-in-out;
  height: 1.5rem;
  align-items: center;
  z-index: 10;
}
.cursor-not-allowed {
  cursor: not-allowed;
}

.svg-disabled {
  opacity: 0.7;
  filter: grayscale(50%);
  cursor: not-allowed;
  transition: all 1s ease-in-out;
}

.lock-icon {
  filter: 
    hue-rotate(-50deg)
    saturate(220%)
    brightness(0.8)!important;
  margin-left: -3.5px;
  margin-top: -0.5px;
  padding-right: 1px;
  }

  .timer-popup-overlay {
  position: fixed;
  z-index: 1100; /* выше чем .card (обычно 1000+) */
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.custom-highlight {
  border: 2px solid #ffc107;
  box-shadow: 0 0 10px #ffc10780;
  box-sizing: border-box;
}

.toggle-wrapper {
  flex-shrink: 0;
  margin-left: auto;
  
}
.custom-tooltip {
  z-index: 9999 !important;
  font-size: 16px;
}
</style>