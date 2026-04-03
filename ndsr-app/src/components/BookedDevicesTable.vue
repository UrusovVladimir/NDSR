<template>
    <div class="booked-devices-section" v-if="hasBookedDevices" :key="`booked-section-${deviceActionsStore.powerStatusVersion}`">
        <div class="common-section-header">
            <div class="header-left">
                <h3 class="common-section-title">
                    <i class="pi pi-bookmark mr-2"></i>
                    My Booked Devices
                    <Badge :value="deviceStore.bookedDevicesCount" class="ml-2" />
                </h3>
            </div>
            
            <div class="header-right">
                <span class="common-devices-count">
                    {{ deviceStore.bookedDevicesCount }} device{{ deviceStore.bookedDevicesCount !== 1 ? 's' : '' }}
                </span>
                
                <Button 
                    v-if="deviceStore.bookedDevicesCount > 1"
                    icon="pi pi-trash" 
                    label="Release All"
                    class="p-button-outlined p-button-danger p-button-sm release-all-btn"
                    @click="showReleaseAllConfirm"
                    v-tooltip.bottom="'Release all booked devices'"
                    :loading="releasingAllDevices"
                    :disabled="releasingAllDevices"
                />
                <Button 
                    icon="pi pi-refresh" 
                    label="FW Check All"
                    class="p-button-outlined p-button-sm"
                    @click="manualCheckAllFirmwares"
                    v-tooltip.bottom="'Check firmware for all devices'"
                    :loading="isCheckingAllFirmwares"
                />
                <Button 
                    icon="pi pi-eye-slash" 
                    class="p-button-text p-button-sm close-btn"
                    @click="collapseSection"
                    v-tooltip.bottom="'Hide my booked devices'"
                />
            </div>
        </div>
        
        <DataTable
            :key="`booked-table-${tableKey}-${deviceActionsStore.powerStatusVersion}`"
            :value="deviceStore.bookedDevices"
            :loading="loading"
            data-key="id"
            :paginator="deviceStore.bookedDevicesCount > 6"
            :rows="5"
            paginator-template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink"
            removable-sort
            responsive-layout="scroll"
            class="booked-devices-table"
        >
            <Column field="statusCode" header="Status" style="min-width: 85px">
                <template #body="{ data }">
                    <StatusIndicator :status="data.statusCode" :type="data.type" />
                </template>
            </Column>
            
            <Column field="hwId" header="Device" style="min-width: 200px">
                <template #body="{ data }">
                    <div class="common-device-info-container">
                        <div class="common-device-avatar" :class="getDeviceAvatarClass(data)">
                            <i :class="deviceIcon(data.type)" class="common-device-icon"></i>
                        </div>
                        <div class="common-device-info">
                            <div class="common-device-name">{{ data.shortName }}</div>
                            <div class="common-device-hwid">{{ data.hwId }}
                                <i class="pi pi-info-circle details-inline" 
                                @click="showDeviceDetails(data)"
                                v-tooltip="'View device details'"></i>
                            </div>
                            
                            <div class="common-device-hwid">
                                Current Mode: <b>{{ getDisplayMode(data.id) }}</b>
                                <i class="pi pi-refresh details-inline" 
                                @click="refreshDeviceMode(data.id)"
                                v-tooltip="'Refresh mode info'"></i>
                            </div>
                            
                            <div class="common-device-hwid">
                                Device Password: <b>{{ data.booking.accessPassword }}</b>
                                <i class="pi pi-copy details-inline" 
                                @click="copyToClipboard(data.booking.accessPassword)"
                                v-tooltip="'Copy access password'"></i>
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
            
            <Column header="WAN" style="min-width: 120px;">
                <template #body="{ data }">
                    <WanTypeDisplay 
                        :device="data" 
                        :wan-types="wanTypes"
                        :current-user-id="deviceStore.currentUserId"
                        @open-modal="handleOpenWanModal"
                    />
                </template>
            </Column>
            
            <Column header="Time Left" style="min-width: 150px;">
                <template #body="{ data }">
                    <div class="time-left-container">
                        <Chip 
                            v-if="isCurrentUserBooking(data)"
                            :label="formatTime(getRemainingTime(data))"
                            icon="pi pi-clock"
                            class="time-chip badge-style"
                            :class="getTimeSeverityClass(getRemainingTime(data))"
                        />
                        <div v-else class="text-color-secondary">
                            No time data
                        </div>
                        <Button 
                            icon="pi pi-plus-circle" 
                            class="p-button-sm p-button-outlined p-button-success p-button-rounded extend-btn"
                            @click="showExtendModal(data)"
                            v-tooltip.bottom="'Extend booking'"
                        />
                    </div>
                </template>
            </Column>
            
            <Column header="Actions" style="min-width: 350px">
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
                                @click="$emit('open-change-mode', data)"
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
                        
                        <div class="release-control">
                            <Button 
                                :icon="releasingDeviceId === data.id ? 'pi pi-spinner pi-spin' : 'pi pi-trash'"
                                class="p-button-outlined p-button-danger p-button-sm p-button-rounded release-btn"
                                @click="showReleaseConfirm(data)"
                                v-tooltip.bottom="releasingDeviceId === data.id ? 'Releasing...' : 'Release device'"
                                :disabled="!isCurrentUserBooking(data) || releasingDeviceId === data.id"
                            />
                        </div>
                    </div>    
                </template>
            </Column>
            
            <template #empty>
                <div class="empty-state">
                    <span class="empty-text">No booked devices</span>
                </div>
            </template>
        </DataTable>

        <!-- Диалог подтверждения освобождения устройства -->
        <Dialog 
            v-model:visible="showReleaseConfirmDialog" 
            modal 
            :blockScroll="false"
            header="Release Device"
            :style="{ width: '400px' }"
        >
            <div class="confirmation-content">
                <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #e74c3c;" />
                <span>Are you sure you want to release this device?</span>
            </div>
            <template #footer>
                <Button 
                    label="No" 
                    icon="pi pi-times" 
                    class="p-button-text" 
                    @click="showReleaseConfirmDialog = false"
                />
                <Button 
                    label="Yes" 
                    icon="pi pi-check" 
                    class="p-button-danger" 
                    @click="confirmRelease"
                />
            </template>
        </Dialog>

        <!-- Диалог продления бронирования -->
        <Dialog 
            v-model:visible="showExtendDialog" 
            modal 
            :blockScroll="false"
            header="Extend Booking"
            :style="{ width: '400px' }"
        >
            <div class="extend-content">
                <div class="current-time mb-3">
                    <strong>Current booking ends:</strong>
                    <div class="end-time">{{ formatEndTime(selectedDevice?.booking?.expiresAt) }}</div>
                </div>
                <div class="extend-options">
                    <h4 class="mb-2">Extend by:</h4>
                    <div class="option-buttons">
                        <Button 
                            v-for="option in extendOptions" 
                            :key="option.value"
                            :label="option.label" 
                            class="p-button-outlined mb-2"
                            @click="selectExtendDuration(option.value)"
                            :class="{ 'p-button-success': selectedDuration === option.value }"
                        />
                    </div>
                    <div class="custom-duration mt-3">
                        <label for="customDuration" class="block text-sm font-medium mb-2">
                            Or enter custom duration (1 day = 1440 minutes):
                        </label>
                        <InputNumber 
                            id="customDuration"
                            v-model="customDuration" 
                            :min="1" 
                            :max="10080"
                            placeholder="Enter minutes"
                            class="w-full"
                        />
                        <Button 
                            label="Apply Custom Duration" 
                            class="p-button-outlined p-button-secondary w-full mt-2"
                            @click="applyCustomDuration"
                            :disabled="!customDuration || customDuration < 1"
                        />
                    </div>
                </div>
            </div>
            <template #footer>
                <Button 
                    label="Cancel" 
                    icon="pi pi-times" 
                    class="p-button-text" 
                    @click="showExtendDialog = false"
                />
                <Button 
                    label="Extend Booking" 
                    icon="pi pi-plus" 
                    class="p-button-success" 
                    @click="confirmExtendBooking"
                    :disabled="!selectedDuration"
                    :loading="isExtending"
                />
            </template>
        </Dialog>

        <!-- Диалог подтверждения сброса конфигурации -->
        <Dialog 
            v-model:visible="showResetConfirmDialog" 
            modal 
            :blockScroll="false"
            header="Reset Configuration"
            :style="{ width: '450px' }"
        >
            <div class="confirmation-content">
                <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #e74c3c;" />
                <div>
                    <h4 class="mb-2">Reset device configuration?</h4>
                    <p class="text-color-secondary mb-0">
                        This will erase all settings and restore factory defaults for 
                        <strong>{{ selectedDevice?.hwId }}</strong>. This action cannot be undone.
                    </p>
                </div>
            </div>
            <template #footer>
                <Button 
                    label="Cancel" 
                    icon="pi pi-times" 
                    class="p-button-text" 
                    @click="showResetConfirmDialog = false"
                />
                <Button 
                    label="Reset Configuration" 
                    icon="pi pi-refresh" 
                    class="p-button-danger" 
                    @click="confirmReset"
                />
            </template>
        </Dialog>

        <!-- Диалог подтверждения перезагрузки -->
        <Dialog 
            v-model:visible="showRebootConfirmDialog" 
            modal 
            :blockScroll="false"
            header="Reboot Device"
            :style="{ width: '450px' }"
        >
            <div class="confirmation-content">
                <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #f39c12;" />
                <div>
                    <h4 class="mb-2">Reboot device?</h4>
                    <p class="text-color-secondary mb-0">
                        Device <strong>{{ selectedDevice?.hwId }}</strong> will be restarted. 
                        This may take 1-2 minutes. All connections will be temporarily interrupted.
                    </p>
                </div>
            </div>
            <template #footer>
                <Button 
                    label="Cancel" 
                    icon="pi pi-times" 
                    class="p-button-text" 
                    @click="showRebootConfirmDialog = false"
                />
                <Button 
                    label="Reboot Device" 
                    icon="pi pi-power-off" 
                    class="p-button-warning" 
                    @click="confirmReboot"
                />
            </template>
        </Dialog>

        <!-- Диалог подтверждения сброса DSL -->
        <Dialog 
            v-model:visible="showDslResetConfirmDialog" 
            modal 
            :blockScroll="false"
            header="Reset DSL Line"
            :style="{ width: '450px' }"
        >
            <div class="confirmation-content">
                <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #3498db;" />
                <div>
                    <h4 class="mb-2">Reset DSL line?</h4>
                    <p class="text-color-secondary mb-0">
                        DSL connection for <strong>{{ selectedDevice?.hwId }}</strong> will be reset. 
                        This may temporarily interrupt internet connectivity.
                    </p>
                </div>
            </div>
            <template #footer>
                <Button 
                    label="Cancel" 
                    icon="pi pi-times" 
                    class="p-button-text" 
                    @click="showDslResetConfirmDialog = false"
                />
                <Button 
                    label="Reset DSL Line" 
                    icon="pi pi-phone" 
                    class="p-button-secondary" 
                    @click="confirmDslReset"
                />
            </template>
        </Dialog>

        <!-- Диалог подтверждения освобождения всех устройств -->
        <Dialog 
            v-model:visible="showReleaseAllConfirmDialog" 
            modal 
            :blockScroll="false"
            header="Release All Devices"
            :style="{ width: '450px' }"
        >
            <div class="confirmation-content">
                <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem; color: #e74c3c;" />
                <div>
                    <h4 class="mb-2">Release all booked devices?</h4>
                    <p class="text-color-secondary mb-0">
                        This will release <strong>{{ deviceStore.bookedDevicesCount }} devices</strong>:
                    </p>
                    <ul class="device-list mt-2">
                        <li v-for="device in deviceStore.bookedDevices" :key="device.id" class="text-sm">
                            {{ device.hwId }} - {{ device.shortName }}
                        </li>
                    </ul>
                    <p class="text-color-secondary mt-2 mb-0">
                        This action cannot be undone.
                    </p>
                </div>
            </div>
            <template #footer>
                <Button 
                    label="Cancel" 
                    icon="pi pi-times" 
                    class="p-button-text" 
                    @click="showReleaseAllConfirmDialog = false"
                    :disabled="releasingAllDevices"
                />
                <Button 
                    label="Release All" 
                    icon="pi pi-trash" 
                    class="p-button-danger" 
                    @click="confirmReleaseAll"
                    :loading="releasingAllDevices"
                />
            </template>
        </Dialog>

        <!-- Диалог меню питания -->
        <Dialog 
            :blockScroll="false"
            v-model:visible="showPowerMenuDialog" 
            modal 
            header="Power Management"
            :style="{ width: '400px' }"
            :closable="true"
        >
            <div class="power-menu-content">
                <p class="mb-3">Select action for <strong>{{ powerActionDevice?.hwId }}</strong>:</p>
                
                <div class="power-options">
                    <div 
                        class="power-option p-3 border-round surface-ground mb-2"
                        @click="selectPowerAction('reboot')"
                    >
                        <div class="flex align-items-center">
                            <i class="pi pi-refresh text-warning mr-3" style="font-size: 1.5rem"></i>
                            <div>
                                <div class="font-bold">Reboot Device</div>
                                <small class="text-color-secondary">Restart the device (takes 1-2 minutes)</small>
                            </div>
                        </div>
                    </div>
                    
                    <div 
                        v-if="powerActionDevice && deviceActionsStore.isPoweredOff(powerActionDevice.id)"
                        class="power-option p-3 border-round surface-ground mb-2"
                        @click="selectPowerAction('on')"
                    >
                        <div class="flex align-items-center">
                            <i class="pi pi-power-off text-success mr-3" style="font-size: 1.5rem"></i>
                            <div>
                                <div class="font-bold">Power On</div>
                                <small class="text-color-secondary">Turn on the device</small>
                            </div>
                        </div>
                    </div>
                    
                    <div 
                        v-if="powerActionDevice && deviceActionsStore.isPoweredOn(powerActionDevice.id)"
                        class="power-option p-3 border-round surface-ground mb-2"
                        @click="selectPowerAction('off')"
                    >
                        <div class="flex align-items-center">
                            <i class="pi pi-power-off text-danger mr-3" style="font-size: 1.5rem"></i>
                            <div>
                                <div class="font-bold">Power Off</div>
                                <small class="text-color-secondary">Turn off the device</small>
                            </div>
                        </div>
                    </div>
                    
                    <div 
                        v-if="powerActionDevice && !deviceActionsStore.hasPowerStatus(powerActionDevice.id)"
                        class="power-option p-3 border-round surface-ground mb-2"
                    >
                        <div class="flex align-items-center">
                            <i class="pi pi-spinner pi-spin text-secondary mr-3" style="font-size: 1.5rem"></i>
                            <div>
                                <div class="font-bold">Loading Power Status...</div>
                                <small class="text-color-secondary">Please wait</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <template #footer>
                <Button 
                    label="Cancel" 
                    icon="pi pi-times" 
                    class="p-button-text" 
                    @click="showPowerMenuDialog = false"
                />
            </template>
        </Dialog>

        <!-- Диалог подтверждения действия питания -->
        <Dialog 
            :blockScroll="false"
            v-model:visible="showPowerActionConfirmDialog" 
            modal 
            :header="`Confirm ${getPowerActionLabel(selectedPowerAction)}`"
            :style="{ width: '450px' }"
        >
            <div class="confirmation-content">
                <i 
                    :class="getPowerActionIcon(selectedPowerAction)" 
                    class="mr-3" 
                    :style="{ 
                        fontSize: '2rem', 
                        color: selectedPowerAction === 'reboot' ? '#f39c12' : 
                               selectedPowerAction === 'on' ? '#28a745' : '#dc3545' 
                    }"
                ></i>
                <div>
                    <h4 class="mb-2">{{ getPowerActionLabel(selectedPowerAction) }}?</h4>
                    <p class="text-color-secondary mb-0">
                        <span v-if="selectedPowerAction === 'reboot'">
                            Device <strong>{{ powerActionDevice?.hwId }}</strong> will be restarted. 
                            This may take 1-2 minutes. All connections will be temporarily interrupted.
                        </span>
                        <span v-else-if="selectedPowerAction === 'on'">
                            Device <strong>{{ powerActionDevice?.hwId }}</strong> will be powered on.
                            This may take a few seconds.
                        </span>
                        <span v-else-if="selectedPowerAction === 'off'">
                            Device <strong>{{ powerActionDevice?.hwId }}</strong> will be powered off.
                            This will disconnect it completely.
                        </span>
                    </p>
                </div>
            </div>
            
            <template #footer>
                <Button 
                    label="Cancel" 
                    icon="pi pi-times" 
                    class="p-button-text" 
                    @click="cancelPowerAction"
                />
                <Button 
                    :label="getPowerActionLabel(selectedPowerAction)"
                    :icon="getPowerActionIcon(selectedPowerAction)"
                    :class="`p-button-${getPowerActionSeverity(selectedPowerAction)}`"
                    @click="confirmPowerAction"
                />
            </template>
        </Dialog>

        <!-- Диалог детальной информации об устройстве -->
        <Dialog 
            v-model:visible="showDetailsDialog" 
            header="Device Details" 
            :modal="true"
            :blockScroll="false"
            :style="{ width: '700px', maxWidth: '90vw' }"
            :contentStyle="{ maxHeight: '70vh' }"
        >
            <div v-if="selectedDevice" class="device-details-horizontal">
                <div class="detail-section">
                    <h4>Basic Information</h4>
                    <div class="horizontal-grid">
                        <div class="field-group">
                            <label class="field-label">Name</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.shortName }}</span>
                            </div>
                        </div>
                        <div class="field-group">
                            <label class="field-label">HW ID</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.hwId }}</span>
                            </div>
                        </div>
                        <div class="field-group">
                            <label class="field-label">Type</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.type }}</span>
                            </div>
                        </div>
                        <div class="field-group">
                            <label class="field-label">Country</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.country || 'N/A' }}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="detail-section">
                    <h4>Technical Information</h4>
                    <div class="horizontal-grid">
                        <div class="field-group">
                            <label class="field-label">MAC Address</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.macAddress || 'N/A' }}</span>
                                <Button 
                                    v-if="selectedDevice.macAddress"
                                    icon="pi pi-copy" 
                                    class="p-button-text p-button-sm copy-btn"
                                    @click="copyToClipboard(selectedDevice.macAddress, 'MAC Address')"
                                />
                            </div>
                        </div>
                        <div class="field-group">
                            <label class="field-label">Servicetag</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.servicetag || 'N/A' }}</span>
                                <Button 
                                    v-if="selectedDevice.servicetag"
                                    icon="pi pi-copy" 
                                    class="p-button-text p-button-sm copy-btn"
                                    @click="copyToClipboard(selectedDevice.servicetag, 'Servicetag')"
                                />
                            </div>
                        </div>
                        <div class="field-group">
                            <label class="field-label">Serial Number</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.serialNumber || 'N/A' }}</span>
                                <Button 
                                    v-if="selectedDevice.serialNumber"
                                    icon="pi pi-copy" 
                                    class="p-button-text p-button-sm copy-btn"
                                    @click="copyToClipboard(selectedDevice.serialNumber, 'Serial Number')"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="detail-section">
                    <h4>Network Information</h4>
                    <div class="horizontal-grid">
                        <div class="field-group">
                            <label class="field-label">IP Address Container</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.ip || 'N/A' }}</span>
                                <Button 
                                    v-if="selectedDevice.ip"
                                    icon="pi pi-copy" 
                                    class="p-button-text p-button-sm copy-btn"
                                    @click="copyToClipboard(selectedDevice.ip, 'IP Address')"
                                />
                            </div>
                        </div>
                        <div class="field-group">
                            <label class="field-label">Check URL</label>
                            <div class="field-value-group">
                                <span class="field-value url-text">{{ selectedDevice.checkUrl || 'N/A' }}</span>
                                <Button 
                                    v-if="selectedDevice.checkUrl"
                                    icon="pi pi-copy" 
                                    class="p-button-text p-button-sm copy-btn"
                                    @click="copyToClipboard(selectedDevice.checkUrl, 'Check URL')"
                                />
                            </div>
                        </div>
                        <div class="field-group">
                            <label class="field-label">VNC URL</label>
                            <div class="field-value-group">
                                <span class="field-value url-text">{{ selectedDevice.vncUrl || 'N/A' }}</span>
                                <Button 
                                    v-if="selectedDevice.vncUrl"
                                    icon="pi pi-copy" 
                                    class="p-button-text p-button-sm copy-btn"
                                    @click="copyToClipboard(selectedDevice.vncUrl, 'VNC URL')"
                                />
                            </div>
                        </div>
                        <div class="field-group">
                            <label class="field-label">SSH Container</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.sshContainer || 'N/A' }}</span>
                                <Button 
                                    v-if="selectedDevice.sshContainer"
                                    icon="pi pi-copy" 
                                    class="p-button-text p-button-sm copy-btn"
                                    @click="copyToClipboard(selectedDevice.sshContainer, 'SSH Container')"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="detail-section">
                    <h4>Ports & Configuration</h4>
                    <div class="horizontal-grid compact-grid">
                        <div class="field-group" v-if="selectedDevice.consolePort">
                            <label class="field-label">Console Port</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.consolePort }}</span>
                            </div>
                        </div>
                        <div class="field-group" v-if="selectedDevice.resetPort">
                            <label class="field-label">Reset Port</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.resetPort }}</span>
                            </div>
                        </div>
                        <div class="field-group" v-if="selectedDevice.rebootPort">
                            <label class="field-label">Reboot Port</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.rebootPort }}</span>
                            </div>
                        </div>
                        <div class="field-group" v-if="selectedDevice.vlanLocal">
                            <label class="field-label">VLAN Local</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.vlanLocal }}</span>
                            </div>
                        </div>
                        <div class="field-group" v-if="selectedDevice.switchID">
                            <label class="field-label">Switch ID</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.switchID }}</span>
                            </div>
                        </div>
                        <div class="field-group" v-if="selectedDevice.switchPortWan">
                            <label class="field-label">WAN Port</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.switchPortWan }}</span>
                            </div>
                        </div>
                        <div class="field-group" v-if="selectedDevice.switchPortLan">
                            <label class="field-label">LAN Port</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.switchPortLan }}</span>
                            </div>
                        </div>
                        <div class="field-group" v-if="selectedDevice.jeromeID">
                            <label class="field-label">Jerome ID</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.jeromeID }}</span>
                            </div>
                        </div>
                        <div class="field-group" v-if="selectedDevice.consoleID">
                            <label class="field-label">Console ID</label>
                            <div class="field-value-group">
                                <span class="field-value">{{ selectedDevice.consoleID }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <template #footer>
                <Button 
                    label="Close" 
                    icon="pi pi-times" 
                    @click="showDetailsDialog = false" 
                    class="p-button-text"
                />
                <Button 
                    label="Copy All" 
                    icon="pi pi-copy" 
                    @click="copyAllDetails(selectedDevice)" 
                    class="p-button-secondary"
                />
            </template>
        </Dialog>
    </div>
</template>
<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useDeviceStore } from '@/stores/useDeviceStore'
import { useDeviceActionsStore } from '@/stores/useDeviceActionsStore'
import { useModeStore } from '@/stores/useModeStore'
import { useFirmwareStore } from '@/stores/useFirmwareStore'
import { useConsoleStore } from '@/stores/useConsoleStore'
import StatusIndicator from './StatusIndicator.vue'
import FirmwareVersion from '@/components/FirmwareVersion.vue'
import WanTypeDisplay from './WanTypeDisplay.vue'


