<template>
  <div class="devices-management">
    <div class="card">
      <DataTable
        :key="tableKey"
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
        class="full-width-table notes-table"
        rowHover
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
                  <span v-if="deviceStore.bookedByOtherDevices?.length > 0" class="booked-by-others">
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
        
        <Column field="statusCode" header="Status" :sortable="true" style="min-width: 85px">
          <template #body="{ data }">
            <StatusIndicator :status="data.statusCode" :type="data.type" />
          </template>
        </Column>

        <Column field="hwId" header="Device" :sortable="true" style="min-width: 200px">
          <template #body="{ data }">
            <div
              v-tooltip.right="{
                value: getNotesForTooltip(data.id),
                escape: false,
                class: 'notes-tooltip',
                showDelay: 500
              }"
              @mouseenter="loadNotesForTooltip(data.id)"
              class="device-row-tooltip-wrapper"
            >
              <div class="common-device-info-container">
                <div class="common-device-avatar" :class="getDeviceAvatarClass(data)">
                  <i :class="deviceIcon(data.type)" class="common-device-icon"></i>
                </div>
      
                <div class="common-device-info">
                  <div class="common-device-name">
                    <template v-if="editingDeviceId === data.id">
                      <div class="edit-name-container">
                        <input
                          ref="nameInput"
                          v-model="editingName"
                          class="edit-name-input-native"
                          @keyup.enter="saveDeviceName(data)"
                          @keyup.escape="cancelEditName"
                          @blur="saveDeviceName(data)"
                          autofocus
                        />
                      </div>
                    </template>
                    <template v-else>
                      <span 
                        class="editable-name"
                        @click.stop="startEditName(data)"
                        v-tooltip="'Click to edit device name'"
                      >
                        {{ data.shortName }}
                        <i class="pi pi-pencil edit-name-icon"></i>
                      </span>
                    </template>
                    
                    <i 
                      class="pi pi-info-circle details-inline" 
                      @click="showDeviceDetails(data)" 
                      v-tooltip="'View device details'"
                    ></i>
                  </div>
                  
                  <div class="common-device-hwid">
                    {{ data.hwId }}
                    <span class="site-badge" v-if="data.site">SITE {{ data.site }}</span>
                    <div class="common-device-hwid">Country: {{ data.country }}</div>
                  </div>

                  <div class="common-device-hwid">
                    Servicetag: {{ data.servicetag || 'N/A' }}
                    <i 
                      v-if="data.servicetag"
                      class="pi pi-copy details-inline" 
                      @click="copyToClipboard(data.servicetag, 'Servicetag')" 
                      v-tooltip="'Copy Servicetag'"
                    ></i>
                  </div>

                  <div class="common-device-hwid">
                    Current Mode: <b>{{ getDisplayMode(data.id) }}</b>
                    <i class="pi pi-refresh details-inline m-1" @click="refreshDeviceMode(data.id)" v-tooltip="'Refresh mode info'"></i>
                  </div>
                  <div v-if="shouldShowConnectionInfo(data.id)" class="common-device-hwid">
                    Connected to: <b>{{ getConnectedRouterInfo(data.id) }}</b>
                  </div>
                  <div v-if="data.rebootPort" class="common-device-hwid">
                    Power Port Status: 
                    <span :class="getPowerStatusClass(data.id)">
                      <i :class="getPowerStatusIcon(data.id)" class="mr-1"></i>
                      {{ getPowerStatusText(data.id) }}
                    </span>
                    <i class="pi pi-refresh details-inline" @click="refreshPowerStatus(data.id)" v-tooltip="'Refresh power status'"></i>
                  </div>
                </div>
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
              :key="`fw-${data.id}-${data.firmwareVersion || 'unknown'}-${data.statusCode}`"
              @firmware-updated="handleFirmwareUpdated"
            />
          </template>
        </Column>

        <Column header="WAN" style="min-width: 120px">
          <template #body="{ data }">
            <WanTypeDisplay 
              :device="data" 
              :wan-types="wanTypes"
              :current-user-id="deviceStore.currentUserId"
              @open-modal="handleOpenModal"
            />
          </template>
        </Column>

        <Column header="Actions" style="min-width: 200px">
          <template #body="{ data }">
            <div class="actions-container">
              <div class="device-controls">
                <Button
                  v-tooltip.bottom="consoleStore.isConsoleOpen(data.id) ? 'Focus Console' : 'Open Console'"
                  :icon="consoleStore.isConsoleOpen(data.id) ? 'bi bi-terminal-fill' : 'bi bi-terminal'"
                  class="p-button-sm p-button-outlined p-button-secondary p-button-rounded action-btn"
                  @click="handleConsoleClick(data)"
                  :class="{ 'console-open': consoleStore.isConsoleOpen(data.id) }"
                />
                
                <Button
                  v-if="data.rebootPort"
                  v-tooltip.bottom="'Power Management'"
                  icon="pi pi-power-off"
                  class="p-button-sm p-button-outlined p-button-warning p-button-rounded action-btn"
                  :class="{ 'power-menu': true }"
                  @click="showPowerMenu(data)"
                  :disabled="!canPowerManage(data) || isAnyOperationOnThisDevice(data)"
                />
                
                <Button
                  v-tooltip.bottom="isResetting(data) ? 'Resetting...' : 'Reset Configuration'"
                  :icon="isResetting(data) ? 'pi pi-spinner pi-spin' : 'pi pi-refresh'"
                  class="p-button-sm p-button-outlined p-button-danger p-button-rounded action-btn"
                  :disabled="!canResetConfig(data) || isAnyOperationOnThisDevice(data)" 
                  @click="showResetConfirm(data)"
                />
                
                <Button
                  v-if="data.type === 'AP'"
                  v-tooltip.bottom="'Connection AP to Router(MWS)'"
                  icon="pi pi-wifi"
                  class="p-button-sm p-button-outlined p-button-success p-button-rounded action-btn"
                  @click="$emit('open-modal', data, 'mwsConnection')"
                  :disabled="!canMwsConnect(data)"
                />
                
                <Button
                  v-if="data.type === 'router' && data.hWtype !== 'HardwareAP'"
                  v-tooltip.bottom="'Change Mode'"
                  icon="pi pi-wrench"
                  class="p-button-sm p-button-outlined p-button-info p-button-rounded action-btn"
                  @click="handleOpenChangeMode(data)"
                  :disabled="!canChangeMode(data)"
                />
                
                <Button
                  v-if="data.dslPort"
                  v-tooltip.bottom="isResettingDsl(data) ? 'Resetting DSL...' : 'Reset DSL Line'"
                  :icon="isResettingDsl(data) ? 'pi pi-spinner pi-spin' : 'pi pi-phone'"
                  class="p-button-sm p-button-outlined p-button-help p-button-rounded action-btn"
                  :disabled="!canResetDsl(data) || isAnyOperationOnThisDevice(data)"
                  @click="showDslResetConfirm(data)"
                />
                
                <Button
                  v-if="data.type === 'router' && data.vncUrl"
                  v-tooltip.bottom="'LAN VNC'"
                  icon="pi pi-desktop"
                  class="p-button-sm p-button-outlined p-button-secondary p-button-rounded action-btn"
                  @click="openVnc(data)"
                  :disabled="!canOpenVnc(data)"
                />
                
                <Button
                  v-if="data.URL"
                  v-tooltip.bottom="'Open Device Interface'"
                  icon="bi bi-layout-sidebar"
                  class="p-button-sm p-button-outlined p-button-primary p-button-rounded action-btn"
                  @click="openDeviceInterface(data)"
                />
                
                <Button
                  v-if="data.type === 'router'"
                  v-tooltip.bottom="isInitializing(data) ? 'Initializing...' : 'Skip Wizard - set password'"
                  :icon="isInitializing(data) ? 'pi pi-spinner pi-spin' : 'bi bi-magic'"
                  class="p-button-sm p-button-outlined p-button-warning p-button-rounded action-btn"
                  :disabled="!canInitialize(data) || isAnyOperationOnThisDevice(data)" 
                  @click="handleInitialization(data)"
                />
              </div>
            </div>    
          </template>
        </Column>

        <template #empty>
          <div class="empty-state"><span class="empty-text">No devices found.</span></div>
        </template>
      </DataTable>

      <PrimeDeviceModal ref="deviceModal" :device="selectedDevice" :wan-types="wanTypes"
        :filtered-devices="filteredDevices" :current-wan-type="currentDeviceWanType"
        @save="handleModalSave" @operation-started="handleOperationStarted" />
      <ProgressModal ref="progressModal" :device="selectedDevice" />
      <ChangeModeModal ref="changeModeModal" :device="selectedDevice"
        :available-routers="deviceStore.routerDevices"
        @operation-started="handleOperationStarted" @mode-changed="handleModeChanged" />

      <Dialog v-model:visible="showResetConfirmDialog" modal :blockScroll="false" header="Reset Configuration" :style="{ width: '450px' }">
        <div class="confirmation-content">
          <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #e74c3c;" />
          <div><h4 class="mb-2">Reset device configuration?</h4><p class="text-color-secondary mb-0">This will erase all settings for <strong>{{ selectedDevice?.hwId }}</strong>.</p></div>
        </div>
        <template #footer>
          <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="showResetConfirmDialog = false" />
          <Button label="Reset Configuration" icon="pi pi-refresh" class="p-button-danger" @click="confirmReset" />
        </template>
      </Dialog>

      <Dialog v-model:visible="showDslResetConfirmDialog" modal :blockScroll="false" header="Reset DSL Line" :style="{ width: '450px' }">
        <div class="confirmation-content">
          <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #3498db;" />
          <div><h4 class="mb-2">Reset DSL line?</h4><p class="text-color-secondary mb-0">DSL connection for <strong>{{ selectedDevice?.hwId }}</strong> will be reset.</p></div>
        </div>
        <template #footer>
          <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="showDslResetConfirmDialog = false" />
          <Button label="Reset DSL Line" icon="pi pi-phone" class="p-button-secondary" @click="confirmDslReset" />
        </template>
      </Dialog>

      <Dialog :blockScroll="false" v-model:visible="showPowerMenuDialog" modal header="Power Management" :style="{ width: '400px' }">
        <div class="power-menu-content">
          <p class="mb-3">Select action for <strong>{{ powerActionDevice?.hwId }}</strong>:</p>
          <div class="power-options">
            <div class="power-option p-3 border-round surface-ground mb-2" @click="selectPowerAction('reboot')">
              <div class="flex align-items-center"><i class="pi pi-refresh text-warning mr-3" style="font-size: 1.5rem"></i><div><div class="font-bold">Reboot Device</div><small>Restart (1-2 min)</small></div></div>
            </div>
            <div v-if="powerActionDevice && deviceActionsStore.isPoweredOff(powerActionDevice.id)" class="power-option p-3 border-round surface-ground mb-2" @click="selectPowerAction('on')">
              <div class="flex align-items-center"><i class="pi pi-power-off text-success mr-3" style="font-size: 1.5rem"></i><div><div class="font-bold">Power On</div><small>Turn on</small></div></div>
            </div>
            <div v-if="powerActionDevice && deviceActionsStore.isPoweredOn(powerActionDevice.id)" class="power-option p-3 border-round surface-ground mb-2" @click="selectPowerAction('off')">
              <div class="flex align-items-center"><i class="pi pi-power-off text-danger mr-3" style="font-size: 1.5rem"></i><div><div class="font-bold">Power Off</div><small>Turn off</small></div></div>
            </div>
          </div>
        </div>
        <template #footer><Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="showPowerMenuDialog = false" /></template>
      </Dialog>

      <Dialog :blockScroll="false" v-model:visible="showPowerActionConfirmDialog" modal :header="`Confirm ${getPowerActionLabel(selectedPowerAction)}`" :style="{ width: '450px' }">
        <div class="confirmation-content">
          <i :class="getPowerActionIcon(selectedPowerAction)" class="mr-3" style="font-size: 2rem;" :style="{ color: selectedPowerAction === 'reboot' ? '#f39c12' : selectedPowerAction === 'on' ? '#28a745' : '#dc3545' }"></i>
          <div><h4 class="mb-2">{{ getPowerActionLabel(selectedPowerAction) }}?</h4><p class="text-color-secondary mb-0">Device <strong>{{ powerActionDevice?.hwId }}</strong> will be affected.</p></div>
        </div>
        <template #footer>
          <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="cancelPowerAction" />
          <Button :label="getPowerActionLabel(selectedPowerAction)" :icon="getPowerActionIcon(selectedPowerAction)" :class="`p-button-${getPowerActionSeverity(selectedPowerAction)}`" @click="confirmPowerAction" />
        </template>
      </Dialog>

      <Dialog v-model:visible="showDetailsDialog" header="Device Details" modal :blockScroll="false" :style="{ width: '700px', maxWidth: '90vw' }" :contentStyle="{ maxHeight: '70vh' }">
        <div v-if="selectedDevice" class="device-details-horizontal">
          <div class="detail-section"><h4>Basic Information</h4>
            <div class="horizontal-grid">
              <div class="field-group"><label class="field-label">Name</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.shortName }}</span></div></div>
              <div class="field-group"><label class="field-label">HW ID</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.hwId }}</span></div></div>
              <div class="field-group"><label class="field-label">Type</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.type }}</span></div></div>
              <div class="field-group"><label class="field-label">Country</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.country || 'N/A' }}</span></div></div>
              <div class="field-group"><label class="field-label">Site</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.site || 'N/A' }}</span></div></div>
            </div>
          </div>
          <div class="detail-section"><h4>Technical Information</h4>
            <div class="horizontal-grid">
              <div class="field-group"><label class="field-label">MAC Address</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.macAddress || 'N/A' }}</span><Button v-if="selectedDevice.macAddress" icon="pi pi-copy" class="p-button-text p-button-sm copy-btn" @click="copyToClipboard(selectedDevice.macAddress, 'MAC Address')" /></div></div>
              <div class="field-group"><label class="field-label">Servicetag</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.servicetag || 'N/A' }}</span><Button v-if="selectedDevice.servicetag" icon="pi pi-copy" class="p-button-text p-button-sm copy-btn" @click="copyToClipboard(selectedDevice.servicetag, 'Servicetag')" /></div></div>
              <div class="field-group"><label class="field-label">Serial Number</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.serialNumber || 'N/A' }}</span><Button v-if="selectedDevice.serialNumber" icon="pi pi-copy" class="p-button-text p-button-sm copy-btn" @click="copyToClipboard(selectedDevice.serialNumber, 'Serial Number')" /></div></div>
            </div>
          </div>
          <div class="detail-section"><h4>Network Information</h4>
            <div class="horizontal-grid">
              <div class="field-group"><label class="field-label">IP Address Container</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.ip || 'N/A' }}</span><Button v-if="selectedDevice.ip" icon="pi pi-copy" class="p-button-text p-button-sm copy-btn" @click="copyToClipboard(selectedDevice.ip, 'IP Address')" /></div></div>
              <div class="field-group"><label class="field-label">Check URL</label><div class="field-value-group"><span class="field-value url-text">{{ selectedDevice.checkUrl || 'N/A' }}</span><Button v-if="selectedDevice.checkUrl" icon="pi pi-copy" class="p-button-text p-button-sm copy-btn" @click="copyToClipboard(selectedDevice.checkUrl, 'Check URL')" /></div></div>
              <div class="field-group"><label class="field-label">VNC URL</label><div class="field-value-group"><span class="field-value url-text">{{ selectedDevice.vncUrl || 'N/A' }}</span><Button v-if="selectedDevice.vncUrl" icon="pi pi-copy" class="p-button-text p-button-sm copy-btn" @click="copyToClipboard(selectedDevice.vncUrl, 'VNC URL')" /></div></div>
              <div class="field-group"><label class="field-label">SSH Container</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.sshContainer || 'N/A' }}</span><Button v-if="selectedDevice.sshContainer" icon="pi pi-copy" class="p-button-text p-button-sm copy-btn" @click="copyToClipboard(selectedDevice.sshContainer, 'SSH Container')" /></div></div>
            </div>
          </div>
          <div class="detail-section"><h4>Ports & Configuration</h4>
            <div class="horizontal-grid compact-grid">
              <div class="field-group" v-if="selectedDevice.consolePort"><label class="field-label">Console Port</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.consolePort }}</span></div></div>
              <div class="field-group" v-if="selectedDevice.resetPort"><label class="field-label">Reset Port</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.resetPort }}</span></div></div>
              <div class="field-group" v-if="selectedDevice.rebootPort"><label class="field-label">Reboot Port</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.rebootPort }}</span></div></div>
              <div class="field-group" v-if="selectedDevice.vlanLocal"><label class="field-label">VLAN Local</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.vlanLocal }}</span></div></div>
              <div class="field-group" v-if="selectedDevice.switchID"><label class="field-label">Switch ID</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.switchID }}</span></div></div>
              <div class="field-group" v-if="selectedDevice.switchPortWan"><label class="field-label">WAN Port</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.switchPortWan }}</span></div></div>
              <div class="field-group" v-if="selectedDevice.switchPortLan"><label class="field-label">LAN Port</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.switchPortLan }}</span></div></div>
              <div class="field-group" v-if="selectedDevice.jeromeID"><label class="field-label">Jerome ID</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.jeromeID }}</span></div></div>
              <div class="field-group" v-if="selectedDevice.consoleID"><label class="field-label">Console ID</label><div class="field-value-group"><span class="field-value">{{ selectedDevice.consoleID }}</span></div></div>
            </div>
          </div>
          <div class="detail-section">
            <div class="notes-header"><h4>Notes</h4><Button icon="pi pi-plus" class="p-button-sm p-button-outlined p-button-rounded" @click="addNote" v-tooltip="'Add note'" /></div>
            <div v-if="loadingNotes" class="loading-state"><i class="pi pi-spin pi-spinner"></i><span>Loading notes...</span></div>
            <div v-else-if="deviceNotes.length === 0" class="empty-notes"><i class="pi pi-pencil"></i><span>No notes. Click + to add one.</span></div>
            <div v-else class="notes-list">
              <div v-for="note in deviceNotes" :key="note.id" class="note-item">
                <div class="note-header">
                  <span class="note-author"><i class="pi pi-user"></i> {{ note.author }}</span>
                  <span class="note-time">{{ formatNoteTime(note.timestamp) }}</span>
                  <div class="note-actions">
                    <Button icon="pi pi-pencil" class="p-button-text p-button-sm p-button-rounded" @click="editNote(note)" v-tooltip="'Edit'" />
                    <Button icon="pi pi-trash" class="p-button-text p-button-sm p-button-rounded text-red-500" @click="confirmDeleteNote(note.id)" v-tooltip="'Delete'" />
                  </div>
                </div>
                <div v-if="editingNoteId === note.id" class="note-edit">
                  <Textarea v-model="editingNoteText" rows="2" class="w-full" />
                  <div class="note-edit-actions">
                    <Button label="Save" icon="pi pi-check" class="p-button-sm p-button-success" @click="saveNoteEdit()" />
                    <Button label="Cancel" icon="pi pi-times" class="p-button-sm p-button-text" @click="cancelNoteEdit()" />
                  </div>
                </div>
                <div v-else class="note-text">{{ note.text }}</div>
                <div v-if="note.editedAt" class="note-edited">edited</div>
              </div>
            </div>
          </div>
        </div>
        <template #footer>
          <Button label="Close" icon="pi pi-times" @click="showDetailsDialog = false" class="p-button-text" />
          <Button label="Copy All" icon="pi pi-copy" @click="copyAllDetails(selectedDevice)" class="p-button-secondary" />
        </template>
      </Dialog>

      <Dialog v-model:visible="showAddNoteDialog" modal header="Add Note" :style="{ width: '400px' }">
        <div><Textarea v-model="newNoteText" rows="3" class="w-full" placeholder="Enter note text..." /></div>
        <template #footer>
          <Button label="Cancel" icon="pi pi-times" class="p-button-text" @click="showAddNoteDialog = false" />
          <Button label="Add" icon="pi pi-check" class="p-button-success" @click="saveNewNote" :disabled="!newNoteText.trim()" />
        </template>
      </Dialog>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick, inject, onBeforeUnmount, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useDeviceActionsStore } from '@/stores/useDeviceActionsStore'
