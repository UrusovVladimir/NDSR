<template>
  <div class="chat-window">
    <ChatHeader
      :online-users-count="onlineUsersCount"
      :online-users-ips="onlineUsersIps"
      :users="users" 
      @close="$emit('close')"
    />
    
    <ChatMessages
      :messages="messages"
      :current-user-id="currentUserId"
    />
    
    <TypingIndicator
      v-if="typingUsers.length > 0"
      :users="typingUsers"
    />
    
    <ChatInput
      :is-loading="isLoading"
      @send-message="$emit('send-message', $event)"
    />
  </div>
</template>

<script setup>
import ChatHeader from './ChatHeader.vue'
import ChatMessages from './ChatMessages.vue'
import ChatInput from './ChatInput.vue'
import TypingIndicator from './TypingIndicator.vue'

defineProps({
  messages: Array,
  typingUsers: Array,
  onlineUsersCount: Number,
  onlineUsersIps: Array,
  isLoading: Boolean,
  currentUserId: String,
  users: {
    type: Array,
    default: () => []
  }
})

defineEmits(['close', 'send-message'])
</script>

<style scoped>
.chat-window {
  position: fixed;
  bottom: 90px;
  right: 20px;
  width: 380px;
  height: 600px;
  background: white;
  border-radius: 15px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  z-index: 1004;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 768px) {
  .chat-window {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    border-radius: 0;
    z-index: 1006;
    box-shadow: none;
  }
}

@media (max-width: 768px) {
  body.chat-open {
    overflow: hidden;
    position: fixed;
    width: 100%;
    height: 100%;
  }
}
</style>