const isCheckingAllFirmwares = ref(false)
const modeStore = useModeStore()
const toast = useToast()
const deviceStore = useDeviceStore()
const deviceActionsStore = useDeviceActionsStore()
const todayPassword = inject('todayPassword')
const firmwareStore = useFirmwareStore()
const consoleStore = useConsoleStore()

const tableKey = ref(0)
const isMounted = ref(false)
const currentTime = ref(Math.floor(Date.now() / 1000))
const showResetConfirmDialog = ref(false)
const showRebootConfirmDialog = ref(false)
const showDslResetConfirmDialog = ref(false)
const showExtendDialog = ref(false)
const showReleaseConfirmDialog = ref(false)
const selectedDevice = ref(null)
const selectedDuration = ref(3600)
const customDuration = ref(null)
const isExtending = ref(false)
const releasingDeviceId = ref(null)
let unsubscribeModeUpdates = null
let timerInterval = null
const modeDisplayCache = ref(new Map())
const showReleaseAllConfirmDialog = ref(false)
const releasingAllDevices = ref(false)
const showDetailsDialog = ref(false)

const showPowerMenuDialog = ref(false)
const showPowerActionConfirmDialog = ref(false)
const selectedPowerAction = ref(null)
const powerActionDevice = ref(null)

const props = defineProps({
    loading: Boolean,
    wanTypes: Array
})