import { useModeStore } from '@/stores/useModeStore'
import { useConsoleStore } from '@/stores/useConsoleStore'
import { socket } from '@/socket'
import StatusIndicator from './StatusIndicator.vue'
import WanTypeDisplay from './WanTypeDisplay.vue'
import PrimeDeviceModal from './PrimeDeviceModal.vue'
import ProgressModal from './ProgressModal.vue'
import ChangeModeModal from './ChangeModeModal.vue'
import FirmwareVersion from '@/components/FirmwareVersion.vue'
import Textarea from 'primevue/textarea'
import InputText from 'primevue/inputtext'

// -----------ЗАМЕТКИ!!!------------
const deviceNotes = ref([])
const loadingNotes = ref(false)
const showAddNoteDialog = ref(false)
const newNoteText = ref('')
const editingNoteId = ref(null)
const editingNoteText = ref('')
const editingNoteOriginal = ref(null)

const loadNotes = (deviceId) => {
  loadingNotes.value = true
  socket.emit('notes:get', String(deviceId), (response) => {
    deviceNotes.value = response?.notes || []
    loadingNotes.value = false
  })
}

const showDeviceDetails = (d) => {
  selectedDevice.value = d
  showDetailsDialog.value = true
  loadNotes(d.id)
}

const addNote = () => { newNoteText.value = ''; showAddNoteDialog.value = true }

