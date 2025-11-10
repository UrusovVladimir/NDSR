<template>
  <button 
    class="chat-toggle-btn"
    @click="$emit('toggle')"
    :data-count="unreadCount"
    aria-label="Toggle chat"
  >
    <i class="bi" :class="isOpen ? 'bi-x-lg' : 'bi-chat-dots'"></i>
  </button>
</template>

<script setup>
defineProps({
  isOpen: Boolean,
  unreadCount: {
    type: Number,
    default: 0
  }
})

defineEmits(['toggle'])
</script>

<style scoped>
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
  -webkit-tap-highlight-color: transparent; /* Убирает подсветку при тапе на iOS */
}

.chat-toggle-btn:hover {
  background: linear-gradient(135deg, #495057, #5a6268);
  border-color: #ffd54f;
  color: #ffd54f;
  transform: scale(1.1);
  box-shadow: 0 6px 25px rgba(255, 193, 7, 0.2);
}

.chat-toggle-btn:focus {
  outline: none;
  border-color: #ffd54f;
  box-shadow: 
    0 0 0 3px rgba(255, 193, 7, 0.1),
    0 4px 20px rgba(255, 193, 7, 0.2);
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

@media (max-width: 768px) {
  .chat-toggle-btn {
    width: 56px;
    height: 56px;
    bottom: 16px;
    right: 16px;
    z-index: 1000; 
  }
  
  .chat-toggle-btn:focus {
    box-shadow: 0 0 0 3px rgba(255, 193, 7, 0.2);
  }
}
</style>