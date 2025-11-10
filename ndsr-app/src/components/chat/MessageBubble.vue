<template>
  <div :class="['message', messageClass]">
    <div class="message-avatar" v-if="message.senderType !== 'system'">
      <div class="avatar-letter" :style="{ background: getAvatarColor(message) }">
        {{ getAvatarLetter(message) }}
      </div>
    </div>

    <div class="message-content" :class="{ 'system-message': message.senderType === 'system' }">
      <!-- Имя и IP отправителя -->
      <div 
        class="message-sender" 
        v-if="message.senderType !== 'system' && !isMyMessage"
      >
        <span class="sender-name">{{ message.senderName }}</span>
        <span class="sender-ip">({{ message.clientIp }})</span>
      </div>

      <div class="message-text">{{ message.text }}</div>
      <div class="message-time">
        {{ formatTime(message.timestamp) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  message: Object,
  currentUserId: String
})

// Computed свойства
const isMyMessage = computed(() => {
  if (props.message.senderType === 'system') return false
  return props.message.clientIp === props.currentUserId
})

const messageClass = computed(() => {
  if (props.message.senderType === 'system') return 'system'
  return isMyMessage.value ? 'my-message' : 'other-message'
})

// Цвета для аватарок
const avatarColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', 
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
]

// Методы
const getAvatarLetter = (message) => {
  if (!message.senderName) return '?'
  return message.senderName.charAt(0).toUpperCase()
}

const getAvatarColor = (message) => {
  const name = message.senderName || 'Unknown'
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % avatarColors.length
  return avatarColors[index]
}

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<style scoped>
.message {
  display: flex;
  gap: 12px;
  max-width: 85%;
  margin-bottom: 15px;
}

.message.my-message {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.message.other-message {
  align-self: flex-start;
  flex-direction: row;
}

.message.system {
  justify-content: center;
  align-self: center;
  max-width: 100%;
}

.message.system .message-content {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 12px;
  padding: 8px 16px;
}

.message.system .message-text {
  font-style: italic;
  color: #666;
  text-align: center;
}

/* Аватарка с буквой */
.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  color: white;
}

.avatar-letter {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-content {
  max-width: calc(100% - 48px);
}

.message-text {
  padding: 12px 16px;
  border-radius: 18px;
  word-wrap: break-word;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.message.my-message .message-text {
  background: linear-gradient(135deg, #343a40, #495057);
  color: #ffc107;
  border: 1px solid #ffc107;
  border-bottom-left-radius: 6px;
  border-top-right-radius: 18px;
}

.message.other-message .message-text {
  background: white;
  color: #2d3748;
  border: 1px solid #e2e8f0;
  border-bottom-right-radius: 6px;
  border-top-left-radius: 18px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.message-sender {
  font-weight: 600;
  font-size: 0.8rem;
  margin-bottom: 2px;
  color: #4a5568;
}

.message-time {
  font-size: 0.75rem;
  color: #718096;
  margin-top: 5px;
}

.message.my-message .message-time {
  text-align: right;
}

.message.other-message .message-time {
  text-align: left;
}
.sender-name {
  font-weight: 600;
  color: #2d3748;
}

.sender-ip {
  font-size: 0.7rem;
  color: #718096;
  margin-left: 6px;
}

.message.my-message .message-sender {
  display: none;
}
</style>