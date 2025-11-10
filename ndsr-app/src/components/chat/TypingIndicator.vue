<template>
    <div class="typing-row">
      <span class="typing-text">
        {{ users.join(', ') }} печатает
      </span>
      <span class="typing-dots">
        <span></span><span></span><span></span>
      </span>
    </div>
  </template>
  
  <script setup>
  defineProps({
    users: Array
  })
  </script>
  
  <style scoped>
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
  </style>