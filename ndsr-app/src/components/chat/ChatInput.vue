<template>
  <div class="chat-input-container">
    <div class="mention-indicator" v-if="chatStore.isMentioned">
      <span>Отправляется для: @{{ chatStore.mentionedUser.name }}</span>
      <button @click="chatStore.clearMentionedUser()" class="clear-mention">
        <i class="bi bi-x"></i>
      </button>
    </div>
    <div class="input-wrapper">
      <div
        ref="messageInput"
        contenteditable="true"
        @input="handleInput"
        @keydown="handleKeydown"
        @blur="stopTyping"
        :data-placeholder="placeholderText"
        class="chat-input-editable"
        :class="{ 'disabled': isLoading, 'has-mention': chatStore.isMentioned }"
      ></div>
      <button 
        @click="sendMessage" 
        @touchstart.prevent="handleTouchStart"
        @touchend.prevent="handleTouchEnd"
        @mousedown.prevent
        class="chat-send-btn"
        :disabled="isLoading || !messageText.trim()"
        :class="{ 'has-mention': chatStore.isMentioned }"
      >
        <i class="bi" :class="isLoading ? 'bi-arrow-clockwise' : 'bi-send'"></i>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, computed } from 'vue'
import { useChatStore } from '@/stores/useChatStore'

const props = defineProps({
  isLoading: Boolean
})

const emit = defineEmits(['send-message'])

const chatStore = useChatStore()
const messageInput = ref(null)
const messageText = ref('')
const typingTimeout = ref(null)
const isTyping = ref(false)

const placeholderText = computed(() => {
  return chatStore.isMentioned 
    ? `Сообщение для @${chatStore.mentionedUser.name}...`
    : 'Type a message...'
})

const handleInput = () => {
  if (messageInput.value) {
    messageText.value = messageInput.value.innerText.trim()
    
    messageInput.value.style.height = 'auto'
    messageInput.value.style.height = Math.min(messageInput.value.scrollHeight, 120) + 'px'
  }

  if (!isTyping.value) {
    isTyping.value = true
    chatStore.sendTyping()
  }
  
  clearTimeout(typingTimeout.value)
  typingTimeout.value = setTimeout(stopTyping, 1000)
}

const stopTyping = () => {
  if (isTyping.value) {
    isTyping.value = false
    chatStore.sendStopTyping()
  }
}

const handleKeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
  
  // ESC для отмены упоминания
  if (event.key === 'Escape' && chatStore.isMentioned) {
    event.preventDefault()
    chatStore.clearMentionedUser()
  }
}

const handleTouchStart = (event) => {
  event.preventDefault()
  if (messageInput.value) {
    messageInput.value.focus()
    
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      setTimeout(() => {
        if (messageInput.value) {
          messageInput.value.focus()
        }
      }, 100)
    }
  }
}

const handleTouchEnd = (event) => {
  event.preventDefault()
  
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    setTimeout(() => {
      sendMessage()
    }, 50)
  } else {
    sendMessage()
  }
}

const sendMessage = async () => {
  if (!messageText.value.trim() || props.isLoading) return
  
  await chatStore.sendMessage(messageText.value.trim())
  
  if (messageInput.value) {
    messageInput.value.innerText = ''
    messageInput.value.style.height = '46px'
    messageText.value = ''
  }
  
  stopTyping()
  
  if (messageInput.value) {
    nextTick(() => {
      messageInput.value.focus()
    })
  }
}

const focusInput = () => {
  if (messageInput.value) {
    nextTick(() => {
      messageInput.value.focus()
      
      if ('ontouchstart' in window) {
        setTimeout(() => {
          messageInput.value.focus()
          setTimeout(() => {
            const inputRect = messageInput.value.getBoundingClientRect()
            const viewportHeight = window.innerHeight
            
            if (inputRect.bottom > viewportHeight - 100) {
              messageInput.value.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'end'
              })
            }
          }, 100)
        }, 300)
      }
    })
  }
}

defineExpose({
  focusInput
})

onMounted(() => {
  if (messageInput.value && !messageInput.value.innerText) {
    messageInput.value.setAttribute('data-placeholder', 'Type a message...')
  }
})
</script>

<style scoped>
.chat-input-container {
  display: flex;
  flex-direction: column;
  padding: 15px 20px;
  gap: 8px;
  background: white;
  border-top: 1px solid #e2e8f0;
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.mention-indicator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 1px solid #f59e0b;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 0.9rem;
  color: #92400e;
  font-weight: 600;
}

.clear-mention {
  background: none;
  border: none;
  color: #92400e;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.clear-mention:hover {
  background: rgba(146, 64, 14, 0.1);
}

.chat-input-editable {
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #e2e8f0;
  border-radius: 25px;
  outline: none;
  font-size: 16px;
  min-height: 46px;
  max-height: 120px;
  overflow-y: auto;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  background: white;
  transition: all 0.3s ease;
}

.chat-input-editable:focus {
  border-color: #ffc107;
  outline: none;
  box-shadow: 0 0 0 2px rgba(255, 193, 7, 0.1);
}

.chat-input-editable.has-mention {
  border-color: #f59e0b;
  background: #fffbeb;
}

.chat-input-editable.has-mention:focus {
  border-color: #d97706;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.1);
}

.chat-input-editable.disabled {
  background: #f7fafc;
  cursor: not-allowed;
}

.chat-input-editable[data-placeholder]:empty:before {
  content: attr(data-placeholder);
  color: #a0aec0;
  font-style: italic;
}

.chat-send-btn {
  background: transparent;
  border: 2px solid #ffc107;
  color: #ffc107;
  border-radius: 50%;
  width: 46px;
  height: 46px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
  margin-bottom: 0; /* Убираем отступ */
}

.chat-send-btn.has-mention {
  border-color: #f59e0b;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
}

.chat-send-btn:hover:not(:disabled) {
  background: rgba(255, 193, 7, 0.1);
  border-color: #ffd54f;
  color: #ffd54f;
  transform: scale(1.05);
}

.chat-send-btn.has-mention:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.2);
  border-color: #d97706;
  color: #d97706;
}

.chat-send-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .chat-input-container {
    padding: 12px 16px;
  }
  
  .input-wrapper {
    gap: 8px;
  }
  
  .chat-input-editable {
    font-size: 16px !important;
    min-height: 44px;
  }
  
  .chat-send-btn {
    width: 44px;
    height: 44px;
  }
}

@media (min-width: 769px) {
  .chat-input-editable {
    overflow-y: hidden;
  }
}
</style>