// stores/useEscapeStore.js
import { defineStore } from 'pinia'
import { ref, onMounted, onUnmounted } from 'vue'

export const useEscapeStore = defineStore('escape', () => {
  const escapeHandlers = ref(new Set())

  const registerEscapeHandler = (handler, priority = 0) => {
    escapeHandlers.value.add({ handler, priority })
  }

  const unregisterEscapeHandler = (handler) => {
    escapeHandlers.value.forEach(item => {
      if (item.handler === handler) {
        escapeHandlers.value.delete(item)
      }
    })
  }

  const handleGlobalEscape = (event) => {
    if (event.key === 'Escape') {
      const sortedHandlers = Array.from(escapeHandlers.value)
        .sort((a, b) => b.priority - a.priority)
      
      for (const { handler } of sortedHandlers) {
        if (handler() === true) {
          event.preventDefault()
          break
        }
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleGlobalEscape)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleGlobalEscape)
  })

  return {
    registerEscapeHandler,
    unregisterEscapeHandler
  }
})