const emit = defineEmits([
    'open-modal',
    'open-change-mode'
])

const extendOptions = [
    { label: '30 minutes', value: 1800 },
    { label: '1 hour', value: 3600 },
    { label: '2 hours', value: 7200 },
    { label: '4 hours', value: 14400 },
    { label: '8 hours', value: 28800 },
    { label: '12 hours', value: 43200 }
]

// ✅ WATCH для отслеживания изменений версии статуса питания
watch(
    () => deviceActionsStore.powerStatusVersion,
    (newVersion, oldVersion) => {
        if (newVersion !== oldVersion && isMounted.value) {
            // console.log(`🔄 Power status version changed: ${oldVersion} -> ${newVersion}, refreshing UI...`)
            safeUpdateTable()
        }
    }
)

// ========== МЕТОДЫ ДЛЯ ПИТАНИЯ ==========
const showPowerMenu = (device) => {
    powerActionDevice.value = device
    showPowerMenuDialog.value = true
}

const selectPowerAction = (action) => {
    selectedPowerAction.value = action
    showPowerMenuDialog.value = false
    
    setTimeout(() => {
        showPowerActionConfirmDialog.value = true
    }, 100)
}
const manualCheckAllFirmwares = async () => {
    isCheckingAllFirmwares.value = true
    
    const onlineBookedDevices = deviceStore.bookedDevices.filter(d => d.statusCode === 200)
    if (onlineBookedDevices.length === 0) {
        toast.add({
            severity: 'info',
            summary: 'No Devices',
            detail: 'No online devices to check',
            life: 3000
        })
        isCheckingAllFirmwares.value = false
        return
    }
    
    try {
        const passwords = {}
        onlineBookedDevices.forEach(device => {
            let password = todayPassword.value
            if (device.booking?.isBooked && 
                device.booking?.bookedBy === deviceStore.currentUserId && 
                device.booking?.accessPassword) {
                password = device.booking.accessPassword
            }
            passwords[device.id] = password
        })
        
        const deviceIds = onlineBookedDevices.map(d => d.id)
        
        // ✅ Получаем response от checkMultipleFirmwares
        const response = await firmwareStore.checkMultipleFirmwares(deviceIds, passwords, true)
        
        // ✅ Проверяем, были ли неудачные проверки
        if (response && response.details && response.details.failed && response.details.failed.length > 0) {
            toast.add({
                severity: 'warn',
                summary: 'Some checks failed',
                detail: `${response.details.failed.length} device(s) could not be checked`,
                life: 5000
            })
        } else {
            toast.add({
                severity: 'success',
                summary: 'Firmware Check',
                detail: `Checked ${onlineBookedDevices.length} devices`,
                life: 4000
            })
        }
        
    } catch (error) {
        console.error('❌ Manual firmware check failed:', error)
        toast.add({
            severity: 'error', 
            summary: 'Firmware Check Failed',
            detail: error.message,
            life: 5000
        })
    } finally {
        isCheckingAllFirmwares.value = false
    }
}

