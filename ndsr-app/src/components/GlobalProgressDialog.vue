<template>
    <Dialog 
        v-model:visible="visible" 
        :modal="true"
        :closable="false"
        :dismissableMask="false"
        :breakpoints="breakpoints"
        header="Operation in Progress"
        :style="{ width: '450px' }"
    >
        <!-- Кнопка закрытия в правом верхнем углу -->
        <template #header>
            <div class="flex align-items-center justify-content-between w-full">
                <span class="text-lg font-semibold">Operation in Progress</span>
                <Button 
                    v-if="showCloseButton"
                    icon="pi pi-times" 
                    class="p-button-text p-button-sm close-header-btn"
                    @click="handleClose"
                    :disabled="!canClose"
                />
            </div>
        </template>

        <div class="operation-content">
            <div class="flex align-items-center gap-3 mb-3">
                <ProgressSpinner style="width: 32px; height: 32px" />
                <div class="operation-text">
                    <h4 class="mb-1">{{ operationText }} {{ currentDeviceHwId }}</h4>
                    <p class="text-color-secondary mb-0">Please wait, this may take up to 2-3 minutes...</p>
                </div>
            </div>
            <ProgressBar 
                :value="progress" 
                class="custom-progressbar" 
            />
            
            <!-- Индикатор возможности закрытия -->
            <div v-if="showCloseHint" class="close-hint mt-2 p-2 text-center" style="background: #e8f5e8; border-radius: 4px; font-size: 0.8rem;">
                <i class="pi pi-info-circle mr-1"></i>
                You can now safely close this dialog - operation will continue in background
            </div>

            <!-- Отладочная информация -->
            <div v-if="showDebug" class="debug-info mt-2 p-2" style="background: #f8f9fa; border-radius: 4px; font-size: 0.8rem;">
                <div><strong>Current:</strong> {{ debugInfo.activeDevice }} - {{ debugInfo.operation }} ({{ debugInfo.progress }})</div>
                <div><strong>Operations:</strong> {{ debugInfo.activeOperations }}</div>
                <div><strong>Last ID:</strong> {{ debugInfo.lastOperationId }}</div>
                <div><strong>All Operations:</strong></div>
                <div v-for="op in debugInfo.allOperations" :key="op.id" class="ml-2">
                    • {{ op.id }}: {{ op.type }} ({{ op.progress }}%) - {{ op.startedAt }}
                </div>
            </div>
        </div>
    </Dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useDeviceActionsStore } from '@/stores/useDeviceActionsStore'
import { useDeviceStore } from '@/stores/useDeviceStore'
import Dialog from 'primevue/dialog'
import ProgressSpinner from 'primevue/progressspinner'
import ProgressBar from 'primevue/progressbar'
import Button from 'primevue/button'

const deviceActionsStore = useDeviceActionsStore()
const deviceStore = useDeviceStore()

const visible = ref(false)
const showDebug = ref(true)
const lastOperationId = ref(null)
const operationHistory = ref(new Map()) // ✅ Отслеживаем историю операций

const breakpoints = ref({
    '960px': '75vw',
    '640px': '90vw'
})

// ✅ УЛУЧШЕННАЯ ЛОГИКА - ВСЕГДА ПОКАЗЫВАЕМ САМУЮ ПОСЛЕДНЮЮ ОПЕРАЦИЮ
const activeOperation = computed(() => {
    const entries = Array.from(deviceActionsStore.activeOperations.entries())
    
    if (entries.length === 0) return null
    
    // console.log('🔍 All active operations:', entries.map(([id, op]) => ({ 
    //     id, 
    //     type: op.type, 
    //     startedAt: op.startedAt,
    //     progress: op.progress 
    // })))
    
    // ✅ ВСЕГДА находим самую новую операцию по времени начала
    const sortedEntries = entries.sort((a, b) => {
        const timeA = a[1].startedAt || 0
        const timeB = b[1].startedAt || 0
        return timeB - timeA // Самые новые первыми
    })
    
    const latestEntry = sortedEntries[0]
    
    // ✅ ОБНОВЛЯЕМ lastOperationId если нашли более новую операцию
    if (!lastOperationId.value || latestEntry[0] !== lastOperationId.value) {
        // console.log('🔄 Switching to latest operation:', latestEntry[0], 'started at:', new Date(latestEntry[1].startedAt).toLocaleTimeString())
        lastOperationId.value = latestEntry[0]
    }
    
    return latestEntry
})

