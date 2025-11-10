import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { toast } from 'vue3-toastify'
import { useLocalStorage } from '@/composables/useLocalStorage'

// Импортируем users если они доступны глобально
// Или передадим их через параметры
// import { users } from '@/api/users'

export const useChatStore = defineStore('chat', () => {
  // State
  const isChatOpen = ref(false)
  const messages = ref([])
  const systemMessages = ref([])
  const { value: unreadCount } = useLocalStorage('chat_unread_count', 0)
  const { value: mentionCount } = useLocalStorage('chat_mention_count', 0)
  const isLoading = ref(false)
  const typingUsers = ref([])
  const usersTyping = ref(new Set())
  const onlineUsersCount = ref(0)
  const onlineUsersIps = ref([])
  const currentUserId = ref(null)
  const mentionedUser = ref(null)
  const socketInstance = ref(null)
  

  
  // Getters
  const allMessages = computed(() => {
    const systemWithType = systemMessages.value.map(msg => ({
      ...msg,
      senderType: 'system'
    }))
    return [...systemWithType, ...messages.value]
  })
  
  const isMentioned = computed(() => mentionedUser.value !== null)
  
  // Actions
  const setSocket = (socket) => {
    socketInstance.value = socket
    setupSocketListeners()
  }

  
  const toggleChat = () => {
    isChatOpen.value = !isChatOpen.value
    
    if (isChatOpen.value) {
      unreadCount.value = 0
      mentionCount.value = 0
      saveUnreadCount()
      saveMentionCount()
    }
  }
  
  const closeChat = () => {
    isChatOpen.value = false
  }
  
  const openChat = () => {
    isChatOpen.value = true
    unreadCount.value = 0
    mentionCount.value = 0
    saveUnreadCount()
    saveMentionCount()
  }
  
  const setMentionedUser = (user) => {
    mentionedUser.value = user
  }
  
  const clearMentionedUser = () => {
    mentionedUser.value = null
  }
  
  const sendMessage = async (text) => {
    if (!text.trim() || isLoading.value) return
    
    let finalText = text.trim()
    let targetIp = null
    let notifyAll = false
    
    if (mentionedUser.value) {
      if (mentionedUser.value.id === 'all') {
        finalText = `@all ${finalText}`
        notifyAll = true
        targetIp = null
      } else {
        finalText = `@${mentionedUser.value.name} ${finalText}`
        targetIp = mentionedUser.value.ip
        notifyAll = false
      }
      clearMentionedUser()
    }
    
    // ✅ ПРОСТО ОТПРАВЛЯЕМ СООБЩЕНИЕ БЕЗ senderName
    const messageData = {
      text: finalText,
      senderType: 'user',
      timestamp: new Date(),
      clientIp: currentUserId.value || 'unknown',
      targetIp: targetIp,
      isMention: !!targetIp || notifyAll,
      notifyAll: notifyAll
    }
    
    isLoading.value = true
    try {
      if (socketInstance.value) {
        socketInstance.value.emit('chat_message', messageData)
      } else {
        throw new Error('Socket not connected')
      }
    } catch (error) {
      console.error(error)
      isLoading.value = false
      toast.error('Ошибка подключения', { autoClose: 2000 })
    }
  }
  const sendTyping = () => {
    if (socketInstance.value) {
      socketInstance.value.emit('user_typing')
    }
  }
  
  const sendStopTyping = () => {
    if (socketInstance.value) {
      socketInstance.value.emit('user_stop_typing')
    }
  }
  
  const showChatNotification = (messageData) => {
    // ВАЖНО: Уведомления показываем ТОЛЬКО если:
    // 1. Это упоминание всем (notifyAll: true) ИЛИ
    // 2. Это упоминание текущему пользователю (targetIp === currentUserId)
    // И чат закрыт
    
    const isForCurrentUser = messageData.targetIp === currentUserId.value
    const shouldShowNotification = !isChatOpen.value && (messageData.notifyAll || isForCurrentUser)
    
    // ОБЫЧНЫЕ сообщения (без notifyAll и без targetIp) - НЕ показываем уведомления
    if (!shouldShowNotification) return
    
    const options = {
      position: "top-right",
      autoClose: 4000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      icon: messageData.notifyAll ? "📢" : "🔔",
      
      // Современные стили
      style: {
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        borderRadius: '16px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        backdropFilter: 'blur(10px)',
        fontSize: '14px',
        fontWeight: '500',
      },
      
      // Анимации
      transition: 'bounce',
      
      // Прогресс бар
      progressStyle: {
        background: 'linear-gradient(90deg, #ff6b6b, #ffd93d)',
        height: '3px',
      }
    }
    
    const shortMessage = messageData.text.length < 50 
      ? messageData.text 
      : messageData.text.substring(0, 50) + '...'
    
      let notificationText = `${messageData.senderName}: ${shortMessage}`
      if (messageData.notifyAll) {
        notificationText = `Всем: ${notificationText}`
      }
      toast(notificationText, options)
  }
  
  const handleMentionNotification = (messageData) => {
    const shouldCount = (messageData.notifyAll || messageData.targetIp === currentUserId.value) && !isChatOpen.value
    
    if (shouldCount) {
      mentionCount.value++
      saveMentionCount()
    }
  }
  
  const handleGeneralNotification = (messageData) => {
    const shouldCount = (messageData.notifyAll || messageData.targetIp === currentUserId.value) && !isChatOpen.value
    
    if (shouldCount) {
      unreadCount.value++
      saveUnreadCount()
    }
  }
  
  // Socket listeners
  const setupSocketListeners = () => {
    if (!socketInstance.value) return
    
    socketInstance.value.on('CLIENT_IP', (ip) => {
      currentUserId.value = ip || 'unknown';
    })
  
    socketInstance.value.on('chat_history', (history) => {
      messages.value = history
    })
  
    socketInstance.value.on('chat_message', (messageData) => {
      // console.log('📩 RAW message from server:', JSON.parse(JSON.stringify(messageData)));
      
      const newMessage = {
        ...messageData,
        timestamp: new Date(messageData.timestamp),
        isMentioned: messageData.targetIp === currentUserId.value || messageData.notifyAll
      }
      
      
      messages.value.push(newMessage)
      
      if (!isChatOpen.value) {
        if (newMessage.notifyAll || newMessage.targetIp) {
          handleMentionNotification(newMessage)
          handleGeneralNotification(newMessage)
          showChatNotification(newMessage)
        }
      }
    })
  
    socketInstance.value.on('system_message', (messageData) => {
      systemMessages.value.push({
        text: messageData.text,
        timestamp: new Date()
      })
    })
  
    socketInstance.value.on('user_typing', (userData) => {
      const userId = userData.clientIp || userData.userId
      if (userId !== currentUserId.value) {
        const displayName = userData.senderName || userId
        usersTyping.value.add(displayName)
        typingUsers.value = Array.from(usersTyping.value)
      }
    })
  
    socketInstance.value.on('user_stop_typing', (userData) => {
      const userId = userData.clientIp || userData.userId
      if (userId !== currentUserId.value) {
        const displayName = userData.senderName || userId
        usersTyping.value.delete(displayName)
        typingUsers.value = Array.from(usersTyping.value)
      }
    })
  
    socketInstance.value.on('online_users', (data) => {
      try {
        if (typeof data === 'number') {
          onlineUsersCount.value = data
          onlineUsersIps.value = []
          return
        }
        
        if (data && typeof data === 'object') {
          onlineUsersCount.value = data.size || 0
          onlineUsersIps.value = Array.isArray(data.users) ? data.users : Array.from(data.users || [])
        }
      } catch (error) {
        console.error('Error processing online_users:', error)
      }
    })
  
    socketInstance.value.on('message_sent', () => {
      isLoading.value = false
    })
  }
  
  const cleanupSocketListeners = () => {
    if (socketInstance.value) {
      const events = [
        'CLIENT_IP', 'chat_history', 'chat_message', 'system_message',
        'user_typing', 'user_stop_typing', 'online_users', 'message_sent', 'message_error'
      ]
      events.forEach(event => socketInstance.value.off(event))
    }
  }
  
  const saveUnreadCount = () => {
    localStorage.setItem('chat_unread_count', unreadCount.value.toString())
  }
  
  const saveMentionCount = () => {
    localStorage.setItem('chat_mention_count', mentionCount.value.toString())
  }
  
  const loadUnreadCount = () => {
    const saved = localStorage.getItem('chat_unread_count')
    unreadCount.value = saved ? parseInt(saved) : 0
  }
  
  const loadMentionCount = () => {
    const saved = localStorage.getItem('chat_mention_count')
    mentionCount.value = saved ? parseInt(saved) : 0
  }
  
  const initializeChat = () => {
    loadUnreadCount()
    loadMentionCount()
    if (socketInstance.value) {
      socketInstance.value.emit('get_chat_history')
    }
  }
  
  return {
    // State
    isChatOpen,
    messages: allMessages,
    unreadCount,
    mentionCount,
    isLoading,
    typingUsers,
    onlineUsersCount,
    onlineUsersIps,
    currentUserId,
    mentionedUser,
    socketInstance,
    
    
    // Getters
    isMentioned,
    
    // Actions
    toggleChat,
    closeChat,
    openChat,
    sendMessage,
    sendTyping,
    sendStopTyping,
    setMentionedUser,
    clearMentionedUser,
    setSocket,
    initializeChat,
    cleanupSocketListeners
    }
})