const confirmPowerAction = () => {
    if (!powerActionDevice.value || !selectedPowerAction.value) return
    
    const device = powerActionDevice.value
    const action = selectedPowerAction.value
    
    switch (action) {
        case 'reboot':
            deviceActionsStore.rebootDevice(device)
            break
        case 'on':
            deviceActionsStore.powerDevice(device, 'on')
            break
        case 'off':
            deviceActionsStore.powerDevice(device, 'off')
            break
    }
    
    showPowerActionConfirmDialog.value = false
    setTimeout(() => {
        powerActionDevice.value = null
        selectedPowerAction.value = null
    }, 300)
}

const cancelPowerAction = () => {
    showPowerActionConfirmDialog.value = false
    powerActionDevice.value = null
    selectedPowerAction.value = null
}

const getPowerActionLabel = (action) => {
    const labels = {
        reboot: 'Reboot Device',
        on: 'Power On',
        off: 'Power Off'
    }
    return labels[action] || action
}

const getPowerActionIcon = (action) => {
    const icons = {
        reboot: 'pi pi-refresh',
        on: 'pi pi-power-off',
        off: 'pi pi-power-off'
    }
    return icons[action] || 'pi pi-question'
}

const getPowerActionSeverity = (action) => {
    const severities = {
        reboot: 'warning',
        on: 'success',
        off: 'danger'
    }
    return severities[action] || 'secondary'
}

