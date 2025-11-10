<template>
  <div class="chat-messages" ref="messagesContainer">
    <MessageBubble
      v-for="(message, index) in messages"
      :key="index"
      :message="message"
      :current-user-id="currentUserId"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import MessageBubble from './MessageBubble.vue'

const props = defineProps({
  messages: Array,
  currentUserId: String
})

const messagesContainer = ref(null)

const scrollToBottom = () => {
  if (messagesContainer.value) {
    nextTick(() => {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    })
  }
}

// Автоматическая прокрутка при новых сообщениях
watch(() => props.messages, scrollToBottom, { deep: true })

onMounted(() => {
  scrollToBottom()
})
</script>

<style scoped>
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
  background: #f8f9fa;
  -webkit-overflow-scrolling: touch; /* Плавный скролл на iOS */
  overscroll-behavior: contain; /* Предотвращает скролл body */
}

/* Стили для скроллбара */
.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: #ffc107;
  border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: #ffd54f;
}

/* Для Firefox */
.chat-messages {
  scrollbar-width: thin;
  scrollbar-color: #ffc107 #f1f1f1;
}

@media (max-width: 768px) {
  .chat-messages {
    padding: 16px;
    gap: 12px;
  }
}
</style>