const saveNewNote = () => {
  if (!newNoteText.value.trim() || !selectedDevice.value) return
  socket.emit('notes:add', { deviceId: String(selectedDevice.value.id), note: { text: newNoteText.value.trim(), author: socket.id || 'User' } }, (response) => {
    if (response?.success) { deviceNotes.value.push(response.note); showAddNoteDialog.value = false; clearNotesCache(selectedDevice.value.id) }
  })
}

const editNote = (note) => { editingNoteId.value = note.id; editingNoteText.value = note.text; editingNoteOriginal.value = note }

const saveNoteEdit = () => {
  if (!editingNoteText.value.trim() || !selectedDevice.value) return
  socket.emit('notes:update', { deviceId: String(selectedDevice.value.id), noteId: editingNoteId.value, text: editingNoteText.value.trim() }, (response) => {
    if (response?.success) {
      const idx = deviceNotes.value.findIndex(n => n.id === editingNoteId.value)
      if (idx !== -1) deviceNotes.value[idx] = response.note
      cancelNoteEdit(); clearNotesCache(selectedDevice.value.id)
    }
  })
}

const cancelNoteEdit = () => { editingNoteId.value = null; editingNoteText.value = ''; editingNoteOriginal.value = null }

const confirmDeleteNote = (noteId) => {
  if (!selectedDevice.value) return
  socket.emit('notes:delete', { deviceId: String(selectedDevice.value.id), noteId }, (response) => {
    if (response?.success) { deviceNotes.value = deviceNotes.value.filter(n => n.id !== noteId); clearNotesCache(selectedDevice.value.id) }
  })
}

const formatNoteTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp); const now = new Date(); const diff = now - date
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
// ---------------------------------

const todayPassword = inject('todayPassword')
const toast = useToast()
const deviceStore = useDeviceStore()
const deviceActionsStore = useDeviceActionsStore()
const modeStore = useModeStore()
const consoleStore = useConsoleStore()

const props = defineProps({ wanTypes: { type: Array, default: () => [] } })

const globalFilter = ref('')
const selectedDevice = ref(null)
const deviceModal = ref(null)
const changeModeModal = ref(null)
const progressModal = ref(null)
const sortField = ref('statusCode')
const sortOrder = ref(-1)
const isMounted = ref(false)
const showResetConfirmDialog = ref(false)
const showDslResetConfirmDialog = ref(false)
const showPowerMenuDialog = ref(false)
const showPowerActionConfirmDialog = ref(false)
const showDetailsDialog = ref(false)
const selectedPowerAction = ref(null)
const powerActionDevice = ref(null)
const tableKey = ref(0)
const editingDeviceId = ref(null)
const editingName = ref('')
const nameInput = ref(null)
const currentDeviceWanType = computed(() => selectedDevice.value ? deviceStore.getDeviceWanType(selectedDevice.value.id) : null)

const requestPowerStatuses = async () => {
  const devices = deviceStore.availableDevices || deviceStore.devices || []
  for (const device of devices) {
    if (device.rebootPort && !deviceActionsStore.hasPowerStatus(device.id)) {
      try { await deviceActionsStore.requestPowerStatus(device.id) } catch (error) { console.error(`Failed to get power status for ${device.hwId}:`, error) }
    }
  }
}