// ✅ Обновленные методы получения статуса (будут пересчитываться при изменении powerStatusVersion)
const getPowerStatusText = (deviceId) => {
    // Добавляем зависимость от версии для реактивности
    const _ = deviceActionsStore.powerStatusVersion
    if (!deviceActionsStore.hasPowerStatus(deviceId)) return 'Loading...'
    return deviceActionsStore.isPoweredOn(deviceId) ? 'On' : 'Off'
}

const getPowerStatusIcon = (deviceId) => {
    const _ = deviceActionsStore.powerStatusVersion
    if (!deviceActionsStore.hasPowerStatus(deviceId)) return 'pi pi-spinner pi-spin'
    return deviceActionsStore.isPoweredOn(deviceId) ? 'pi pi-circle-fill power-on' : 'pi pi-circle-fill power-off'
}

const getPowerStatusClass = (deviceId) => {
    const _ = deviceActionsStore.powerStatusVersion
    if (!deviceActionsStore.hasPowerStatus(deviceId)) return 'text-secondary'
    return deviceActionsStore.isPoweredOn(deviceId) ? 'text-green-600' : 'text-gray-500'
}

const canPowerManage = (device) => {
    return isCurrentUserBooking(device) && 
           !isAnyOperationOnThisDevice(device) &&
           device.rebootPort
}

// ========== ОСТАЛЬНЫЕ МЕТОДЫ (без изменений) ==========
const handleConsoleClick = (device) => {
    if (consoleStore.isConsoleOpen(device.id)) {
        consoleStore.focusConsole(device.id)
    } else {
        consoleStore.handleOpenConsole(device)
    }
}

const hasBookedDevices = computed(() => {
    return !deviceStore.isBookedSectionCollapsed && deviceStore.bookedDevicesCount > 0
})

const isAnyOperationInProgress = computed(() => deviceActionsStore.isAnyOperationActive)

const isInitializing = (device) => deviceActionsStore.getDeviceOperation(device.id) === 'initializing'
const isResetting = (device) => deviceActionsStore.getDeviceOperation(device.id) === 'resetting'
const isRebooting = (device) => deviceActionsStore.getDeviceOperation(device.id) === 'rebooting'
const isResettingDsl = (device) => deviceActionsStore.getDeviceOperation(device.id) === 'resettingDsl'
const canRefreshMode = (device) => isCurrentUserBooking(device) && !isOffline(device) && device.booking?.accessPassword

const getConnectedRouterInfo = (deviceId) => {
    if (!isMounted.value) return 'Loading...'
    const modeInfo = modeStore.getDeviceModeInfo(deviceId)
    if (modeInfo && modeInfo.routerId) {
        const routerIdToFind = String(modeInfo.routerId)
        let router = deviceStore.devices?.find(d => String(d.id) === routerIdToFind) || 
                    deviceStore.allDevices?.find(d => String(d.id) === routerIdToFind)
        return router ? `${router.hwId} (${router.shortName})` : `Router ${routerIdToFind}`
    }
    return 'Not connected'
}

const getDisplayMode = (deviceId) => {
    if (!isMounted.value) return 'Loading...'
    const modeInfo = modeStore.getDeviceModeInfo(deviceId)
    const cacheKey = `${deviceId}_${modeInfo?.mode}_${modeInfo?.routerId}`
    const cached = modeDisplayCache.value.get(cacheKey)
    if (cached) return cached
    if (!modeInfo || !modeInfo.mode) {
        modeDisplayCache.value.set(cacheKey, 'Unknown')
        return 'Unknown'
    }
    const modeMap = {
        'router': 'Router',
        'extender': 'Extender', 
        'extender_connect': 'Extender (Connected)',
        'extender_disconnect': 'AP'
    }
    const result = modeMap[modeInfo.mode] || modeInfo.mode
    modeDisplayCache.value.set(cacheKey, result)
    return result
}

const shouldShowConnectionInfo = (deviceId) => {
    if (!isMounted.value) return false
    const modeInfo = modeStore.getDeviceModeInfo(deviceId)
    return (modeInfo?.mode === 'extender_connect') && modeInfo?.routerId
}

const getTimeSeverityClass = (seconds) => {
    if (seconds > 86400) return 'time-plenty'
    if (seconds > 3600) return 'time-warning'
    return 'time-critical'
}

const isCurrentUserBooking = (device) => {
    return device.booking?.isBooked && device.booking?.bookedBy === deviceStore.currentUserId
}

const getRemainingTime = (device) => {
    if (!device.booking?.expiresAt) return 0
    return Math.max(0, device.booking.expiresAt - currentTime.value)
}

const formatTime = (seconds) => {
    const d = Math.floor(seconds / 86400)
    const h = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0')
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
    const s = String(seconds % 60).padStart(2, '0')
    if (d > 0) {
        const dayText = d === 1 ? 'day' : 'days'
        return `${d} ${dayText} ${h}:${m}:${s}`
    }
    return `${h}:${m}:${s}`
}

const startTimer = () => {
    if (timerInterval) clearInterval(timerInterval)
    timerInterval = setInterval(() => {
        currentTime.value = Math.floor(Date.now() / 1000)
        deviceStore.bookedDevices.forEach(device => {
            if (isCurrentUserBooking(device) && getRemainingTime(device) <= 0) {
                releaseBooking(device.id)
            }
        })
    }, 1000)
}

const isOffline = (device) => device.statusCode !== 200

const canInitialize = (device) => isCurrentUserBooking(device) && !isOffline(device) && !isAnyOperationOnThisDevice(device)
const canOpenInterface = (device) => isCurrentUserBooking(device) && !isOffline(device) && device.URL
const canMwsConnect = (device) => isCurrentUserBooking(device)
const canChangeMode = (device) => isCurrentUserBooking(device) && !isOffline(device)
const canOpenVnc = (device) => isCurrentUserBooking(device) && !isOffline(device) && device.vncUrl
const canReboot = (device) => isCurrentUserBooking(device) && !isAnyOperationOnThisDevice(device)
const canResetConfig = (device) => isCurrentUserBooking(device) && !isAnyOperationOnThisDevice(device)
const canResetDsl = (device) => isCurrentUserBooking(device) && device.dslPort
const canOpenConsole = (device) => isCurrentUserBooking(device)

const extendBooking = async (deviceId, additionalDuration = 3600) => {
    isExtending.value = true
    try {
        await deviceStore.extendBooking(deviceId, additionalDuration)
        toast.add({
            severity: 'success',
            summary: 'Booking Extended',
            detail: `Booking extended by ${formatDuration(additionalDuration)}`,
            life: 3000
        })
        showExtendDialog.value = false
    } catch (error) {
        toast.add({
            severity: 'error',
            summary: 'Extension Failed',
            detail: error.message || 'Failed to extend booking',
            life: 4000
        })
    } finally {
        isExtending.value = false
    }
}

