<template>
  <div class="online-users-dropdown">
    <Popper 
      :arrow="true" 
      :hover="true" 
      :offset-distance="'8'"
      placement="bottom-start"
      class="users-popper"
      :force-show="true" 

    >
      <button class="users-trigger" @touchstart="handleTouchStart" @touchend="handleTouchEnd">
        <div class="users-avatar-stack">
          <div 
            v-for="user in visibleUsers" 
            :key="user.id"
            class="stacked-avatar"
            :style="{ backgroundColor: user.color }"
          >
            {{ user.initial }}
          </div>
          <div v-if="hiddenUsersCount > 0" class="more-users">
            +{{ hiddenUsersCount }}
          </div>
        </div>
        <i class="bi bi-chevron-down"></i>
      </button>
      
      <template #content>
        <div class="users-dropdown">
          <div class="dropdown-header">
            <h4>Участники онлайн</h4>
            <span class="users-count">{{ totalCount }}</span>
          </div>
          
          <!-- Кнопка "Упомянуть всех" -->
          <div class="mention-all-section">
            <button 
              class="mention-all-btn"
              @click="handleMentionAll"
              @touchstart="handleTouchStart"
              @touchend="handleTouchEnd"
            >
              <div class="mention-all-icon">
                <i class="bi bi-megaphone"></i>
              </div>
              <div class="mention-all-info">
                <span class="mention-all-name">@all</span>
                <span class="mention-all-desc">Уведомить всех участников</span>
              </div>
            </button>
          </div>
          
          <div class="users-list">
            <div
              v-for="user in users"
              :key="user.id"
              class="user-item"
              @click="handleUserClick(user)"
              @touchstart="handleTouchStart"
              @touchend="handleTouchEnd"
            >
              <div class="user-avatar" :style="{ backgroundColor: user.color }">
                <span class="avatar-initial">{{ user.initial }}</span>
                <div class="online-indicator"></div>
              </div>
              <div class="user-info">
                <span class="user-name">{{ user.name }}</span>
                <span class="user-ip">{{ user.ip }}</span>
              </div>
              <div class="user-actions">
                <button 
                  class="action-btn" 
                  title="Упомянуть" 
                  @click.stop="handleMentionUser(user)"
                  @touchstart="handleTouchStart"
                  @touchend="handleTouchEnd"
                >
                  <i class="bi bi-at"></i>
                </button>
              </div>
            </div>
          </div>
          
          <div v-if="users.length === 0" class="empty-state">
            <i class="bi bi-people"></i>
            <p>Нет пользователей онлайн</p>
          </div>
        </div>
      </template>
    </Popper>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Popper from 'vue3-popper'


const props = defineProps({
  users: Array,
  totalCount: Number
})

const emit = defineEmits(['user-click', 'mention-user'])

const visibleUsers = computed(() => props.users.slice(0, 3))
const hiddenUsersCount = computed(() => props.users.length - visibleUsers.value.length)

// Специальный объект для упоминания всех
const allUsersOption = {
  id: 'all',
  ip: 'all',
  name: 'all',
  initial: 'A',
  color: '#6366f1',
  status: 'all'
}

const handleUserClick = (user) => {
  emit('user-click', user)
}

const handleMentionUser = (user) => {
  emit('mention-user', user)
}

const handleMentionAll = () => {
  emit('mention-user', allUsersOption)
}

// Обработчики для мобильных устройств
const handleTouchStart = (event) => {
  event.currentTarget.style.transform = 'scale(0.98)'
  event.currentTarget.style.opacity = '0.8'
}

const handleTouchEnd = (event) => {
  event.currentTarget.style.transform = 'scale(1)'
  event.currentTarget.style.opacity = '1'
}
</script>

<style scoped>
.users-trigger {
display: flex;
align-items: center;
gap: 8px;
padding: 8px 12px;
background: rgba(255, 193, 7, 0.1);
border: 1px solid rgba(255, 193, 7, 0.3);
border-radius: 10px;
color: #ffc107;
cursor: pointer;
transition: all 0.2s ease;
backdrop-filter: blur(10px);
-webkit-tap-highlight-color: transparent;
touch-action: manipulation;
position: relative; 
z-index: 1;
}

.users-trigger:active {
  transform: scale(0.98);
  opacity: 0.8;
}

.users-trigger:hover {
  background: rgba(255, 193, 7, 0.2);
  border-color: #ffc107;
}