const filteredDevices = computed(() => {
  if (!globalFilter.value) return deviceStore.availableDevices
  const filter = globalFilter.value.toLowerCase()
  return deviceStore.availableDevices.filter(d => d.hwId?.toLowerCase().includes(filter) || d.id?.toString().toLowerCase().includes(filter) || d.shortName?.toLowerCase().includes(filter) || d.type?.toLowerCase().includes(filter))
})

const sortedAndFilteredDevices = computed(() => {
  const devices = [...filteredDevices.value]
  if (!sortField.value) return devices.sort((a, b) => (Number(a.statusCode) === 200 ? -1 : 1) - (Number(b.statusCode) === 200 ? -1 : 1))
  return devices.sort((a, b) => {
    let aVal = getNestedValue(a, sortField.value), bVal = getNestedValue(b, sortField.value)
    if (sortField.value === 'statusCode') {
      const aOn = Number(aVal) === 200, bOn = Number(bVal) === 200
      if (aOn && !bOn) return -1 * sortOrder.value
      if (!aOn && bOn) return 1 * sortOrder.value
      return (a.shortName || '').localeCompare(b.shortName || '')
    }
    if (typeof aVal === 'string') { aVal = aVal.toLowerCase(); bVal = bVal.toLowerCase() }
    return sortOrder.value === -1 ? (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) : (bVal < aVal ? -1 : bVal > aVal ? 1 : 0)
  })
})

const handleOpenChangeMode = (device) => { selectedDevice.value = device; nextTick(() => { if (changeModeModal.value) changeModeModal.value.show(todayPassword.value, 'global') }) }
const clearSearch = () => { globalFilter.value = '' }
const getNestedValue = (obj, path) => path.split('.').reduce((c, k) => c?.[k] ?? null, obj)
const onSort = (e) => { sortField.value = e.sortField; sortOrder.value = e.sortOrder }

const deviceIcon = (type) => { const icons = { router: 'bi bi-router', AP: 'bi bi-wifi', switch: 'pi pi-sitemap' }; return icons[type] || 'pi pi-box' }
const getDeviceAvatarClass = (device) => { if (device.statusCode !== 200) return 'offline'; if (device.type === 'AP') return 'ap'; return 'online' }

const getDisplayMode = (deviceId) => {
  if (!isMounted.value) return 'Loading...'
  const info = modeStore.getDeviceModeInfo(deviceId)
  const modeMap = { 'router': 'Router', 'extender': 'Extender', 'extender_connect': 'Extender (Connected)', 'extender_disconnect': 'AP' }
  if (!info?.mode) return 'Unknown'
  return modeMap[info.mode] || info.mode
}

const shouldShowConnectionInfo = (deviceId) => { if (!isMounted.value) return false; const modeInfo = modeStore.getDeviceModeInfo(deviceId); return (modeInfo?.mode === 'extender_connect') && modeInfo?.routerId }

const getConnectedRouterInfo = (deviceId) => {
  if (!isMounted.value) return 'Loading...'
  const modeInfo = modeStore.getDeviceModeInfo(deviceId)
  if (modeInfo?.routerId) {
    const router = deviceStore.devices?.find(d => String(d.id) === String(modeInfo.routerId)) || deviceStore.allDevices?.find(d => String(d.id) === String(modeInfo.routerId))
    return router ? `${router.hwId} (${router.shortName})` : `Router ${modeInfo.routerId}`
  }
  return 'Not connected'
}

const isOffline = (d) => d.statusCode !== 200
const isAnyOperationOnThisDevice = (d) => deviceActionsStore.getDeviceOperation(d.id) !== null
const isInitializing = (d) => deviceActionsStore.getDeviceOperation(d.id) === 'initializing'
const isResetting = (d) => deviceActionsStore.getDeviceOperation(d.id) === 'resetting'
const isResettingDsl = (d) => deviceActionsStore.getDeviceOperation(d.id) === 'resettingDsl'

const getPowerStatusText = (id) => { const _ = deviceActionsStore.powerStatusVersion; if (!deviceActionsStore.hasPowerStatus(id)) return 'Loading...'; return deviceActionsStore.isPoweredOn(id) ? 'On' : 'Off' }
const getPowerStatusIcon = (id) => { const _ = deviceActionsStore.powerStatusVersion; if (!deviceActionsStore.hasPowerStatus(id)) return 'pi pi-spinner pi-spin'; return deviceActionsStore.isPoweredOn(id) ? 'pi pi-circle-fill power-on' : 'pi pi-circle-fill power-off' }
const getPowerStatusClass = (deviceId) => { const _ = deviceActionsStore.powerStatusVersion; if (!deviceActionsStore.hasPowerStatus(deviceId)) return 'text-secondary'; return deviceActionsStore.isPoweredOn(deviceId) ? 'text-green-600' : 'text-gray-500' }

const showPowerMenu = (d) => { powerActionDevice.value = d; showPowerMenuDialog.value = true }
const selectPowerAction = (a) => { selectedPowerAction.value = a; showPowerMenuDialog.value = false; setTimeout(() => showPowerActionConfirmDialog.value = true, 100) }
const confirmPowerAction = () => { if (!powerActionDevice.value || !selectedPowerAction.value) return; const d = powerActionDevice.value, a = selectedPowerAction.value; if (a === 'reboot') deviceActionsStore.rebootDevice(d); else deviceActionsStore.powerDevice(d, a); showPowerActionConfirmDialog.value = false; setTimeout(() => { powerActionDevice.value = null; selectedPowerAction.value = null }, 300) }
const cancelPowerAction = () => { showPowerActionConfirmDialog.value = false; powerActionDevice.value = null; selectedPowerAction.value = null }
const getPowerActionLabel = (a) => ({ reboot: 'Reboot Device', on: 'Power On', off: 'Power Off' }[a] || a)
const getPowerActionIcon = (a) => ({ reboot: 'pi pi-refresh', on: 'pi pi-power-off', off: 'pi pi-power-off' }[a] || 'pi pi-question')
const getPowerActionSeverity = (a) => ({ reboot: 'warning', on: 'success', off: 'danger' }[a] || 'secondary')