const releaseBooking = async (deviceId) => {
    releasingDeviceId.value = deviceId
    try {
        if (consoleStore.isConsoleOpen(deviceId)) {
            consoleStore.closeConsole(deviceId)
        }
        await deviceStore.releaseDevice(deviceId)
        toast.add({
            severity: 'success',
            summary: 'Device Released',
            detail: 'Device has been released',
            life: 3000
        })
        showReleaseConfirmDialog.value = false
        modeStore.removeDeviceMode(deviceId)
    } catch (error) {
        toast.add({
            severity: 'error',
            summary: 'Release Failed',
            detail: error.message || 'Failed to release device',
            life: 4000
        })
    } finally {
        releasingDeviceId.value = null
    }
}

const releaseAllBookedDevices = async () => {
    releasingAllDevices.value = true
    try {
        const devicesToRelease = deviceStore.bookedDevices
        const deviceIds = devicesToRelease.map(device => device.id)
        deviceIds.forEach(deviceId => {
            if (consoleStore.isConsoleOpen(deviceId)) {
                consoleStore.closeConsole(deviceId)
            }
        })
        const result = await deviceStore.releaseMultipleDevices(deviceIds)
        deviceIds.forEach(deviceId => {
            modeStore.removeDeviceMode(deviceId)
        })
        safeUpdateTable()
        if (result.failed && result.failed > 0) {
            toast.add({
                severity: 'warn',
                summary: 'Partial Release',
                detail: `Released ${result.released} devices, ${result.failed} failed`,
                life: 6000
            })
        } else {
            toast.add({
                severity: 'success',
                summary: 'Devices Released',
                detail: `Successfully released ${result.released} device${result.released !== 1 ? 's' : ''}`,
                life: 5000
            })
        }
    } catch (error) {
        console.error('❌ Batch release failed:', error)
        toast.add({
            severity: 'error',
            summary: 'Release Failed',
            detail: error.message || 'Failed to release devices',
            life: 5000
        })
    } finally {
        releasingAllDevices.value = false
        showReleaseAllConfirmDialog.value = false
    }
}

const showReleaseAllConfirm = () => {
    showReleaseAllConfirmDialog.value = true
}

const confirmReleaseAll = () => {
    releaseAllBookedDevices()
}

const showReleaseConfirm = (device) => {
    selectedDevice.value = device
    showReleaseConfirmDialog.value = true
}

const confirmRelease = () => {
    if (selectedDevice.value) releaseBooking(selectedDevice.value.id)
}

const showExtendModal = (device) => {
    selectedDevice.value = device
    selectedDuration.value = 3600
    customDuration.value = null
    showExtendDialog.value = true
}

const selectExtendDuration = (duration) => {
    selectedDuration.value = duration
    customDuration.value = null
}

const applyCustomDuration = () => {
    if (customDuration.value && customDuration.value > 0) {
        selectedDuration.value = customDuration.value * 60
    }
}

const confirmExtendBooking = () => {
    if (selectedDevice.value && selectedDuration.value) {
        extendBooking(selectedDevice.value.id, selectedDuration.value)
    }
}

const showResetConfirm = (device) => {
    selectedDevice.value = device
    showResetConfirmDialog.value = true
}

const showRebootConfirm = (device) => {
    selectedDevice.value = device
    showRebootConfirmDialog.value = true
}

const showDslResetConfirm = (device) => {
    selectedDevice.value = device
    showDslResetConfirmDialog.value = true
}

const confirmReset = () => {
    if (selectedDevice.value) {
        deviceActionsStore.resetConfig(selectedDevice.value)
    }
    showResetConfirmDialog.value = false
    selectedDevice.value = null
}

const confirmReboot = () => {
    if (selectedDevice.value) {
        deviceActionsStore.rebootDevice(selectedDevice.value)
    }
    showRebootConfirmDialog.value = false
    selectedDevice.value = null
}

const confirmDslReset = () => {
    if (selectedDevice.value) {
        deviceActionsStore.resetDslLine(selectedDevice.value)
    }
    showDslResetConfirmDialog.value = false
    selectedDevice.value = null
}

const isAnyOperationOnThisDevice = (device) => {
    return deviceActionsStore.getDeviceOperation(device.id) !== null
}

const refreshingModes = ref(new Set())

const refreshDeviceMode = async (deviceId) => {
    try {
        const device = deviceStore.devices.find(d => d.id === deviceId)
        if (!device || !device.booking?.accessPassword) {
            toast.add({
                severity: 'warn',
                summary: 'Cannot Refresh Mode',
                detail: 'No password available for this device',
                life: 3000
            })
            return null
        }
        
        refreshingModes.value.add(deviceId)
        
        const mode = await modeStore.getCurrentMode(deviceId, device.booking.accessPassword)
        
        if (mode) {
            modeStore.currentMode[deviceId] = {
                mode: mode,
                routerId: null,
                updatedAt: Date.now()
            }
            
            if (modeStore.saveToLocalStorage) {
                modeStore.saveToLocalStorage()
            }
        }
        
        modeDisplayCache.value.forEach((value, key) => {
            if (key.startsWith(`${deviceId}_`)) {
                modeDisplayCache.value.delete(key)
            }
        })
        
        await nextTick()
        safeUpdateTable()
        
        toast.add({
            severity: 'success',
            summary: 'Mode Refreshed',
            detail: `Device mode: ${mode}`,
            life: 3000
        })
        
        return mode
    } catch (error) {
        toast.add({
            severity: 'error',
            summary: 'Refresh Failed',
            detail: error.message,
            life: 4000
        })
        return null
    } finally {
        refreshingModes.value.delete(deviceId)
    }
}

const isRefreshingMode = (deviceId) => refreshingModes.value.has(deviceId)

