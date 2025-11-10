  <template>
    <div>
      <!-- Кнопка открытия чата -->
      <button 
        class="chat-toggle-btn"
        @click="toggleChat"
        :data-count="unreadCount"
      >
        <i class="bi" :class="isChatOpen ? 'bi-x-lg' : 'bi-chat-dots'"></i>
      </button>

      <!-- Окно чата -->
      <div v-if="isChatOpen" class="chat-window">
        <!-- Заголовок чата -->
        <div class="chat-header">
          <div class="chat-title">
            <i class="bi bi-chat-text-fill"></i>
            <span style="cursor: default;">Общий чат</span>
            <Popper :arrow="true" :hover="true" :offset-distance="'10'" style="z-index: 1999;">
              <span style="cursor: default;">👥 {{ onlineUsersCount }}</span>
              <template #content>
                <div class="online-users-tooltip">
                  <div class="tooltip-header">👥 Онлайн: {{ onlineUsersCount }}</div>
                  <div class="users-list">
                    <div v-for="ip in onlineUsersIps" :key="ip" class="user-item">
                      {{ getUserName(ip) }}
                    </div>
                    <div v-if="onlineUsersIps.length === 0" class="no-users">
                      Нет пользователей онлайн
                    </div>
                  </div>
                </div>
              </template>
            </Popper>
          </div>
          <button @click="toggleChat" class="chat-close-btn">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <!-- Сообщения -->
        <div class="chat-messages" ref="messagesContainer">
          <div 
            v-for="(message, index) in allMessages" 
            :key="index"
            :class="['message', getMessageClass(message)]"
          >
            <!-- Аватарка только у user/support -->
            <div class="message-avatar" v-if="message.senderType !== 'system'">
              <img 
                :src="getAvatar(message)" 
                :alt="message.senderName"
              />
            </div>

            <div class="message-content" :class="{ 'system-message': message.senderType === 'system' }">
              <!-- Имя только у чужих -->
              <div 
                class="message-sender" 
                v-if="message.senderType !== 'system' && !isMyMessage(message) && message.senderName"
              >
                {{ message.senderName }}
              </div>

              <div class="message-text">{{ message.text }}</div>
              <div class="message-time">
                {{ formatTime(message.timestamp) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Индикатор набора текста -->
        <div v-if="typingUsers.length > 0" class="typing-row">
          <span class="typing-text">
            {{ typingUsers.join(', ') }} печатает
          </span>
          <span class="typing-dots">
            <span></span><span></span><span></span>
          </span>
        </div>

        <!-- Поле ввода -->
        <div class="chat-input-container">
          <div
            ref="messageInput"
            contenteditable="true"
            @input="handleTyping"
            @keydown="handleKeydown"
            data-placeholder="Type a message..."
            class="chat-input-editable"
            :class="{ 'disabled': isLoading }"
          ></div>
          <button 
            @click="sendMessage($event)" 
            @touchstart.prevent="handleTouchStart"
            @touchend.prevent="handleTouchEnd"
            @mousedown.prevent
            class="chat-send-btn"
            :disabled="isLoading || !newMessage.trim()"
          >
            <i class="bi" :class="isLoading ? 'bi-arrow-clockwise' : 'bi-send'"></i>
          </button>
        </div>
      </div>
    </div>
  </template>

  <script setup>
  import { ref, onMounted, watch, nextTick, onUnmounted, computed, inject } from 'vue'
  import { socket } from '@/socket'
  import Popper from "vue3-popper";
  import { toast } from 'vue3-toastify';
  import { useLocalStorage } from '../composables/useLocalStorage'

  const baseUrl = import.meta.env.VITE_WS_IP;



  // Состояние чата
  const isChatOpen = ref(false)
  const newMessage = ref('')
  const messages = ref([])
  const systemMessages = ref([])
  const { value: unreadCount } = useLocalStorage('chat_unread_count', 0)
  const isLoading = ref(false)
  const messagesContainer = ref(null)
  const messageInput = ref(null)
  const typingTimeout = ref(null)
  const isTyping = ref(false)
  const typingUsers = ref([])
  const usersTyping = ref(new Set())
  const onlineUsersCount = ref(0)
  const onlineUsersIps = ref([])
  const currentUserId = ref(null)
  const chatUsers = inject('chatUsers', [])
  const usersList = computed(() => {
    const map = {}
    chatUsers.value.forEach(user => {
      map[user.ip] = user.name
    })
    return map
  })
  const closeSidebar = inject('closeSidebar')

  // Аватары
  const userAvatar = 'https://cdn-icons-png.flaticon.com/512/847/847969.png'
  const supportAvatar = 'https://cdn-icons-png.flaticon.com/512/4715/4715333.png'

  // Computed
  const onlineUsers = computed(() => onlineUsersCount.value)
  const allMessages = computed(() => {
    const systemWithType = systemMessages.value.map(msg => ({
      ...msg,
      senderType: 'system'
    }))
    return [...systemWithType, ...messages.value]
  })

  // Функции
  const closeChat = () => {
  isChatOpen.value = false
  }
  const scrollToBottom = () => {
    if (messagesContainer.value) {
      nextTick(() => {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      })
    }
  }

  const focusInput = () => {
    if (messageInput.value && isChatOpen.value) {
      nextTick(() => {
        messageInput.value.focus()
        
        // Для мобильных устройств - дополнительная логика
        if ('ontouchstart' in window) {
          // Даем время на отрисовку чата перед фокусировкой
          setTimeout(() => {
            messageInput.value.focus()
            
            // Дополнительная прокрутка через некоторое время
            setTimeout(() => {
              const inputRect = messageInput.value.getBoundingClientRect()
              const viewportHeight = window.innerHeight
              
              // Если поле ввода скрыто под клавиатурой
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

  const stopTyping = () => {
    if (isTyping.value) {
      isTyping.value = false
      socket.emit('user_stop_typing')
    }
  }

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Блокировка скролла основной страницы
  const disableBodyScroll = () => {
    if (window.innerWidth <= 768) {
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      document.body.style.height = '100%'
    }
  }

  const enableBodyScroll = () => {
    document.body.style.overflow = ''
    document.body.style.position = ''
    document.body.style.width = ''
    document.body.style.height = ''
  }

  // Watchers
  watch(usersTyping, (newSet) => {
    typingUsers.value = Array.from(newSet).map(userId => 
      `${userId?userId:userId}`
    )
  }, { deep: true })

  watch(isChatOpen, async (newVal) => {
    if (newVal) {
      disableBodyScroll()
      await nextTick()
      scrollToBottom()
      // Задержка для мобильных устройств
      setTimeout(() => {
        focusInput()
      }, 100)
      unreadCount.value = 0
    } else {
      enableBodyScroll()
      stopTyping()
    }
  })

  watch(messages, scrollToBottom, { deep: true })
  watch(systemMessages, scrollToBottom, { deep: true })
  watch(isChatOpen, (newVal) => {
  if (newVal && messageInput.value) {
    nextTick(() => {
      if (!messageInput.value.innerText) {
        messageInput.value.setAttribute('data-placeholder', 'Type a message...')
      }
    })
  }
})
  // Lifecycle hooks
  onMounted(() => {
    setupSocketListeners()
    loadMessages()
    scrollToBottom()
    window.addEventListener('keydown', handleEscapeKey)
    window.addEventListener('resize', handleResize)
  })

  onUnmounted(() => {
    cleanupSocketListeners()
    window.removeEventListener('keydown', handleEscapeKey)
    window.removeEventListener('resize', handleResize)
    enableBodyScroll()
    if (typingTimeout.value) {
      clearTimeout(typingTimeout.value)
    }
  })

  const handleResize = () => {
    if (isChatOpen.value) {
      if (window.innerWidth <= 768) {
        disableBodyScroll()
      } else {
        enableBodyScroll()
      }
    }
  }


  // Socket handlers
  const setupSocketListeners = () => {
    socket.on('CLIENT_IP', (ip) => {
      currentUserId.value = ip
    })

    socket.on('chat_history', (history) => {
      messages.value = history
      scrollToBottom()
    })

    socket.on('chat_message', (messageData) => {
      addMessage(messageData)
      if (!isChatOpen.value) {
        unreadCount.value++
        toast.success(`Сообщение от ${messageData.senderName}: ${messageData.text}`, { 
                autoClose: 3000,
              });
      }
    })

    socket.on('system_message', (messageData) => {
      addSystemMessage(messageData.text)
    })

    socket.on('user_typing', (userData) => {
    const userId = userData.clientIp || userData.userId
    
    if (userId !== currentUserId.value) {
      const displayName = usersList.value[userId] || `From ip: ${userId}`
      usersTyping.value.add(displayName)
    }
  })

  socket.on('user_stop_typing', (userData) => {
    const userId = userData.clientIp || userData.userId
    
    if (userId !== currentUserId.value) {
      // Создаем оба возможных варианта имени для удаления
      const nameFromList = usersList.value[userId]
      const ipBasedName = `From ip: ${userId}`
      
      // Удаляем оба варианта (один из них точно существует)
      usersTyping.value.delete(nameFromList)
      usersTyping.value.delete(ipBasedName)
    }
  })

    // socket.on('online_users', (count) => {
    //   console.log('Online users:', Array.from(count.users)) 
    //   onlineUsersCount.value = count.size
    // })

  //   socket.on('online_users', (data) => {
  //   // Теперь data.users - это обычный массив
  //   console.log('Online users count:', data.size)
  //   console.log('Online users list:', data.users) // ['172.20.250.43', '172.20.250.72']
    
  //   onlineUsersCount.value = data.size
    
  //   // Можно легко работать с массивом
  //   data.users.forEach(ip => {
  //     console.log('User IP:', ip)
  //   })
  // })
  socket.on('online_users', (data) => {
    try {
      // Обрабатываем оба формата (число и объект)
      if (typeof data === 'number') {
        onlineUsersCount.value = data
        onlineUsersIps.value = [] // Очищаем список
        return
      }
      
      if (data && typeof data === 'object') {
        onlineUsersCount.value = data.size || 0
        
        if (data.users) {
          // Сохраняем массив IP адресов
          onlineUsersIps.value = Array.isArray(data.users) 
            ? data.users 
            : Array.from(data.users || [])
          
          // Логируем для отладки
          onlineUsersIps.value.forEach(ip => {
            console.log('User IP:', ip)
          })
        } else {
          onlineUsersIps.value = []
        }
        return
      }
      
      onlineUsersCount.value = 0
      onlineUsersIps.value = []
      
    } catch (error) {
      console.error('Error processing online_users:', error)
      onlineUsersCount.value = 0
      onlineUsersIps.value = []
    }
  })

    socket.on('message_sent', () => {
      isLoading.value = false
      // Сохраняем фокус после отправки сообщения
      nextTick(() => {
        focusInput()
      })
    })

    socket.on('message_error', (error) => {
      isLoading.value = false
      addSystemMessage(`Ошибка: ${error.message}`)
      // Сохраняем фокус после ошибки
      nextTick(() => {
        focusInput()
      })
    })
  }

  const cleanupSocketListeners = () => {
    const events = [
      'CLIENT_IP', 'chat_history', 'chat_message', 'system_message',
      'user_typing', 'user_stop_typing', 'online_users', 'message_sent', 'message_error'
    ]
    
    events.forEach(event => socket.off(event))
  }

  // Chat functions
  const loadMessages = () => {
    socket.emit('get_chat_history')
  }

  const addSystemMessage = (text) => {
    systemMessages.value.push({
      text,
      timestamp: new Date()
    })
  }

  const addMessage = (messageData) => {
    messages.value.push({
      ...messageData,
      timestamp: new Date(messageData.timestamp)
    })
  }

  const getAvatar = (message) => {
    return isMyMessage(message) ? userAvatar : userAvatar
  }

  const isMyMessage = (message) => {
    if (message.senderType === 'system') return false
    return message.clientIp === currentUserId.value
  }

  const getMessageClass = (message) => {
    if (message.senderType === 'system') return 'system'
    return isMyMessage(message) ? 'my-message' : 'other-message'
  }

  const toggleChat = () => {
    isChatOpen.value = !isChatOpen.value
    closeSidebar()
  }

  const handleEscapeKey = (event) => {
    if (event.key === 'Escape' && isChatOpen.value) {
      toggleChat()
    }
  }

  const handleKeydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage(event)
    }
  }
  const handleTouchStart = (event) => {
  event.preventDefault()
  // Сохраняем фокус перед отправкой
  if (messageInput.value) {
    messageInput.value.focus()
    
    // Для iOS - дополнительный трюк
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
  
  // Небольшая задержка для iOS
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    setTimeout(() => {
      sendMessage(event)
    }, 50)
  } else {
    sendMessage(event)
  }
}

  const getUserName = (ip) => {
    return usersList.value[ip] || `${ip || 'Unknown'}`
  }

  const resetInputHeight = () => {
  if (messageInput.value) {
    messageInput.value.style.height = '46px'
  }
}
const sendMessage = async (event) => {
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  
  if (!newMessage.value.trim() || isLoading.value) return
  
  const messageData = {
    text: newMessage.value.trim(),
    senderType: 'user',
    timestamp: new Date(),
    clientIp: currentUserId.value,
    senderName: getUserName(currentUserId.value)
  }

  isLoading.value = true
  try {
    socket.emit('chat_message', messageData)
    
    // Очищаем contenteditable div
    if (messageInput.value) {
      messageInput.value.innerText = ''
      messageInput.value.style.height = '46px'
      newMessage.value = ''
    }
    
    stopTyping()
    
    // Фокус остается на элементе
    if (messageInput.value && isChatOpen.value) {
      messageInput.value.focus()
    }
  } catch (error) {
    console.error(error)
    isLoading.value = false
    addSystemMessage('Не удалось отправить сообщение')
  }
}

const handleTyping = () => {
  if (messageInput.value) {
    newMessage.value = messageInput.value.innerText.trim()
    
    // Автоматическое изменение высоты
    messageInput.value.style.height = 'auto'
    messageInput.value.style.height = Math.min(messageInput.value.scrollHeight, 120) + 'px'
  }

  if (!isTyping.value) {
    isTyping.value = true
    socket.emit('user_typing')
  }
  
  clearTimeout(typingTimeout.value)
  typingTimeout.value = setTimeout(stopTyping, 1000)
}

defineExpose({
  closeChat
})
  </script>

<style scoped>
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
}

.chat-input-editable:focus {
  border-color: #ffc107;
  outline: none;
  box-shadow: 0 0 0 2px rgba(255, 193, 7, 0.1);
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

.online-count-tooltip {
  font-size: 14px;
  padding: 8px 12px;
  background: #333;
  color: white;
  border-radius: 6px;
  font-weight: 500;
}

/* Base styles */
.chat-toggle-btn {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, #343a40, #495057);
  color: #ffc107;
  border: 2px solid #ffc107;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  z-index: 1005;
  transition: all 0.3s ease;
}

.chat-toggle-btn:hover {
  background: linear-gradient(135deg, #495057, #5a6268);
  border-color: #ffd54f;
  color: #ffd54f;
  transform: scale(1.1);
  box-shadow: 0 6px 25px rgba(255, 193, 7, 0.2);
}

.chat-toggle-btn::after {
  content: attr(data-count);
  position: absolute;
  top: -5px;
  right: -5px;
  background: #ffc107;
  color: #343a40;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  font-size: 0.7rem;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #343a40;
}

.chat-window {
  position: fixed;
  bottom: 90px;
  right: 20px;
  width: 380px;
  height: 500px;
  background: white;
  border-radius: 15px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  z-index: 1004;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideIn 0.3s ease;
}

.chat-header {
  background: linear-gradient(135deg, #343a40, #495057);
  color: #ffc107;
  padding: 15px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 2px solid #ffc107;
}

.chat-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.online-count {
  margin-left: 10px;
  font-size: 0.8rem;
  opacity: 0.8;
}

.chat-close-btn {
  background: transparent;
  border: 2px solid #ffc107;
  color: #ffc107;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.chat-close-btn:hover {
  background: rgba(255, 193, 7, 0.1);
  border-color: #ffd54f;
  color: #ffd54f;
  transform: scale(1.1);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
  background: #f8f9fa;
}

/* Message styles */
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

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
}

.message-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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

/* Typing indicator */
.typing-row {
  display: flex;
  align-items: center;
  padding: 8px 20px;
  background: #f8f9fa;
  border-top: 1px solid #e2e8f0;
  min-height: 40px;
}

.typing-text {
  font-size: 14px;
  color: #666;
  margin-right: 8px;
}

.typing-dots {
  display: inline-flex;
  gap: 3px;
}

.typing-dots span {
  width: 6px;
  height: 6px;
  background: #ffc107;
  border-radius: 50%;
  animation: typingBlink 1.4s infinite both;
}

.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typingBlink {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

/* Input area */
.chat-input-container {
  display: flex;
  padding: 15px 20px;
  gap: 12px;
  background: white;
  border-top: 1px solid #e2e8f0;
  align-items: flex-end;
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
}

.chat-input-editable:focus {
  border-color: #ffc107;
  outline: none;
  box-shadow: 0 0 0 2px rgba(255, 193, 7, 0.1);
}

.chat-input-editable.disabled {
  background: #f7fafc;
  cursor: not-allowed;
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
  margin-bottom: 2px;
}

.chat-send-btn:hover:not(:disabled) {
  background: rgba(255, 193, 7, 0.1);
  border-color: #ffd54f;
  color: #ffd54f;
  transform: scale(1.05);
}

.chat-send-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Scrollbar */
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

/* Animations */
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

/* Mobile styles - FULLSCREEN */
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
  }

  .chat-toggle-btn {
    bottom: 20px;
    right: 20px;
    width: 60px;
    height: 60px;
    z-index: 1005;
  }

  .chat-header {
    padding-top: max(20px, env(safe-area-inset-top, 20px));
    padding-bottom: 15px;
  }

  .chat-messages {
    flex: 1;
    padding: 15px;
    padding-bottom: 10px;
  }

  .message {
    max-width: 90%;
  }

  .chat-input-container {
    padding-bottom: max(15px, env(safe-area-inset-bottom, 15px));
    padding-left: max(20px, env(safe-area-inset-left, 20px));
    padding-right: max(20px, env(safe-area-inset-right, 20px));
  }

  .typing-row {
    padding: 8px max(20px, env(safe-area-inset-left, 20px));
  }

  .chat-input-editable {
    font-size: 16px !important;
    overflow-y: auto;
  }
}

/* Desktop styles */
@media (min-width: 769px) {
  .chat-window {
    bottom: 90px;
    right: 20px;
    width: 380px;
    height: 500px;
    border-radius: 15px;
  }
  
  .chat-input-editable {
    overflow-y: hidden;
  }
}

.online-count-tooltip {
  font-size: 14px;
  padding: 8px 12px;
  background: #333;
  color: white;
  border-radius: 6px;
  font-weight: 500;
}
</style>