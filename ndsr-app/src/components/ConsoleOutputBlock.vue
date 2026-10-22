<template>
  <!-- Вывод консоли устройства во время операции (useConsoleLogStore):
       свёрнут по умолчанию; раскрытый — родитель может расширить окно -->
  <div v-if="log" class="console-block">
    <div
      class="console-toggle"
      role="button"
      tabindex="0"
      @click="toggle"
      @keydown.enter="toggle"
    >
      <i :class="['pi', expanded ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
      <i class="bi bi-terminal"></i>
      <span>Console output{{ hwId ? ` — ${hwId}` : '' }}</span>
      <span class="console-state" :class="log.state">{{ STATE_TEXT[log.state] || log.state }}</span>
    </div>
    <pre
      v-if="expanded"
      ref="pre"
      class="console-pre"
    >{{ log.text || log.message || 'Waiting for console output…' }}<template v-if="log.text && log.message">{{ '\n' + log.message }}</template></pre>
  </div>
</template>

<script setup>
// Один блок «Console output» для окна операции одного устройства
// (ProgressModal: смена режима, MWS). Захват начинает/заканчивает владелец
// окна через useConsoleLogStore.begin / finish / forget.
import { ref, computed, watch, nextTick } from 'vue'
import { useConsoleLogStore } from '@/stores/useConsoleLogStore'

const props = defineProps({
  deviceId: { type: [String, Number], default: null },
  hwId: { type: String, default: '' },
  expanded: { type: Boolean, default: false }
})
const emit = defineEmits(['update:expanded'])

const STATE_TEXT = {
  starting: 'connecting…',
  capturing: 'live',
  ended: 'ended',
  unavailable: 'unavailable',
  'console-open': 'in console window'
}

const consoleLogStore = useConsoleLogStore()
const log = computed(() => props.deviceId == null ? null : consoleLogStore.getLog(props.deviceId))
const pre = ref(null)

const scrollToEnd = () => nextTick(() => { if (pre.value) pre.value.scrollTop = pre.value.scrollHeight })

const toggle = () => {
  emit('update:expanded', !props.expanded)
  if (!props.expanded) scrollToEnd()
}

// Новые строки — вниз, если пользователь не отмотал наверх
watch(() => log.value?.text?.length, () => {
  const el = pre.value
  if (!el) return
  const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  if (stick) scrollToEnd()
})
</script>

<style scoped>
.console-block {
  margin-top: 0.75rem;
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
