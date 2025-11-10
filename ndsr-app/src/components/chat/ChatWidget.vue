<template>
  <div class="chat-widget">
    <ChatToggleButton
      :is-open="chatStore.isChatOpen"
      :unread-count="chatStore.unreadCount"
      @toggle="chatStore.toggleChat()"
    />
    
    <div v-if="chatStore.isChatOpen" class="chat-overlay" @click="chatStore.closeChat()"></div>
    
    <ChatWindow
      v-if="chatStore.isChatOpen"
      :messages="chatStore.messages"
      :typing-users="chatStore.typingUsers"
      :online-users-count="chatStore.onlineUsersCount"
      :online-users-ips="chatStore.onlineUsersIps"
      :is-loading="chatStore.isLoading"
      :current-user-id="chatStore.currentUserId"
      :users="users"
      @send-message="chatStore.sendMessage($event)"
      @close="chatStore.closeChat()"
    />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, watch } from 'vue'
import { useChatStore } from '@/stores/useChatStore'
import ChatToggleButton from './ChatToggleButton.vue'
import ChatWindow from './ChatWindow.vue'
import { socket } from '@/socket' 

const chatStore = useChatStore()

const props = defineProps({
  users: {
    type: Array,
    default: () => []
  }
})

watch(() => chatStore.isChatOpen, (isOpen) => {
  if (isOpen) {
    document.body.classList.add('chat-open')
  } else {
    document.body.classList.remove('chat-open')
  }
})

onMounted(() => {
  chatStore.setSocket(socket)
  chatStore.initializeChat()
})

onUnmounted(() => {
  chatStore.cleanupSocketListeners()
  document.body.classList.remove('chat-open')
})
</script>

<style scoped>
.chat-widget {
  position: relative;
}

.chat-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1003;
  backdrop-filter: blur(2px);
}

@media (min-width: 769px) {
  .chat-overlay {
    display: none;
  }
}
</style>