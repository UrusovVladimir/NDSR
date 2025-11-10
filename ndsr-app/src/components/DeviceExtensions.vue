<template>
    <div class="device-extensions">
      <Chip 
        v-if="hasExtensions"
        :label="extensionsText"
        icon="pi pi-plug"
        class="extensions-chip"
      />
      <span v-else class="text-color-secondary">None</span>
    </div>
  </template>
  
  <script setup>
  import { computed } from 'vue'
  import Chip from 'primevue/chip'
  
  const props = defineProps({
    device: Object
  })
  
  const hasExtensions = computed(() => {
    return props.device.modem || props.device.phone
  })
  
  const extensionsText = computed(() => {
    const parts = []
    if (props.device.modem) parts.push(props.device.modem)
    if (props.device.phone) parts.push(props.device.phone)
    return parts.length ? parts.join(', ') : 'None'
  })
  </script>
  
  <style scoped>
  .extensions-chip {
    font-size: 0.75rem;
  }
  </style>