const refreshPowerStatus = async (deviceId) => {
  try {
    toast.add({ severity: 'info', summary: 'Refreshing...', detail: 'Checking power status, please wait...', life: 2000 })
    await deviceActionsStore.requestPowerStatus(deviceId)
    tableKey.value++
    toast.add({ severity: 'success', summary: 'Updated', detail: 'Power status refreshed', life: 2000 })
  } catch (error) {
    console.error(`Failed to refresh power status for ${deviceId}:`, error)
    toast.add({ severity: 'error', summary: 'Error', detail: error.message || 'Failed to refresh', life: 3000 })
  }
}

const handleConsoleClick = (d) => consoleStore.isConsoleOpen(d.id) ? consoleStore.focusConsole(d.id) : handleOpenConsole(d)
const handleInitialization = (d) => deviceActionsStore.initializationDevice(d, todayPassword.value)

const openVnc = (d) => { const params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`; window.open(d.vncUrl, d.hwId, params); toast.add({ severity: 'info', summary: 'VNC', detail: 'Password: password', life: 5000 }) }
const openDeviceInterface = (d) => { if (d.URL) { window.open(d.URL, '_blank'); toast.add({ severity: 'info', summary: 'Interface', detail: `Opening ${d.hwId}`, life: 2000 }) } }

const handleOpenModal = (device, modalType) => { selectedDevice.value = device; nextTick(() => deviceModal.value?.show(modalType, modalType === 'mwsConnection' ? todayPassword.value : undefined, 'global')) }

const handleOpenConsole = async (device) => {
  try {
    const response = await new Promise((resolve, reject) => { socket.emit('device:getConsoleUrl', device.id, r => r?.success ? resolve(r) : reject(new Error(r?.error || 'Failed'))); setTimeout(() => reject(new Error('Timeout')), 5000) })
    window.open(response.url, `console_${device.id}`, 'scrollbars=no,resizable=no,width=900,height=600')
  } catch (e) { toast.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }) }
}

const copyToClipboard = async (text, fieldName = 'Text') => {
  if (!text) return
  try { await navigator.clipboard.writeText(text); toast.add({ severity: 'success', summary: 'Copied!', detail: `${fieldName} copied to clipboard`, life: 2000 }) }
  catch (err) { const textArea = document.createElement('textarea'); textArea.value = text; document.body.appendChild(textArea); textArea.select(); document.execCommand('copy'); document.body.removeChild(textArea); toast.add({ severity: 'success', summary: 'Copied!', detail: `${fieldName} copied to clipboard`, life: 2000 }) }
}

const refreshDeviceMode = async (deviceId) => {
  try { const mode = await modeStore.getCurrentMode(deviceId, todayPassword.value); if (mode) { modeStore.currentMode[deviceId] = { mode, routerId: null, updatedAt: Date.now() } }; toast.add({ severity: 'success', summary: 'Mode Refreshed', detail: `Mode: ${mode}`, life: 3000 }) }
  catch (e) { toast.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }) }
}

const showResetConfirm = (d) => { selectedDevice.value = d; showResetConfirmDialog.value = true }
const confirmReset = () => { if (selectedDevice.value) deviceActionsStore.resetConfig(selectedDevice.value); showResetConfirmDialog.value = false }
const showDslResetConfirm = (d) => { selectedDevice.value = d; showDslResetConfirmDialog.value = true }
const confirmDslReset = () => { if (selectedDevice.value) deviceActionsStore.resetDslLine(selectedDevice.value); showDslResetConfirmDialog.value = false }

const canInitialize = (device) => !isOffline(device) && !isAnyOperationOnThisDevice(device)
const canMwsConnect = (device) => !isOffline(device)
const canChangeMode = (device) => !isOffline(device)
const canOpenVnc = (device) => !isOffline(device) && device.vncUrl
const canResetConfig = (device) => !isAnyOperationOnThisDevice(device)
const canResetDsl = (device) => device.dslPort
const canPowerManage = (device) => !isAnyOperationOnThisDevice(device) && device.rebootPort

const handleOperationStarted = (data) => { if (!data?.deviceId || !data?.operationType) return; const d = deviceStore.devices.find(x => x.id === data.deviceId); if (d && progressModal.value) progressModal.value.show(data.operationType, d, data.operationData || {}) }
const handleModeChanged = () => {}
const handleFirmwareUpdated = (data) => { if (data.deviceId && data.version) { const d = deviceStore.devices.find(x => x.id === data.deviceId); if (d) d.firmwareVersion = data.version } }

const handleModalSave = (data) => {
  if (!data?.callback) return
  const { value, type, action, callback } = data
  if (type === 'wanTypes') socket.emit('device:wanTypes:save', selectedDevice.value?.id, value, r => callback(r?.status === 'ok', r?.status === 'ok' ? 'WAN updated' : r?.message || 'Failed'))
  else if (type === 'mwsApConnection') socket.emit('device:mwsConnected', { deviceId: selectedDevice.value.id, routerId: value, action }, r => callback(r?.status === 'ok', r?.status === 'ok' ? `MWS ${action} done` : r?.error || 'Failed'))
}

const copyAllDetails = (device) => {
  const sections = ['=== BASIC INFORMATION ===', `Name: ${device.shortName}`, `HW ID: ${device.hwId}`, `Type: ${device.type}`, `Country: ${device.country || 'N/A'}`, '', '=== TECHNICAL INFORMATION ===', `MAC Address: ${device.macAddress || 'N/A'}`, `Servicetag: ${device.servicetag || 'N/A'}`, `Serial Number: ${device.serialNumber || 'N/A'}`, '', '=== NETWORK INFORMATION ===', `IP Address: ${device.ip || 'N/A'}`, `Check URL: ${device.checkUrl || 'N/A'}`, `VNC URL: ${device.vncUrl || 'N/A'}`, `SSH Container: ${device.sshContainer || 'N/A'}`, '', '=== PORTS & CONFIGURATION ===']
  const portFields = [{ label: 'Console Port', value: device.consolePort }, { label: 'Reset Port', value: device.resetPort }, { label: 'Reboot Port', value: device.rebootPort }, { label: 'VLAN Local', value: device.vlanLocal }, { label: 'Switch ID', value: device.switchID }, { label: 'WAN Port', value: device.switchPortWan }, { label: 'LAN Port', value: device.switchPortLan }, { label: 'Jerome ID', value: device.jeromeID }, { label: 'Console ID', value: device.consoleID }]
  portFields.forEach(field => { if (field.value) sections.push(`${field.label}: ${field.value}`) })
  copyToClipboard(sections.join('\n'), 'All Device Details')
}

// !!!!! Функиции на изменение ShortName !!!!
const startEditName = (device) => { editingDeviceId.value = device.id; editingName.value = device.shortName; nextTick(() => { if (nameInput.value) { nameInput.value.focus(); nameInput.value.select() } }) }
const cancelEditName = () => { editingDeviceId.value = null; editingName.value = '' }

const saveDeviceName = async (device) => {
  if (editingDeviceId.value !== device.id) return
  if (!editingName.value || !editingName.value.trim()) { cancelEditName(); return }
  const newName = editingName.value.trim()
  if (newName === device.shortName) { cancelEditName(); return }
  const deviceId = device.id; const oldName = device.shortName
  try {
    await deviceStore.updateDeviceShortName(deviceId, newName)
    toast.add({ severity: 'success', summary: 'Device Name Updated', detail: `Name changed from "${oldName}" to "${newName}"`, life: 3000 })
    tableKey.value++
  } catch (error) {
    console.error('Failed to update device name:', error)
    toast.add({ severity: 'error', summary: 'Error', detail: error.message || 'Failed to update device name', life: 5000 })
    editingName.value = oldName
  } finally { cancelEditName() }
}
// !!!!!! -------------- !!!!!!!!

watch(() => deviceStore.availableDevices?.length, (newLength, oldLength) => { if (newLength > (oldLength || 0) && isMounted.value) setTimeout(() => requestPowerStatuses(), 500) })
watch(() => deviceActionsStore.powerStatusVersion, (newVersion, oldVersion) => { if (newVersion !== oldVersion && isMounted.value) tableKey.value += 1 })

// ========== КЭШ ЗАМЕТОК ДЛЯ ТУЛТИПОВ ==========
const notesCache = reactive(new Map())
const notesLoaded = ref(new Set())

const getNotesForTooltip = (deviceId) => {
  const notes = notesCache.get(String(deviceId))
  if (!notes || notes.length === 0) return 'No notes'
  return notes.map(note => { const time = formatNoteTime(note.timestamp); return `${note.author} (${time}):\n${note.text}` }).join('\n───────────\n')
}

const loadNotesForTooltip = (deviceId) => {
  const id = String(deviceId)
  if (notesLoaded.value.has(id)) return
  notesLoaded.value.add(id)
  socket.emit('notes:get', id, (response) => { if (response?.notes) notesCache.set(id, response.notes) })
}

const clearNotesCache = (deviceId) => { const id = String(deviceId); notesCache.delete(id); notesLoaded.value.delete(id) }

const setupNotesListeners = () => { socket.on('notes:updated', (data) => { if (data?.deviceId) clearNotesCache(data.deviceId) }) }
const cleanupNotesListeners = () => { socket.off('notes:updated') }
// -------------------------

const handleClickOutside = (event) => {
  if (editingDeviceId.value && nameInput.value) {
    if (!nameInput.value.contains(event.target)) {
      const device = deviceStore.devices.find(d => d.id === editingDeviceId.value)
      if (device) saveDeviceName(device)
    }
  }
}

onMounted(() => {
  isMounted.value = true
  socket.on('device:firmwareUpdated', handleFirmwareUpdated)
  setupNotesListeners()
  document.addEventListener('click', handleClickOutside)
  setTimeout(() => requestPowerStatuses(), 1000)
})

onBeforeUnmount(() => {
  isMounted.value = false
  socket.off('device:firmwareUpdated', handleFirmwareUpdated)
  cleanupNotesListeners()
  document.removeEventListener('click', handleClickOutside)
})
</script>
<style scoped>

:deep(.pi-circle-fill.power-on) {
  background: linear-gradient(135deg, #10b981, #059669) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  background-clip: text !important;
  font-size: 0.75rem;
}

:deep(.pi-circle-fill.power-off) {
  color: #9ca3af !important;
  font-size: 0.75rem;
}

/* ========== HEADER & SEARCH STYLES ========== */
.devices-count {
  font-size: 0.9rem;
  color: var(--text-color-secondary);
  font-weight: 500;
  background: var(--surface-ground);
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  border: 1px solid var(--surface-200);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 0.25rem;
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

.booked-icon {
  color: var(--orange-500);
}

.common-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: var(--surface-card);
  border-bottom: 1px solid var(--surface-border);
  flex-wrap: wrap;
  gap: 0.75rem;
}

.common-section-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-color);
  display: flex;
  align-items: center;
}

.common-section-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

/* ========== SEARCH INPUT STYLES ========== */
.common-search-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.common-search-input-container {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.common-search-icon {
  position: absolute;
  left: 0.75rem;
  z-index: 1;
  color: var(--text-color-secondary);
}

.common-global-filter {
  padding-left: 2.5rem;
  padding-right: 2.5rem;
  width: 250px;
  border-radius: 20px;
  border: 1px solid var(--surface-300);
  background: var(--surface-ground);
  transition: all 0.3s ease;
}

.common-global-filter:focus {
  width: 300px;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  background: var(--surface-card);
}

.common-search-clear-btn {
  position: absolute;
  right: 0.25rem;
  z-index: 1;
  border: none;
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.common-search-clear-btn:hover {
  background: var(--surface-200);
  color: var(--text-color);
}

/* ========== LAYOUT STYLES ========== */
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

/* ========== DATATABLE STYLES ========== */
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

:deep(.firmware-column) {
  text-align: center !important;
  justify-content: center !important;
  align-items: center !important;
  min-width: 230px !important;
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

/* ========== POWER MENU STYLES ========== */
.power-option {
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.power-option:hover {
  background: var(--surface-hover) !important;
  border-color: var(--primary-300);
  transform: translateX(5px);
}

.power-option:active {
  transform: translateX(2px);
}

/* ========== DEVICE DETAILS DIALOG ========== */
.device-details-horizontal {
  max-height: 60vh;
  overflow-y: auto;
  padding: 0.5rem;
}

.detail-section {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1rem;
  border: 1px solid #e9ecef;
}

.detail-section h4 {
  margin: 0 0 1rem 0;
  color: #2c3e50;
  font-size: 1.1rem;
  font-weight: 600;
  border-bottom: 2px solid #3498db;
  padding-bottom: 0.5rem;
}

.horizontal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
}

.compact-grid {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-label {
  font-weight: 600;
  color: #495057;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.field-value-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: white;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #e9ecef;
  min-height: 2.5rem;
}

.field-value {
  flex: 1;
  font-family: 'Courier New', monospace;
  font-size: 0.9rem;
  color: #2c3e50;
  word-break: break-all;
}

.url-text {
  color: #0066cc;
  font-size: 0.85rem;
}

.copy-btn {
  color: #6c757d;
  padding: 0.25rem;
  min-width: auto;
  width: 2rem;
  height: 2rem;
}

.copy-btn:hover {
  color: #495057;
  background-color: #e9ecef;
}

/* ========== MEDIA QUERIES ========== */
@media (max-width: 768px) {
  .common-section-header {
    flex-direction: column;
    align-items: stretch;
    padding: 0.75rem 1rem;
  }
  
  .common-section-actions {
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .common-global-filter {
    width: 100%;
  }
  
  .common-global-filter:focus {
    width: 100%;
  }
  
  .horizontal-grid {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  
  .compact-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .common-section-header {
    padding: 0.5rem 0.75rem;
  }
  
  .common-section-title {
    font-size: 1.1rem;
    justify-content: center;
    width: 100%;
  }
  
  .compact-grid {
    grid-template-columns: 1fr;
  }
  
  .field-value-group {
    padding: 0.5rem;
  }
}

@media (max-width: 1200px) {
  .card {
    overflow-x: auto;
  }
}
.site-badge {
  display: inline-block;
  font-size: 0.6rem;
  font-weight: 600;
  color: #ffffff;
  background: #0ea5e9;
  border-radius: 10px;
  padding: 0.05rem 0.4rem;
  margin-left: 0.5rem;
  letter-spacing: 0.3px;
  white-space: nowrap;
  vertical-align: middle;
}

/* ========== NOTES STYLES ========== */
.notes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.notes-header h4 {
  margin: 0;
  color: #2c3e50;
  font-size: 1.1rem;
  font-weight: 600;
  border-bottom: 2px solid #3498db;
  padding-bottom: 0.5rem;
  flex: 1;
}

.notes-header .p-button {
  margin-left: 0.5rem;
}

.empty-notes {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  color: var(--text-color-secondary);
  font-size: 0.85rem;
}

.notes-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 200px;
  overflow-y: auto;
}

.note-item {
  background: white;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 0.75rem;
}

.note-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.75rem;
}

.note-author {
  color: var(--text-color);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.note-time {
  color: var(--text-color-secondary);
  flex: 1;
}

.note-actions {
  display: flex;
  gap: 0.125rem;
  opacity: 0;
  transition: opacity 0.2s;
}

.note-item:hover .note-actions {
  opacity: 1;
}

.note-text {
  font-size: 0.85rem;
  color: var(--text-color);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.note-edited {
  font-size: 0.65rem;
  color: var(--text-color-secondary);
  font-style: italic;
  margin-top: 0.25rem;
}

.note-edit {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.note-edit-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.text-red-500 {
  color: #ef4444 !important;
}


/* Стили для изменения: Start ShortName */
.editable-name {
  cursor: pointer;
  position: relative;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center; 
  gap: 4px;
  font-weight: 600;
  text-align: center;
  min-width: 50px; 
}

.editable-name:hover {
  background-color: var(--surface-hover);
  color: var(--primary-color);
}

.edit-name-icon {
  font-size: 0.7rem;
  opacity: 0;
  transition: opacity 0.2s ease;
  color: var(--primary-color);
}

.editable-name:hover .edit-name-icon {
  opacity: 1;
}

.edit-name-container {
  display: flex;
  align-items: center;
  justify-content: center;
}

.common-device-name .details-inline {
  margin-left: 0px;
  flex-shrink: 0;
}
.common-device-name {
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  text-align: center;
  min-height: 24px; 
}
.edit-name-input-native {
  width: 100%;
  max-width: 180px;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.5rem 0.75rem;
  text-align: center;
  border: 1px solid var(--surface-300);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.2s;
  background: var(--surface-card);
  color: var(--text-color);
}

.edit-name-input-native:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}
/* End ShortName */

/* Стили для тултипа с заметками */
:deep(.p-tooltip.notes-tooltip) {
  max-width: 350px !important;
  padding: 0.75rem !important;
  background: #1e293b !important;
  border: 1px solid #334155 !important;
  border-radius: 8px !important;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3) !important;
}

:deep(.p-tooltip.notes-tooltip .p-tooltip-text) {
  white-space: pre-line !important;
  font-size: 0.8rem !important;
  line-height: 1.5 !important;
  color: #e2e8f0 !important;
  max-height: 300px !important;
  overflow-y: auto !important;
}

:global(.p-tooltip.notes-tooltip .p-tooltip-arrow) {
  border-right-color: #1e293b !important;
}

/* Индикатор наличия заметок */
.notes-table :deep(.p-datatable-tbody > tr.has-notes) {
  position: relative;
}

.notes-table :deep(.p-datatable-tbody > tr.has-notes)::after {
  content: '📝';
  position: absolute;
  top: 4px;
  right: 8px;
  font-size: 0.7rem;
  opacity: 0.6;
}

</style>