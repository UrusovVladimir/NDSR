<template>
    <div v-if="isVisible" class="popup-overlay" @click.self="close">
      <div class="popup-content">
        <h2 class="title">Select time to book</h2>
  
        <div class="slider-container">
          <input
            type="range"
            v-model="sliderValue"
            :min="1"
            :max="maxSteps"
            step="1"
            class="time-slider"
          />
  
          <div class="slider-labels">
            <span>30 min</span>
            <span>{{ totalMinutes }} min</span>
          </div>
  
          <div class="selected-time">
            Select:
            <strong>{{ sliderValue * 30 }} {{ formatMinutes(sliderValue * 30) }}</strong>
          </div>
        </div>
  
        <div class="popup-actions">
          <button @click="close" class="cancel-btn">Cancel</button>
          <button @click="confirmTime" class="confirm-btn">Book</button>
        </div>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue';
  

  const props = defineProps({
    isVisible: Boolean,
    isBookedByCurrentUser: Boolean,
  });
  const emit = defineEmits(['close', 'confirm','reset-toggle']);
  
  // Вычисляем максимально допустимое количество шагов по 30 минут до полуночи
  const now = new Date();
  const minutesUntilMidnight = (24 * 60) - (now.getHours() * 60 + now.getMinutes());
  const maxSteps = Math.floor(minutesUntilMidnight / 30);
  const totalMinutes = maxSteps * 30;
  const sliderValue = ref(1); // 30 минут по умолчанию
  
  const formatMinutes = (minutes) => {
    const lastDigit = minutes % 10;
    if (minutes >= 11 && minutes <= 19) return 'минут';
    if (lastDigit === 1) return 'минута';
    if (lastDigit >= 2 && lastDigit <= 4) return 'минуты';
    return 'минут';
  };
  
  function close() {
  if (!props.isBookedByCurrentUser) {
    emit('reset-toggle'); 
  }
  emit('close');
}
  
  function confirmTime() {
    const totalSeconds = sliderValue.value * 30 * 60;
    console.log('Total seconds:', totalSeconds);
    emit('confirm', totalSeconds);
    // close();
  }
  </script>
  
  <style scoped>
.popup-overlay {
  position:absolute;
  inset: 0;
  background: transparent;
  display: flex;
  align-items: baseline;
  margin-top: 30px;
  justify-content: center;
  z-index: 9999;
  
}
.popup-content {
  pointer-events: auto;
  background: #fff;
  padding: 24px;
  border-radius: 16px;
  max-width: 420px;
  width: 90%;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  animation: fadeIn 0.3s ease-out;
  box-sizing: border-box;
  overflow: hidden;
}

@media (max-width: 500px) {
  .popup-content {
    width: 95%;
    padding: 20px;
  }
}
  
  .title {
    font-size: 20px;
    margin-bottom: 20px;
    font-weight: 600;
    text-align: center;
  }
  
  .slider-container {
    margin: 20px 0;
  }
  
  .time-slider {
    width: 100%;
    height: 8px;
    -webkit-appearance: none;
    appearance: none;
    background: #e0e0e0;
    border-radius: 4px;
    outline: none;
  }
  
  .time-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    background: #ffc107 !important;
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.3s;
  }
  
  .time-slider::-webkit-slider-thumb:hover {
    background: #ffc107;
  }
  
  .slider-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    color: #777;
    font-size: 12px;
  }
  
  .selected-time {
    text-align: center;
    margin-top: 14px;
    font-size: 16px;
    color: #333;
  }
  
  .popup-actions {
  display: flex;
  justify-content: center; /* центрирование по горизонтали */
  align-items: center; /* центрирование по вертикали (если нужно) */
  gap: 10px; /* отступ между кнопками */
  padding: 10px; /* отступ внутри контейнера (опционально) */
}
  
  .cancel-btn,
  .confirm-btn {
  flex: 1 1 auto;
  min-width: 120px;
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 200;
  font-size: 14px;
  cursor: pointer;
  transition: 0.2s;
}
  
  .cancel-btn {
    background: transparent;
    border: 1px solid #ccc;
    color: #555;
    
  }
  
  .cancel-btn:hover {
    border-color: #999;
  }
  
  .confirm-btn {
    background: #ffc107;
    border: none;
    color: white;
    
  }
  
  .confirm-btn:hover {
    background: #43a047;
  }
  
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-40px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }


  </style>
  