  <template>
  <div class="devices-management">
    <BookedDevicesTable 
      :loading="deviceStore.loading"
      @open-modal="handleOpenModal"
      @open-console="handleOpenConsole"
      @open-change-mode="handleOpenChangeMode"
    />

    <div class="show-booked-section" v-if="showBookedSectionButton">
      <Button 
        icon="pi pi-eye" 
        :label="`Show My Booked Devices (${deviceStore.bookedDevicesCount})`" 
        class="p-button-text p-button-sm close-btn"
        @click="deviceStore.expandBookedSection"
      />
    </div>

    <div class="card">
      <DataTable
        :value="sortedAndFilteredDevices"
        :loading="deviceStore.loading"
        :sort-field="sortField"
        :sort-order="sortOrder"
        @sort="onSort"
        data-key="id"
        :paginator="true"
        :rows="25"
        paginator-template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
        current-page-report-template="Showing {first} to {last} of {totalRecords} devices"
        :removable-sort="false"
        responsive-layout="scroll"
        class="full-width-table"
      >
        <template #header>
          <div class="table-header">
            <div class="common-section-header">
              <h3 class="common-section-title">
                <i class="pi pi-list-check mr-2"></i>
                All Devices
                <Badge :value="deviceStore.totalDevices" class="ml-2" />
              </h3>
              <div class="common-section-actions">
                <span class="devices-count">
                  <i class="pi pi-circle-fill online-icon"></i>
                    {{ deviceStore.onlineCount }} online
                    <i class="pi pi-circle-fill offline-icon"></i>
                    {{ deviceStore.offlineCount }} offline
                    <i class="pi pi-calculator total-icon"></i>
                    {{ deviceStore.totalDevices }} total
                    <span v-if="deviceStore.bookedByOtherDevices.length > 0" class="booked-by-others">
                      <i class="pi pi-bookmark booked-icon"></i>
                      {{ deviceStore.bookedByOtherDevices.length }} booked by others
                      </span>
                </span>

                <div class="common-search-wrapper">
                  <span class="p-input-icon-left common-search-input-container">
                    <i class="pi pi-search common-search-icon" />
                    <InputText 
                      v-model="globalFilter" 
                      placeholder="Search devices..." 
                      class="common-global-filter"
                    />
                    <button 
                      v-if="globalFilter" 
                      class="common-search-clear-btn p-button-text p-button-rounded"
                      @click="clearSearch"
                    >
                      <i class="pi pi-times"></i>
                    </button>
                  </span>
                  
                </div>
              </div>
            </div>
          </div>
        </template>
        <Column field="statusCode" header="Status" :sortable="true" class="status-column">
          <template #body="{ data }">
            <StatusIndicator :status="data.statusCode" :type="data.type" />
          </template>
        </Column>

        <Column field="hwId" header="Device" :sortable="true" class="device-column">
          <template #body="{ data }">
            <div class="common-device-info-container">
              <div class="common-device-avatar" :class="getDeviceAvatarClass(data)">
                <i :class="deviceIcon(data.type)" class="common-device-icon"></i>
              </div>
              <div class="common-device-info">
                <div class="common-device-name">{{ data.shortName }}</div>
                <div class="common-device-hwid">{{ data.hwId }}</div>
                <div class="common-device-hwid">Country: {{ data.country }}</div>
              </div>
            </div>
          </template>
        </Column>

        <Column field="firmwareVersion" header="Firmware" bodyClass="firmware-column">
          <template #body="{ data }">
            <FirmwareVersion 
              :device="data"
              :current-user-id="deviceStore.currentUserId"
              :today-password="todayPassword"
              :auto-check-enabled="false"
              @firmware-updated="handleFirmwareUpdated"
            />
          </template>
        </Column>

        <Column field="type" header="HW Type" :sortable="true" class="type-column">
          <template #body="{ data }">
            <Tag :value="data.type.toUpperCase()" :severity="getTypeSeverity(data.type)" class="type-tag" />
          </template>
        </Column>

        <Column field="booking.isBooked" header="Booking" class="booking-column">
          <template #body="{ data }">
            <div v-if="data.booking?.isBooked && data.booking?.bookedBy !== deviceStore.currentUserId">
              <Tag :value="deviceStore.getUserName(data.booking?.bookedBy)" severity="warning" /> 
            </div>
            <BookingStatus 
              v-else
              :device="data"
              :current-user-id="deviceStore.currentUserId"
            />
          </template>
        </Column>

        <Column field="currentWanType" header="WAN" class="wan-column">
          <template #body="{ data }">
            <WanTypeDisplay 
              :device="data" 
              :wan-types="wanTypes"
              :current-user-id="deviceStore.currentUserId"
              @open-modal="handleOpenModal"
            />
          </template>
        </Column>

        <Column header="Actions" class="actions-column">
          <template #body="{ data }">
            <DeviceActions 
              :device="data"
              :current-user-id="deviceStore.currentUserId"  
              @open-console="handleOpenConsole"
              @open-change-mode="handleOpenChangeMode"
            />
          </template>
        </Column>

        <template #empty>
          <div class="empty-state">
            <span class="empty-text">No devices found.</span>
          </div>
        </template>

        <template #loading>
          <div class="loading-state">
            <ProgressSpinner class="loading-spinner" />
          </div>
        </template>
      </DataTable>

      <PrimeDeviceModal 
        ref="deviceModal" 
        :device="selectedDevice"
        :wan-types="wanTypes"
        :filtered-devices="deviceStore.routerDevices"
        @save="handleModalSave"
      />
      <ProgressModal 
      ref="progressModal" 
      :device="selectedDevice"> 
      </ProgressModal>
      <ChangeModeModal 
        ref="changeModeModal"
        :device="selectedDevice"
        :available-routers="deviceStore.routerDevices"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, inject, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { socket } from '@/socket'