.users-avatar-stack {
  display: flex;
  align-items: center;
}

.stacked-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #343a40;
  margin-left: -8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: #343a40;
}

.stacked-avatar:first-child {
  margin-left: 0;
}

.more-users {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 193, 7, 0.8);
  border: 2px solid #343a40;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  margin-left: -8px;
  color: #343a40;
}

.online-users-dropdown {
position: relative;
z-index: 1000;
display: inline-block; /* Для правильного позиционирования */
}

/* Стилизуем только контейнер контента, не трогая триггер */
:deep(.popper #content) {
position: fixed !important;
z-index: 9999 !important;
}

:deep(.popper[data-popper-placement^="bottom"] #content) {
top: calc(100% + 8px) !important;
left: 0 !important;
}

:deep(.popper[data-popper-placement^="top"] #content) {
bottom: calc(100% + 8px) !important;
left: 0 !important;
}

:deep(.popper__arrow) {
z-index: 10000 !important;
}


.users-dropdown {
  width: 280px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  border: 1px solid #e2e8f0;
  z-index: 9999;
  position: relative;
  max-height: 80vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #f1f3f4;
  background: #f8fafc;
  position: sticky;
  top: 0;
  z-index: 1;
}

.dropdown-header h4 {
  margin: 0;
  font-size: 0.9rem;
  color: #1f2937;
  font-weight: 600;
}

.users-count {
  background: #ffc107;
  color: #343a40;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 700;
}

.mention-all-section {
  padding: 12px 16px;
  border-bottom: 1px solid #f1f3f4;
  background: #f8fafc;
  position: sticky;
  top: 57px; /* Высота dropdown-header */
  z-index: 1;
}

.mention-all-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  background: white;
  border: 2px dashed #e2e8f0;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.mention-all-btn:active {
  transform: translateY(0);
  opacity: 0.8;
}

.mention-all-btn:hover {
  border-color: #6366f1;
  background: #f0f4ff;
  transform: translateY(-2px);
}

.mention-all-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.2rem;
}

.mention-all-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.mention-all-name {
  font-weight: 700;
  color: #1f2937;
  font-size: 0.9rem;
}

.mention-all-desc {
  font-size: 0.75rem;
  color: #6b7280;
}

.users-list {
  max-height: 300px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  border-bottom: 1px solid #f8fafc;
}

.user-item:last-child {
  border-bottom: none;
}

.user-item:active {
  background: #e5e7eb;
  opacity: 0.8;
}

.user-item:hover {
  background: #f8fafc;
}

.user-avatar {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #343a40;
  font-size: 0.9rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.avatar-initial {
  line-height: 1;
}

.online-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  background: #10b981;
  border: 2px solid white;
  border-radius: 50%;
}

.user-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-name {
  font-size: 0.9rem;
  font-weight: 500;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-ip {
  font-size: 0.75rem;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-actions {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.user-item:hover .user-actions {
  opacity: 1;
}

.action-btn {
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.action-btn:active {
  transform: scale(0.9);
  opacity: 0.8;
}

.action-btn:hover {
  background: #ffc107;
  color: #343a40;
  transform: scale(1.1);
}

.empty-state {
  padding: 32px 16px;
  text-align: center;
  color: #9ca3af;
  background: #f8fafc;
}

.empty-state i {
  font-size: 2rem;
  margin-bottom: 8px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: 0.9rem;
}

/* Стили для скроллбара */
.users-list::-webkit-scrollbar {
  width: 6px;
}

.users-list::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.users-list::-webkit-scrollbar-thumb {
  background: #ffc107;
  border-radius: 3px;
}

.users-list::-webkit-scrollbar-thumb:hover {
  background: #ffb300;
}

.users-dropdown::-webkit-scrollbar {
  width: 6px;
}

.users-dropdown::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.users-dropdown::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.users-dropdown::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

@media (max-width: 768px) {
  .users-dropdown {
    width: 90vw;
    max-width: 300px;
    max-height: 70vh;
  }
  
  .dropdown-header,
  .mention-all-section {
    position: sticky;
    background: #f8fafc;
  }
  
  .dropdown-header {
    top: 0;
  }
  
  .mention-all-section {
    top: 57px;
  }
  
  .user-item {
    padding: 14px 16px;
  }
  
  .user-actions {
    opacity: 1; /* Всегда показываем действия на мобильных */
  }
}
</style>