const currentDeviceId = computed(() => activeOperation.value ? activeOperation.value[0] : null)
const currentOperationType = computed(() => activeOperation.value ? activeOperation.value[1]?.type : null)
const progress = computed(() => {
    if (!currentDeviceId.value) return 0
    return deviceActionsStore.getDeviceProgress(currentDeviceId.value)
})

const activeOperationsCount = computed(() => deviceActionsStore.activeOperations.size)

// ✅ НОВАЯ ЛОГИКА: диалог закрывается только когда ВСЕ операции завершены
const canClose = computed(() => {
    // Можно закрыть, если текущая операция прогрессировала достаточно
    return progress.value >= 20
})

const showCloseButton = computed(() => {
    return canClose.value && visible.value
})

const showCloseHint = computed(() => {
    return canClose.value && progress.value < 100
})

const currentDevice = computed(() => {
    if (!currentDeviceId.value) return null
    return deviceStore.allDevices.find(device => device.id === currentDeviceId.value)
})

const currentDeviceHwId = computed(() => currentDevice.value?.hwId || currentDeviceId.value || 'Unknown Device')

const operationText = computed(() => {
    if (!currentOperationType.value) return 'Processing'
    
    const texts = {
        resetting: 'Resetting Configuration',
        rebooting: 'Rebooting Device',
        resettingDsl: 'Resetting DSL Line',
        initializing: 'Initializing Device'
    }
    return texts[currentOperationType.value] || 'Processing'
})

// ✅ УЛУЧШЕННАЯ ОТЛАДОЧНАЯ ИНФОРМАЦИЯ
const debugInfo = computed(() => {
    const entries = Array.from(deviceActionsStore.activeOperations.entries())
    const sortedEntries = entries.sort((a, b) => (b[1].startedAt || 0) - (a[1].startedAt || 0))
    
    return {
        activeDevice: currentDeviceId.value,
        operation: currentOperationType.value,
        progress: progress.value + '%',
        activeOperations: entries.length,
        canClose: canClose.value,
        showCloseButton: showCloseButton.value,
        lastOperationId: lastOperationId.value,
        allOperations: sortedEntries.map(([id, op]) => ({
            id,
            type: op.type,
            progress: op.progress,
            startedAt: op.startedAt ? new Date(op.startedAt).toLocaleTimeString() : 'no timestamp',
            isCurrent: id === currentDeviceId.value
        }))
    }
})

// ✅ ОБРАБОТЧИК ЗАКРЫТИЯ
const handleClose = () => {
    if (canClose.value) {
        // console.log('🔴 User closed operation dialog', {
        //     currentDevice: currentDeviceId.value,
        //     operation: currentOperationType.value,
        //     progress: progress.value + '%',
        //     remainingOperations: activeOperationsCount.value
        // })
        visible.value = false
        // ✅ НЕ сбрасываем lastOperationId - диалог может открыться снова для других операций
    }
}