import StatusIndicator from './StatusIndicator.vue'
import BookingStatus from './BookingStatus.vue'
import WanTypeDisplay from './WanTypeDisplay.vue'
import DeviceActions from './DeviceActions.vue'
import PrimeDeviceModal from './PrimeDeviceModal.vue'
import ProgressModal from './ProgressModal.vue'
import ChangeModeModal from './ChangeModeModal.vue'
import FirmwareVersion from '@/components/FirmwareVersion.vue'
import BookedDevicesTable from './BookedDevicesTable.vue'

const todayPassword = inject('todayPassword')
const toast = useToast()
const deviceStore = useDeviceStore()

const props = defineProps({
  wanTypes: {
    type: Array,
    default: () => []
  }
})

const globalFilter = ref('')
const selectedDevice = ref(null)
const deviceModal = ref(null)
const changeModeModal = ref(null)
const sortField = ref('statusCode')
const sortOrder = ref(-1)

const showBookedSectionButton = computed(() => {
  return deviceStore.isBookedSectionCollapsed && deviceStore.bookedDevicesCount > 0
})

const filteredDevices = computed(() => {
  if (!globalFilter.value) return deviceStore.availableDevices
  const filter = globalFilter.value.toLowerCase()
  return deviceStore.availableDevices.filter(device => 
    device.hwId?.toLowerCase().includes(filter) || 
    device.id?.toString().toLowerCase().includes(filter) || 
    device.shortName?.toLowerCase().includes(filter) ||
    device.type?.toLowerCase().includes(filter)
  )
})

const sortedAndFilteredDevices = computed(() => {
  const devices = [...filteredDevices.value]
  if (!sortField.value) {
    return devices.sort((a, b) => {
      const aIsOnline = Number(a.statusCode) === 200
      const bIsOnline = Number(b.statusCode) === 200
      if (aIsOnline && !bIsOnline) return -1
      if (!aIsOnline && bIsOnline) return 1
      return 0
    })
  }
  return devices.sort((a, b) => {
    let aValue = getNestedValue(a, sortField.value)
    let bValue = getNestedValue(b, sortField.value)
    if (sortField.value === 'statusCode') {
      const aIsOnline = Number(aValue) === 200
      const bIsOnline = Number(bValue) === 200
      if (aIsOnline && !bIsOnline) return -1
      if (!aIsOnline && bIsOnline) return 1
      const aName = a.shortName?.toLowerCase() || ''
      const bName = b.shortName?.toLowerCase() || ''
      if (aName < bName) return -1
      if (aName > bName) return 1
      return 0
    }
    if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase()
      bValue = bValue.toLowerCase()
    }
    let result = 0
    if (aValue < bValue) result = -1
    else if (aValue > bValue) result = 1
    return sortOrder.value === -1 ? -result : result
  })
})

const clearSearch = () => {
  globalFilter.value = ''
}

const getNestedValue = (obj, path) => {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null
  }, obj)
}

const onSort = (event) => {
  sortField.value = event.sortField
  sortOrder.value = event.sortOrder
}

const deviceIcon = (type) => {
  const icons = {
    router: 'bi bi-router',
    AP: 'bi bi-wifi',
    switch: 'pi pi-sitemap'
  }
  return icons[type] || 'pi pi-question-circle'
}

const getDeviceAvatarClass = (device) => {
  if (device.statusCode !== 200) return 'offline'
  if (device.type === 'AP') return 'ap'
  return 'online'
}