const openVnc = (device) => {
    const params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`
    window.open(device.vncUrl, device.hwId, params)
    const debianPassword = 'password'
    toast.add({
        severity: 'info',
        summary: 'VNC Connection',
        detail: `VNC connection established. Password: ${debianPassword}`,
        life: 5000
    })
    if (navigator.clipboard) {
        navigator.clipboard.writeText(debianPassword)
    }
}

const openDeviceInterface = (device) => {
    if (device.URL) {
        window.open(device.URL, '_blank')
        toast.add({
            severity: 'info',
            summary: 'Device Interface',
            detail: `Opening ${device.hwId} interface`,
            life: 2000
        })
    }
}

const handleInitialization = (device) => {
    deviceActionsStore.initializationDevice(device, todayPassword.value)
}

const handleOpenWanModal = (device) => {
    emit('open-modal', device, 'wanTypes')
}

const handleFirmwareUpdated = (data) => {
    const device = deviceStore.bookedDevices.find(d => d.id === data.deviceId)
    if (device) {
        device.firmwareVersion = data.version
    }
}

const collapseSection = () => {
    deviceStore.collapseBookedSection()
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

const formatEndTime = (expiresAt) => {
    if (!expiresAt) return 'Unknown'
    return new Date(expiresAt * 1000).toLocaleString()
}

const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
    else if (hours > 0) return `${hours}h`
    else return `${minutes}m`
}

const checkAllFirmwares = async () => {
    const onlineBookedDevices = deviceStore.bookedDevices.filter(d => d.statusCode === 200)
    if (onlineBookedDevices.length === 0) return
    
    try {
        const passwords = {}
        onlineBookedDevices.forEach(device => {
            let password = todayPassword.value
            if (device.booking?.isBooked && 
                device.booking?.bookedBy === deviceStore.currentUserId && 
                device.booking?.accessPassword) {
                password = device.booking.accessPassword
            }
            passwords[device.id] = password
        })
        
        const deviceIds = onlineBookedDevices.map(d => d.id)
        
        // ✅ Передаем false - это автоматическая проверка
        await firmwareStore.checkMultipleFirmwares(deviceIds, passwords, false)
        
    } catch (error) {
        console.error('❌ Batch firmware check failed:', error)
    }
}
let updateTimeout = null
let lastTableUpdate = 0

const safeUpdateTable = () => {
    if (!isMounted.value) return
    
    if (updateTimeout) clearTimeout(updateTimeout)
    updateTimeout = setTimeout(() => {
        tableKey.value += 1
    }, 30)
}

let isProcessingChanges = false

const copyAllDetails = (device) => {
    const sections = [
        '=== BASIC INFORMATION ===',
        `Name: ${device.shortName}`,
        `HW ID: ${device.hwId}`,
        `Type: ${device.type}`,
        `Country: ${device.country || 'N/A'}`,
        '',
        '=== TECHNICAL INFORMATION ===',
        `MAC Address: ${device.macAddress || 'N/A'}`,
        `Servicetag: ${device.servicetag || 'N/A'}`,
        `Serial Number: ${device.serialNumber || 'N/A'}`,
        '',
        '=== NETWORK INFORMATION ===',
        `IP Address: ${device.ip || 'N/A'}`,
        `Check URL: ${device.checkUrl || 'N/A'}`,
        `VNC URL: ${device.vncUrl || 'N/A'}`,
        `SSH Container: ${device.sshContainer || 'N/A'}`,
        '',
        '=== PORTS & CONFIGURATION ==='
    ]

    const portFields = [
        { label: 'Console Port', value: device.consolePort },
        { label: 'Reset Port', value: device.resetPort },
        { label: 'Reboot Port', value: device.rebootPort },
        { label: 'VLAN Local', value: device.vlanLocal },
        { label: 'Switch ID', value: device.switchID },
        { label: 'WAN Port', value: device.switchPortWan },
        { label: 'LAN Port', value: device.switchPortLan },
        { label: 'Jerome ID', value: device.jeromeID },
        { label: 'Console ID', value: device.consoleID }
    ]

    portFields.forEach(field => {
        if (field.value) {
            sections.push(`${field.label}: ${field.value}`)
        }
    })

    const details = sections.join('\n')
    copyToClipboard(details, 'All Device Details')
}

watch(
    () => deviceActionsStore.operationChanges,
    (newChanges, oldChanges) => {
        if (isProcessingChanges) return
        const hasRealChanges = newChanges.started.length > 0 || newChanges.finished.length > 0
        if (hasRealChanges) {
            isProcessingChanges = true
            nextTick(() => {
                deviceActionsStore.processOperationChanges()
                isProcessingChanges = false
            })
        }
    },
    { deep: true, flush: 'post' }
)

const showDeviceDetails = (device) => {
    selectedDevice.value = device
    showDetailsDialog.value = true
}

const copyToClipboard = async (text, fieldName = 'Text') => {
    if (!text) return
    
    try {
        await navigator.clipboard.writeText(text)
        toast.add({
            severity: 'success',
            summary: 'Copied!',
            detail: `${fieldName} copied to clipboard`,
            life: 2000
        })
    } catch (err) {
        const textArea = document.createElement('textarea')
        textArea.value = text
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
        
        toast.add({
            severity: 'success',
            summary: 'Copied!',
            detail: `${fieldName} copied to clipboard`,
            life: 2000
        })
    }
}

watch(
    () => modeStore.currentMode,
    (newModes) => {
        if (!isMounted.value) return
        
        const deviceCount = Object.keys(newModes).length
        if (deviceCount === 0) return
        
        modeDisplayCache.value.clear()
        
        if (updateTimeout) clearTimeout(updateTimeout)
        updateTimeout = setTimeout(() => {
            if (isMounted.value) {
                tableKey.value += 1
            }
        }, 50)
    },
    { deep: true, flush: 'post' }
)

watch(() => deviceStore.bookedDevices, () => {
    if (isMounted.value) safeUpdateTable()
}, { deep: true })

// onMounted(() => {
//     startTimer()
//     isMounted.value = true
//     consoleStore.restoreConsoleState()
//     unsubscribeModeUpdates = modeStore.listenForModeUpdates((data) => {
//         if (isMounted.value) {
//             setTimeout(() => {
//                 if (isMounted.value) safeUpdateTable()
//             }, 0)
//         }
//     })
// })


onMounted(() => {
    startTimer()
    isMounted.value = true
    consoleStore.restoreConsoleState()
    unsubscribeModeUpdates = modeStore.listenForModeUpdates((data) => {
        if (isMounted.value) {
            setTimeout(() => {
                if (isMounted.value) safeUpdateTable()
            }, 0)
        }
    })
    
    // ✅ BATCH FIRMWARE CHECK при загрузке
    if (deviceStore.bookedDevices.length > 0) {
        setTimeout(() => {
            checkAllFirmwares()
        }, 2000) // Задержка 2 секунды после монтирования
    }
})

// ✅ Следим за добавлением новых устройств
watch(() => deviceStore.bookedDevices.length, (newLength, oldLength) => {
    if (newLength > oldLength && newLength > 0 && isMounted.value) {
        setTimeout(() => {
            checkAllFirmwares()
        }, 3000)
    }
})

// ✅ Следим за статусом устройств (онлайн/оффлайн)
watch(
    () => deviceStore.bookedDevices.map(d => ({ id: d.id, status: d.statusCode })),
    (newStatuses, oldStatuses) => {
        if (!isMounted.value || !oldStatuses) return
        
        const becameOnline = []
        for (let i = 0; i < newStatuses.length; i++) {
            const oldStatus = oldStatuses.find(s => s.id === newStatuses[i].id)
            if (oldStatus && oldStatus.status !== 200 && newStatuses[i].status === 200) {
                becameOnline.push(newStatuses[i].id)
            }
        }
        
        if (becameOnline.length > 0) {
            console.log(`🔄 Devices became online: ${becameOnline.join(', ')}, checking firmware...`)
            setTimeout(() => {
                checkAllFirmwares()
            }, 5000)
        }
    },
    { deep: true }
)


onUnmounted(() => {
    if (timerInterval) {
        clearInterval(timerInterval)
        timerInterval = null
    }
    if (updateTimeout) {
        clearTimeout(updateTimeout)
        updateTimeout = null
    }
    if (unsubscribeModeUpdates) {
        unsubscribeModeUpdates()
        unsubscribeModeUpdates = null
    }
    isMounted.value = false
})
</script>

<style scoped>
.common-section-header {
    display: grid;
    grid-template-columns: 1fr auto; 
    align-items: center;
    padding: 1rem 1.5rem;
    background: var(--surface-card);
    border-bottom: 1px solid var(--surface-border);
    gap: 1rem;
}

.header-left {
    display: flex;
    align-items: center;
    min-width: 0; 
}

.header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
    justify-content: flex-end;
    flex-wrap: wrap;
}

@media (max-width: 768px) {
    .common-section-header {
        grid-template-columns: 1fr auto; 
        gap: 0.75rem;
        padding: 0.75rem 1rem;
    }
}

@media (max-width: 480px) {
    .common-section-header {
        grid-template-columns: 1fr;
        gap: 0.5rem;
        justify-items: center;
        text-align: center;
    }
    
    .header-right {
        justify-content: center;
        width: 100%;
    }
}

.common-section-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: space-between;
}

.booked-devices-section {
    background: var(--surface-card);
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    margin-bottom: 1rem;
    border: 1px solid var(--surface-border);
    overflow: hidden;
}

.booked-devices-section:hover {
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
}

.time-left-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.time-chip {
    font-size: 0.75rem;
    min-width: 135px;
    height: 2.1rem;
    justify-content: center;
}

.time-chip.badge-style {
    border: none !important;
    font-weight: 600 !important;
    font-size: 0.75rem !important;
    padding: 0.35rem 0.75rem !important;
    border-radius: 20px !important;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
}

.time-chip.badge-style.time-plenty {
    background: linear-gradient(135deg, #10b981, #059669) !important;
    color: white !important;
}

.time-chip.badge-style.time-warning {
    background: linear-gradient(135deg, #f59e0b, #d97706) !important;
    color: white !important;
}

.time-chip.badge-style.time-critical {
    background: linear-gradient(135deg, #ef4444, #dc2626) !important;
    color: white !important;
}

.time-chip.badge-style :deep(.pi-clock) {
    color: inherit !important;
    margin-right: 0.4rem !important;
}

.confirmation-content {
    display: flex;
    align-items: center;
    padding: 1rem;
}

.confirmation-content i {
    margin-right: 1rem;
}

.extend-content {
    padding: 0.5rem 0;
}

.current-time {
    padding: 1rem;
    background: var(--surface-50);
    border-radius: 6px;
    border-left: 4px solid var(--primary-color);
}

.end-time {
    font-size: 1.1rem;
    color: var(--primary-color);
    font-weight: 600;
    margin-top: 0.25rem;
}

.extend-options {
    margin-top: 1rem;
}

.option-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.custom-duration {
    padding-top: 1rem;
    border-top: 1px solid var(--surface-200);
}

.empty-state {
    display: flex;
    justify-content: center;
    padding: 2rem;
}

.empty-text {
    color: var(--text-color-secondary);
}

.actions-container {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
}

.device-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    flex: 1;
}

.release-control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
}

.device-list {
    max-height: 150px;
    overflow-y: auto;
    background: var(--surface-50);
    border-radius: 4px;
    padding: 0.5rem;
    border: 1px solid var(--surface-200);
}

.device-list li {
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid var(--surface-100);
}

.device-list li:last-child {
    border-bottom: none;
}

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

.power-menu {
    transition: all 0.2s ease;
}

.power-menu:hover {
    transform: scale(1.05);
    background-color: var(--warning-50) !important;
}

.text-green-600 {
    color: #10b981;
}

.text-gray-500 {
    color: #6b7280;
}

@media (max-width: 768px) {
    .section-header {
        padding: 0.75rem 1rem;
        flex-direction: column;
        align-items: stretch;
        gap: 0.75rem;
    }
    .section-title {
        font-size: 1.1rem;
        justify-content: space-between;
        width: 100%;
    }
    .section-actions {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        width: 100%;
    }
    .devices-count {
        order: -1;
        align-self: flex-start;
        margin-bottom: 0.5rem;
    }
    .actions-container {
        flex-direction: column;
        gap: 0.5rem;
    }
    .release-control {
        justify-content: center;
        width: 100%;
    }
    .device-controls {
        justify-content: center;
        gap: 0.5rem;
    }
    .time-left-container {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.25rem;
    }
    .time-chip {
        min-width: 80px;
        font-size: 0.7rem;
    }
}

@media (max-width: 480px) {
    .section-header {
        padding: 0.5rem 0.75rem;
    }
    .section-title {
        font-size: 1rem;
    }
    .confirmation-content {
        flex-direction: column;
        text-align: center;
    }
    .confirmation-content i {
        margin-bottom: 1rem;
        margin-right: 0;
    }
    .option-buttons {
        grid-template-columns: 1fr;
    }
    .section-actions {
        gap: 0.25rem;
    }
}

:deep(.firmware-column) {
    text-align: center !important;
    justify-content: center !important;
    align-items: center !important;
    min-width: 230px !important;
}

:deep(.booked-devices-table .p-column-header-content) {
    justify-content: center !important;
    text-align: center !important;
    width: 100% !important;
}

:deep(.time-left-container) {
    justify-content: center !important;
    text-align: center !important;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

:deep(.actions-container) {
    justify-content: left !important;
    text-align: left !important;
    display: flex;
    align-items: left;
    gap: 1rem;
}

:deep(.device-controls) {
    display: flex;
    justify-content: center !important;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
}

:deep(.time-chip) {
    display: inline-flex;
    justify-content: center;
    align-items: center;
}

:deep(.console-open) {
    background-color: var(--primary-color) !important;
    color: white !important;
    border-color: var(--primary-color) !important;
}

:deep(.extend-btn.p-button) {
    border-radius: 50% !important;
    width: 2.5rem !important;
    height: 2.5rem !important;
    transition: all 0.3s ease !important;
    border: 2px solid var(--green-300) !important;
    color: var(--green-600) !important;
    background: transparent !important;
}

:deep(.extend-btn.p-button:hover) {
    background: var(--green-50) !important;
    border-color: var(--green-500) !important;
    color: var(--green-700) !important;
    transform: translateY(-2px) !important;
    box-shadow: 0 4px 8px rgba(34, 197, 94, 0.2) !important;
}

:deep(.extend-btn.p-button:active) {
    transform: translateY(0) !important;
}

:deep(.extend-btn.p-button:disabled) {
    opacity: 0.6 !important;
}

:deep(.p-button-loading) {
    opacity: 0.7;
    cursor: not-allowed;
}

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

@media (max-width: 768px) {
    :deep(.p-tooltip) {
        font-size: 0.75rem;
        max-width: 200px;
    }
    :deep(.extend-btn.p-button) {
        width: 2.25rem !important;
        height: 2.25rem !important;
        border-width: 1.5px !important;
        border-radius: 50% !important;
    }
}

@media (max-width: 480px) {
    :deep(.extend-btn.p-button) {
        width: 2.25rem !important;
        height: 2.25rem !important;
        border-width: 1px !important;
        border-radius: 50% !important;
    }
}

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

@media (max-width: 768px) {
    .horizontal-grid {
        grid-template-columns: 1fr;
        gap: 0.75rem;
    }
    
    .compact-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (max-width: 480px) {
    .compact-grid {
        grid-template-columns: 1fr;
    }
    
    .field-value-group {
        padding: 0.5rem;
    }
}
</style>