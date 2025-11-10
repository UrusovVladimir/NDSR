// stores/useClipboardStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useToast } from 'primevue/usetoast'

export const useClipboardStore = defineStore('clipboard', () => {
  const copyState = ref('idle')
  const toast = useToast()

  const copyToClipboard = async (text, successMessage = 'Copied to clipboard!') => {
    if (copyState.value === 'copying') return
    
    if (!text || text === 'Loading...') {
      toast.add({ severity: 'error', summary: 'Copy Failed', detail: 'No text to copy', life: 3000 })
      return false
    }

    copyState.value = 'copying'

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')    
        document.body.removeChild(textArea)
      }

      copyState.value = 'success'
      toast.add({ severity: 'success', summary: 'Success', detail: successMessage, life: 2000 })

      setTimeout(() => {
        copyState.value = 'idle'
      }, 2000)

      return true

    } catch (error) {
      console.error('Failed to copy text:', error)
      copyState.value = 'error'
      toast.add({ severity: 'error', summary: 'Copy Failed', detail: 'Failed to copy text to clipboard', life: 3000 })

      setTimeout(() => {
        copyState.value = 'idle'
      }, 3000)

      return false
    }
  }

  return {
    copyState,
    copyToClipboard
  }
})