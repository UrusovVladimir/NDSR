<template>
    <Dialog 
        v-model:visible="visible" 
        :modal="true"
        :closable="false"
        :dismissableMask="false"
        :breakpoints="dialogBreakpoints"
        header="Operation in Progress"
        :style="dialogStyle"
    >
        <!-- Кнопка закрытия в правом верхнем углу -->
        <template #header>
            <div class="flex align-items-center justify-content-between w-full">
                <span class="text-lg font-semibold">{{ activeOperation ? 'Operation in Progress' : 'Operation Finished' }}</span>
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
            <div v-if="activeOperation" class="flex align-items-center gap-3 mb-3">
                <ProgressSpinner style="width: 32px; height: 32px" />
                <div class="operation-text">
                    <h4 class="mb-1">{{ operationText }} {{ currentDeviceHwId }}</h4>
                    <p class="text-color-secondary mb-0">Please wait, this may take up to 2-3 minutes...</p>
                </div>
            </div>
            <!-- Операции закончились, а окно держит раскрытый вывод консоли -->
            <div v-else class="flex align-items-center gap-3 mb-3">
                <i class="pi pi-check-circle finished-icon"></i>
                <div class="operation-text">
                    <h4 class="mb-1">Finished</h4>
                    <p class="text-color-secondary mb-0">Console output is kept below — close the window when done.</p>
                </div>
            </div>
            <ProgressBar 
                v-if="activeOperation"
                :value="progress" 
                class="custom-progressbar" 
            />
            
            <!-- Индикатор возможности закрытия -->
            <div v-if="showCloseHint" class="close-hint mt-2 p-2 text-center" style="background: #e8f5e8; border-radius: 4px; font-size: 0.8rem;">
                <i class="pi pi-info-circle mr-1"></i>
                You can now safely close this dialog - operation will continue in background
            </div>

            <!-- Вывод консоли перезагрузки / сброса: свёрнут, раскрытый — окно шире -->
            <div v-if="consoleRows.length" class="console-section">
                <div v-for="row in consoleRows" :key="row.id" class="console-block">
                    <div
                        class="console-toggle"
                        role="button"
                        tabindex="0"
                        @click="toggleConsole(row.id)"
                        @keydown.enter="toggleConsole(row.id)"
                    >
                        <i :class="['pi', expanded.has(row.id) ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
                        <i class="bi bi-terminal"></i>
                        <span>Console output — {{ row.hwId }}</span>
                        <span class="console-state" :class="row.state">{{ CONSOLE_STATE[row.state] || row.state }}</span>
                    </div>
                    <pre
                        v-if="expanded.has(row.id)"
                        class="console-pre"
                        :ref="el => setPre(row.id, el)"
                    >{{ row.text || row.message || 'Waiting for console output…' }}<template v-if="row.text && row.message">{{ '\n' + row.message }}</template></pre>
                </div>
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
import { useConsoleLogStore } from '@/stores/useConsoleLogStore'
import { nextTick } from 'vue'
import Dialog from 'primevue/dialog'
import ProgressSpinner from 'primevue/progressspinner'
import ProgressBar from 'primevue/progressbar'
import Button from 'primevue/button'

const deviceActionsStore = useDeviceActionsStore()
const deviceStore = useDeviceStore()
const consoleLogStore = useConsoleLogStore()

const visible = ref(false)
const showDebug = ref(true)
const lastOperationId = ref(null)
const operationHistory = ref(new Map()) // ✅ Отслеживаем историю операций

// Операции, скрытые крестиком (ключ deviceId:startedAt). Диалог снова
// открывается только для операций, начатых после закрытия: раньше любое
// изменение числа операций (одно из нескольких устройств вернулось)
// открывало его заново
const dismissedKeys = ref(new Set())
const opKey = (id, op) => `${id}:${op?.startedAt || 0}`

const visibleEntries = computed(() =>
    Array.from(deviceActionsStore.activeOperations.entries())
        .filter(([id, op]) => !dismissedKeys.value.has(opKey(id, op)))
)

const breakpoints = ref({
    '960px': '75vw',
    '640px': '90vw'
})