// ✅ ПРОСТОЙ И НАДЕЖНЫЙ WATCHER
watch(() => deviceActionsStore.activeOperations.size, (newSize) => {
    // console.log('🌍 Active operations count:', newSize)
    
    if (newSize === 0) {
        // Все операции завершены
        lastOperationId.value = null
        visible.value = false
        // console.log('✅ All operations completed')
    } else {
        // Есть активные операции - показываем диалог
        visible.value = true
        // console.log('🔄 Operations in progress:', newSize)
        
        // ✅ ПРИНУДИТЕЛЬНО ОБНОВЛЯЕМ ТЕКУЩУЮ ОПЕРАЦИЮ
        // Это заставляет computed activeOperation пересчитаться
        const entries = Array.from(deviceActionsStore.activeOperations.entries())
        if (entries.length > 0) {
            const sortedEntries = entries.sort((a, b) => (b[1].startedAt || 0) - (a[1].startedAt || 0))
            const latestEntry = sortedEntries[0]
            
            if (latestEntry[0] !== lastOperationId.value) {
                // console.log('🎯 Auto-switching to latest operation:', latestEntry[0])
                lastOperationId.value = latestEntry[0]
            }
        }
    }
}, { immediate: true })

// ✅ WATCHER ДЛЯ ОБНОВЛЕНИЯ ПРОГРЕССА ТЕКУЩЕЙ ОПЕРАЦИИ
watch(() => {
    // Этот watcher следит за прогрессом текущей операции
    if (!currentDeviceId.value) return 0
    return deviceActionsStore.getDeviceProgress(currentDeviceId.value)
}, (newProgress) => {
    if (currentDeviceId.value && newProgress > 0) {
        // console.log('📊 Progress update for current operation:', {
        //     device: currentDeviceId.value,
        //     progress: newProgress + '%',
        //     operation: currentOperationType.value
        // })
    }
})

// ✅ WATCHER ДЛЯ СЛЕЖЕНИЯ ЗА ИЗМЕНЕНИЯМИ В АКТИВНЫХ ОПЕРАЦИЯХ
watch(() => {
    // Создаем сигнал для отслеживания изменений в операциях
    return Array.from(deviceActionsStore.activeOperations.entries()).map(([id, op]) => 
        `${id}-${op.type}-${op.progress}-${op.startedAt}`
    ).join('|')
}, (newValue, oldValue) => {
    if (newValue !== oldValue) {
        // console.log('🔄 Operations content changed')
        // При изменении операций принудительно обновляем текущую
        const entries = Array.from(deviceActionsStore.activeOperations.entries())
        if (entries.length > 0) {
            const sortedEntries = entries.sort((a, b) => (b[1].startedAt || 0) - (a[1].startedAt || 0))
            const latestEntry = sortedEntries[0]
            
            if (!lastOperationId.value || latestEntry[0] !== lastOperationId.value) {
                // console.log('🔄 Content change - switching to:', latestEntry[0])
                lastOperationId.value = latestEntry[0]
            }
        }
    }
})
</script>

<style scoped>
.operation-content {
    text-align: left;
}

.operation-text h4 {
    margin: 0;
    color: #2c3e50;
    font-size: 1.1rem;
}

.operation-text p {
    margin: 0;
    color: #6c757d;
    font-size: 0.9rem;
}

.custom-progressbar {
    height: 12px !important;
    border-radius: 4px;
}

/* Стили для кнопки закрытия в заголовке */
.close-header-btn {
    color: var(--text-color-secondary) !important;
    border-radius: 50% !important;
    width: 2rem !important;
    height: 2rem !important;
    transition: all 0.3s ease !important;
}

.close-header-btn:hover:not(:disabled) {
    background: var(--surface-200) !important;
    color: var(--text-color) !important;
    transform: scale(1.1);
}

.close-header-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* Стили для подсказки о возможности закрытия */
.close-hint {
    color: #2e7d32;
    border: 1px solid #c8e6c9;
    animation: fadeIn 0.5s ease-in;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Адаптивность для мобильных */
@media (max-width: 640px) {
    .close-header-btn {
        width: 1.75rem !important;
        height: 1.75rem !important;
    }
    
    .close-hint {
        font-size: 0.75rem;
        padding: 0.5rem !important;
    }
}
</style>