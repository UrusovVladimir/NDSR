<template>
  <div class="chat-header">
    <div class="header-content">
      <div class="chat-info">
        <div class="chat-icon">
          <i class="bi bi-chat-text-fill"></i>
          <div v-if="chatStore.mentionCount > 0" class="mention-badge">
            {{ chatStore.mentionCount }}
          </div>
        </div>
        <div class="chat-details">
          <h3 class="chat-name">
            Общий чат
            <span v-if="chatStore.isMentioned" class="mention-indicator" :class="{ 'all-mention': chatStore.mentionedUser.id === 'all' }">
              {{ chatStore.mentionedUser.id === 'all' ? '@all' : `@${chatStore.mentionedUser.name}` }}
            </span>
          </h3>
          <div class="online-status">
            <span class="status-dot"></span>
            <span class="status-text">{{ onlineUsersCount }} онлайн</span>
          </div>
        </div>
      </div>
      
      <div class="header-actions">
        <OnlineUsersDropdown 
          :users="onlineUsers"
          :total-count="onlineUsersCount"
          @user-click="handleUserClick"
          @mention-user="handleMention"
        />
        <button 
          v-if="chatStore.isMentioned" 
          @click="chatStore.clearMentionedUser()" 
          class="clear-mention-btn"
          :class="{ 'all-mention': chatStore.mentionedUser.id === 'all' }"
          :title="chatStore.mentionedUser.id === 'all' ? 'Отменить упоминание всех' : 'Отменить упоминание'"
        >
          <i class="bi bi-x-circle"></i>
        </button>
        <button @click="$emit('close')" class="close-btn">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useChatStore } from '@/stores/useChatStore'
import OnlineUsersDropdown from './OnlineUsersDropdown.vue'

const chatStore = useChatStore()

const props = defineProps({
  onlineUsersCount: Number,
  onlineUsersIps: Array,
  users: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close'])

const avatarColors = [
  '#ffc107', '#ffb300', '#ffa000', '#ff8f00',
  '#ffd54f', '#ffca28', '#ffb300', '#ffa000',
  '#f57c00', '#ef6c00', '#e65100', '#ff6d00'
]

const generateColor = (ip) => {
  const hash = ip.split('.').reduce((a, b) => a + parseInt(b), 0)
  return avatarColors[hash % avatarColors.length]
}

const onlineUsers = computed(() => {
  // ✅ ДОБАВИТЬ ЗАЩИТУ ОТ НЕМАССИВА
  const usersArray = Array.isArray(props.users) ? props.users : []
  
  // ✅ ФИЛЬТРУЕМ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ ТОЛЬКО ДЛЯ СПИСКА
  const filteredIps = props.onlineUsersIps.filter(ip => ip !== chatStore.currentUserId)
  
  return filteredIps.map(ip => {
    const user = usersArray.find(u => u.ip === ip)
    const name = user ? user.name : `User ${ip.slice(-4)}`
    
    return {
      id: ip,
      ip: ip,
      name: name,
      initial: name.charAt(0).toUpperCase(),
      color: generateColor(ip),
      status: 'online'
    }
  })
})

const handleUserClick = (user) => {
  console.log('User clicked:', user)
}

const handleMention = (user) => {
  chatStore.setMentionedUser(user)
}
</script>
<style scoped>
.chat-header {
  background: linear-gradient(135deg, #343a40 0%, #495057 100%);
  color: #ffc107;
  padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  border-bottom: 2px solid #ffc107;
  position: relative;
  overflow: visible;
  z-index: 1007;
  flex-shrink: 0;
}

.chat-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #ffc107, transparent);
  animation: shimmer 3s ease-in-out infinite;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  z-index: 1008;
}

.chat-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-icon {
  position: relative;
  width: 40px;
  height: 40px;
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  color: #ffc107;
  transition: all 0.3s ease;
  flex-shrink: 0;
}

.mention-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  background: #ef4444;
  color: white;
  border-radius: 50%;
  width: 18px;
  height: 18px;
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #343a40;
  animation: pulse 1.5s infinite;
}

.chat-icon:hover {
  background: rgba(255, 193, 7, 0.2);
  transform: scale(1.05);
}

.chat-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.chat-name {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #ffc107;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mention-indicator {
  background: #f59e0b;
  color: #1f2937;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  animation: bounce 2s infinite;
  flex-shrink: 0;
}

.mention-indicator.all-mention {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
}

.online-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  opacity: 0.9;
}

.status-dot {
  width: 8px;
  height: 8px;
  background: #4ade80;
  border-radius: 50%;
  animation: pulse 2s infinite;
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.5);
  flex-shrink: 0;
}

.status-text {
  font-weight: 500;
  color: #ffd54f;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1009;
  flex-shrink: 0;
}

.clear-mention-btn {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid #ef4444;
  color: #ef4444;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}

.clear-mention-btn.all-mention {
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid #6366f1;
  color: #6366f1;
}

.clear-mention-btn:hover {
  background: rgba(239, 68, 68, 0.3);
  transform: scale(1.05);
}

.clear-mention-btn.all-mention:hover {
  background: rgba(99, 102, 241, 0.3);
}

.close-btn {
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid #ffc107;
  color: #ffc107;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}

.close-btn:hover {
  background: rgba(255, 193, 7, 0.2);
  border-color: #ffd54f;
  color: #ffd54f;
  transform: scale(1.05);
  box-shadow: 0 0 12px rgba(255, 193, 7, 0.3);
}

@keyframes pulse {
  0%, 100% { 
    opacity: 1;
    transform: scale(1);
  }
  50% { 
    opacity: 0.7;
    transform: scale(1.1);
  }
}

@keyframes bounce {
  0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-3px); }
  60% { transform: translateY(-2px); }
}

@keyframes shimmer {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

@media (max-width: 768px) {
  .chat-header {
    padding: 14px 16px;
    z-index: 1007;
  }
  
  .chat-icon {
    width: 36px;
    height: 36px;
    font-size: 1rem;
  }
  
  .chat-name {
    font-size: 1rem;
  }
  
  .header-actions {
    gap: 6px;
  }
  
  .close-btn,
  .clear-mention-btn {
    width: 32px;
    height: 32px;
  }
  
  .close-btn,
  .clear-mention-btn {
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .close-btn:active,
  .clear-mention-btn:active {
    transform: scale(0.95);
    opacity: 0.8;
  }
}
</style>