// ✅ УЛУЧШЕННАЯ ЛОГИКА - ВСЕГДА ПОКАЗЫВАЕМ САМУЮ ПОСЛЕДНЮЮ ОПЕРАЦИЮ
const activeOperation = computed(() => {
    const entries = [...visibleEntries.value]
    
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
    // Операций нет (окно держит вывод консоли) — закрыть можно всегда
    if (!activeOperation.value) return true
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

// ========== Вывод консоли ==========
const CONSOLE_STATE = {
    starting: 'connecting…',
    capturing: 'live',
    ended: 'ended',
    unavailable: 'unavailable',
    'console-open': 'in console window'
}
const expanded = ref(new Set())
const pres = new Map()
const setPre = (id, el) => { if (el) pres.set(id, el); else pres.delete(id) }

const toggleConsole = (id) => {
    const next = new Set(expanded.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expanded.value = next
    if (next.has(id)) nextTick(() => { const el = pres.get(id); if (el) el.scrollTop = el.scrollHeight })
}

// Устройства с выводом: идущие перезагрузки/сбросы + раскрытые после окончания
const consoleRows = computed(() => {
    const ids = new Set([
        ...visibleEntries.value.map(([id]) => String(id)),
        ...expanded.value
    ])
    return [...ids]
        .map(id => ({ id, log: consoleLogStore.getLog(id) }))
        .filter(r => r.log)
        .map(r => ({
            id: r.id,
            hwId: deviceStore.allDevices.find(d => String(d.id) === r.id)?.hwId || r.id,
            ...r.log
        }))
})
const consoleExpanded = computed(() => consoleRows.value.some(r => expanded.value.has(r.id)))

// Раскрытый вывод — окно шире, свёрнутый — как было
const dialogStyle = computed(() => ({ width: consoleExpanded.value ? 'min(960px, 95vw)' : '450px' }))
const dialogBreakpoints = computed(() => consoleExpanded.value ? { '1000px': '95vw' } : breakpoints.value)

// Новые строки — прокрутка вниз, если пользователь не отмотал наверх
watch(() => consoleRows.value.map(r => r.text.length).join(','), () => {
    const stick = new Map()
    for (const [id, el] of pres) stick.set(id, el.scrollHeight - el.scrollTop - el.clientHeight < 40)
    nextTick(() => {
        for (const [id, el] of pres) if (stick.get(id)) el.scrollTop = el.scrollHeight
    })
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
        // Скрываем все идущие сейчас операции — их завершение диалог не откроет
        for (const [id, op] of deviceActionsStore.activeOperations) {
            dismissedKeys.value.add(opKey(id, op))
        }
        // Вывод консоли закончившихся операций больше не нужен
        for (const id of expanded.value) {
            if (!deviceActionsStore.activeOperations.has(id)) consoleLogStore.forget(id)
        }
        expanded.value = new Set()
        visible.value = false
    }
}

// ✅ Видимость: открыт, пока есть нескрытые операции. Следим за набором
// операций (а не за size), прогресс ключ не меняет — startedAt постоянен
watch(() => Array.from(deviceActionsStore.activeOperations.entries())
    .map(([id, op]) => opKey(id, op)).join('|'), () => {
    const activeKeys = new Set(
        Array.from(deviceActionsStore.activeOperations.entries()).map(([id, op]) => opKey(id, op))
    )
    // Завершённые операции забываем
    for (const key of [...dismissedKeys.value]) {
        if (!activeKeys.has(key)) dismissedKeys.value.delete(key)
    }

    // Раскрытый вывод консоли держит окно открытым и после окончания операций
    visible.value = visibleEntries.value.length > 0 || consoleExpanded.value
    if (!visible.value) lastOperationId.value = null
}, { immediate: true })

// Свернули последний вывод, а операций уже нет — окно закрывается, как раньше
watch(consoleExpanded, (isExpanded) => {
    if (!isExpanded && visibleEntries.value.length === 0) visible.value = false
})

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

/* У спиннера PrimeVue margin: 0 auto — в широком окне он уезжал к центру */
.operation-content :deep(.p-progress-spinner) {
    margin: 0;
    flex: 0 0 auto;
}

/* ========== Вывод консоли ========== */
.finished-icon {
    font-size: 2rem;
    color: var(--green-500);
}

.console-section {
    margin-top: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.console-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--surface-200);
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    user-select: none;
}

.console-toggle:hover {
    background: var(--surface-50);
}

.console-state {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--text-color-secondary);
}

.console-state.capturing {
    color: var(--green-600);
    font-weight: 600;
}

.console-state.unavailable,
.console-state.console-open {
    color: var(--orange-600);
}

.console-pre {
    margin: 0.35rem 0 0;
    padding: 0.5rem 0.6rem;
    height: 360px;
    max-height: 50vh;
    overflow: auto;
    /* как окно консоли (console.html, xterm.js) */
    background: #1e1e1e;
    color: #e5e5e5;
    border-radius: 6px;
    font-family: Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace;
    font-size: 13px;
    line-height: 1.2;
    white-space: pre-wrap;
    word-break: break-all;
}
</style>