const getTypeSeverity = (type) => {
  const severityMap = {
    router: 'info',
    AP: 'success',
    switch: 'warning'
  }
  return severityMap[type] || 'secondary'
}

const handleOpenModal = (device, modalType) => {
  selectedDevice.value = device
  
  // ✅ ПОДГОТАВЛИВАЕМ ПАРОЛЬ ДЛЯ MWS МОДАЛКИ
  let devicePassword = null
  let passwordSource = 'global'
  
  if (device.booking?.isBooked && 
      device.booking?.bookedBy === deviceStore.currentUserId &&
      device.booking?.accessPassword) {
    devicePassword = device.booking.accessPassword
    passwordSource = 'booking'
  }
  
  nextTick(() => {
    // ✅ ПЕРЕДАЕМ ПАРОЛЬ В МОДАЛКУ
    if (modalType === 'mwsConnection') {
      deviceModal.value?.show(modalType, devicePassword, passwordSource)
    } else {
      deviceModal.value?.show(modalType)
    }
  })
}

const handleOpenConsole = async (device) => {
  try {
    if (!device.booking?.isBooked || device.booking?.bookedBy !== deviceStore.currentUserId) {
      toast.add({ 
        severity: 'error', 
        summary: 'Access Denied', 
        detail: 'You can only open console for your booked devices', 
        life: 4000 
      })
      return
    }
    const response = await new Promise((resolve, reject) => {
      socket.emit('device:getConsoleUrl', device.id, (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.error || 'Failed to get console URL'))
        }
      })
      setTimeout(() => reject(new Error('Request timeout')), 5000)
    })
    const params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`
    const openWindow = window.open(response.url, `console_${device.id}`, params)
    if (!openWindow) {
      throw new Error('Popup blocked. Please allow popups for this site.')
    }

  } catch (error) {
    console.error('Failed to open console:', error)
  }
}

const handleOpenChangeMode = (device) => {
  if (!device.booking?.isBooked || device.booking?.bookedBy !== deviceStore.currentUserId) {
    toast.add({
      severity: 'error',
      summary: 'Access Denied',
      detail: 'You can only change mode for your booked devices',
      life: 4000
    })
    return
  }
  selectedDevice.value = device
  let password = null
  let source = 'global'
  if (device.booking?.isBooked && 
      device.booking?.bookedBy === deviceStore.currentUserId &&
      device.booking?.accessPassword) {
    password = device.booking.accessPassword
    source = 'booking'
  }
  nextTick(() => {
    changeModeModal.value?.show(password, source)
  })
}

// const mwsOperationInProgress = ref(false)
const progressModal = ref(null)

const handleMwsSave = async (deviceId, routerId, action, routerPassword = null, useDevicePassword = true) => {
  return new Promise((resolve, reject) => {
    // ✅ ИСПРАВЛЕНИЕ: ПРАВИЛЬНО ПЕРЕДАЕМ operationData С action
    const device = deviceStore.devices.find(d => d.id === deviceId)
    if (device && progressModal.value) {
      progressModal.value.show('mwsConnection', device, {
        action: action, 
        routerId: routerId
      })
    }
    
    const mwsData = {
      deviceId,
      routerId, 
      action,
      routerPassword,
      useDevicePassword
    }
    
    console.log('🔗 Sending MWS operation:', mwsData);
    
    socket.emit('device:mwsConnected', mwsData, (response) => {
      if (!response) {
        reject(new Error('No response from server'))
        return
      }
      
      if (response?.status === 'ok') {
        console.log('✅ MWS operation completed successfully');
        resolve()
      } else {
        console.error('❌ MWS operation failed:', response.error);
        reject(new Error(response?.error || 'MWS operation failed'))
      }
    })
    
    // ✅ УВЕЛИЧИВАЕМ ТАЙМАУТ ДО 120 СЕКУНД ДЛЯ DISCONNECT
    const timeoutDuration = action === 'disconnect' ? 120000 : 60000;
    
    setTimeout(() => {
      reject(new Error(`Request timeout - device is slow to respond (${timeoutDuration/1000}s)`))
    }, timeoutDuration)
  })
}

const handleModalSave = async ({ value, type, action, routerPassword, useDevicePassword, callback }) => {
  if (!selectedDevice.value) {
    callback(false, 'No device selected')
    return
  }
  
  try {
    if (type === 'wanTypes') {
      const result = await handleWanSave(selectedDevice.value.id, value)
      // ✅ ПЕРЕДАЕМ СООБЩЕНИЕ ИЗ handleWanSave В КАЧЕСТВЕ ВТОРОГО АРГУМЕНТА
      callback(true, result)
    } else if (type === 'mwsConnection') {
      await handleMwsSave(
        selectedDevice.value.id, 
        value, 
        action, 
        routerPassword, 
        useDevicePassword
      )
      callback(true)
    }
  } catch (error) {
    console.error('Modal save error:', error)
    callback(false, error.message)
  }
}

// ✅ ИСПРАВЛЕННЫЙ метод handleWanSave - ВОЗВРАЩАЕТ СООБЩЕНИЕ
const handleWanSave = async (deviceId, vlanId) => {
  return new Promise((resolve, reject) => {
    socket.emit('device:wanTypes:save', deviceId, vlanId, (response) => {
      if (!response) return reject(new Error('No response from server'))
      
      if (response?.status === 'ok') {
        const device = deviceStore.devices.find(d => d.id === deviceId)
        const deviceName = device?.shortName || device?.hwId || 'Unknown device'
        const wanStatus = vlanId === "4094" ? "WAN port is DOWN" : "WAN port is UP"
        
        // ✅ ВОЗВРАЩАЕМ СООБЩЕНИЕ, А НЕ ПРОСТО РЕЗОЛВИМ
        resolve(`WAN type updated for ${deviceName} - ${wanStatus}`)
      } else {
        reject(new Error(response?.message || 'Save failed'))
      }
    })
    setTimeout(() => reject(new Error('Request timeout')), 10000)
  })
}


watch(() => deviceStore.availableDevices, (newDevices) => {
  if (newDevices.length > 0) {
    setTimeout(() => {
      sortField.value = 'statusCode'
      sortOrder.value = -1
    }, 500)
  }
}, { deep: true, immediate: true })

onMounted(() => {
  deviceStore.loadCollapsedState()
})
</script>

<style scoped>

.devices-count {
  font-size: 0.9rem;
  color: var(--text-color-secondary);
  font-weight: 500;
  background: var(--surface-ground);
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--surface-200);
  white-space: nowrap;
}
.online-icon {
  color: var(--green-500);
  font-size: 0.5rem;
  
}

.offline-icon {
  color: var(--red-500);
  font-size: 0.5rem;
}
.total-icon {
  color: var(--blue-500);
}
.devices-management {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
}
.show-booked-section {
  display: flex;
  justify-content: center;
  padding: 0.75rem;
  background: var(--surface-card);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-bottom: 1rem;
  width: 100%;
  border: 1px solid var(--surface-border);
  transition: all 0.3s ease;
}
.card {
  padding: 0;
  background: var(--surface-card);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  width: 100%;
  overflow: hidden;
  margin-top: 0;
}
.table-header {
  width: 100%;
  padding: 0 !important;
  background: var(--surface-card);
  border-radius: 12px 12px 0 0;
}
.booked-by-others {
  color: var(--orange-500);
  font-weight: 600;
}
.empty-state, .loading-state {
  display: flex;
  justify-content: center;
  padding: 2rem;
  width: 100%;
}
.empty-text {
  color: var(--text-color-secondary);
}
.loading-spinner {
  width: 40px;
  height: 40px;
}
.type-tag {
  font-size: 0.75rem;
  font-weight: 600;
}
@media (max-width: 1200px) {
  .card {
    overflow-x: auto;
  }
}
</style>

<style scoped>

:deep(.p-datatable .p-datatable-header) {
    background: var(--surface-card) !important;
    padding: 0 !important;
    margin: 0 !important;
    border-bottom: 1px solid var(--surface-border) !important;
}
:deep(.p-column-header-content) {
    justify-content: center !important;
    text-align: center !important;
    width: 100% !important;
}
:deep(.status-column) {
  width: 100px;
  min-width: 100px;
  max-width: 100px;
}

:deep(.device-column) {
  width: 220px; 
  min-width: 220px;
  max-width: 220px;  
}

:deep(.firmware-column) {
  width: 200px;  
  min-width: 200px;
  max-width: 200px;
  text-align: center !important;
}

:deep(.type-column) {
  width: 120px;
  min-width: 120px;
  max-width: 120px;
  text-align: center !important;

}

:deep(.booking-column) {
  width: 160px;
  min-width: 160px;
  max-width: 160px;
  text-align: center !important;

}

:deep(.wan-column) {
  width: 140px;
  min-width: 140px;
  max-width: 140px;
}

:deep(.actions-column) {
  width: 200px;
  min-width: 200px;
  max-width: 200px;
}
:deep(.p-datatable-tbody > tr) {
  transition: background-color 0.2s ease;
  height: 90px;
}
:deep(.p-datatable .p-datatable-thead > tr > th) {
  background: var(--surface-card);
  font-weight: 600;
  color: var(--text-color);
  border-bottom: 1px solid var(--surface-border);
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  position: sticky;
  top: 0;
  z-index: 10;
}
:deep(.p-datatable) {
  border: none;
}
</style>