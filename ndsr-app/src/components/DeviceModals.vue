<template>
  <Modal :title="modalTitle" ref="modalRef">
    <template #body>
      <!-- WAN Types Modal -->
      <div v-if="modalType === 'wanTypes'">
        <div v-for="wan in filteredWanTypes" :key="wan.vlanId" class="form-check my-3 fs-5">
          <label class="form-check-label">
            <input 
              v-model="modalValue" 
              :value="wan.vlanId" 
              class="form-check-input" 
              type="radio"
              @change="updateSelection"
            >
            {{ wan.type }}
          </label>
        </div>

        <div v-if="showPPPoECredentials" class="alert alert-success d-flex align-items-center mt-3" role="alert">
          <svg class="bi flex-shrink-0 me-2" width="24" height="24"><use xlink:href="/img/info.svg#info-fill"/></svg>
          <div>
            Login: <b>support</b> Password: <b>support2019</b>
          </div>
        </div>

        <div v-if="showResetHint" class="alert alert-success d-flex align-items-center mt-3" role="alert">
          <svg class="bi flex-shrink-0 me-2" width="24" height="24"><use xlink:href="/img/info.svg#info-fill"/></svg>
          <div style="font-family: Segoe UI, sans-serif;font-size: 0.95rem;">
            Please select <b>"Clear WAN type"</b> to disconnect all WAN connections!
          </div>
        </div>
      </div>
  
      <!-- MWS Connection Modal -->
      <div v-if="modalType === 'mwsConnection'">
        <div v-for="dev in filteredDevices" class="form-check" :key="dev.hwId" style="font-family: Segoe UI, sans-serif;font-size: 1.1rem;">
         <label v-if="dev.type === 'router'" class="form-check-label">
          <input  v-model="modalValue" :value="dev.id" class="form-check-input" type="radio">
          {{ dev.hwId }} {{ dev.shortName }}
        </label>
        </div>
      </div>

      <!-- DSL Settings Modal -->
      <div v-if="modalType === 'dslSettings'">
        <div v-for="wan in filteredWanTypes" :key="wan.description" class="form-check my-3 fs-5">
          <label class="form-check-label">
            <input v-model="modalValue" :value="wan.description" class="form-check-input" type="radio">
            {{ wan.description }}
          </label>
        </div>
      </div>
    </template>
  
    <template #footer v-if="modalType === 'wanTypes'">
      <button @click="closeModal" type="button" class="btn btn-secondary">
        Close
      </button>
      <button @click="saveChanges" class="btn btn-primary" type="button" :disabled="isLoading">
        <span v-if="isLoading" class="spinner-border spinner-border-sm me-2"></span>
        Apply changes
      </button>
    </template>
    <template #footer v-if="modalType === 'mwsConnection'">
      <button @click="closeModal" type="button" class="btn btn-secondary">
        Close
      </button>
      <div class="btn-group" role="group" aria-label="Group Button">
        <button @click="saveChanges('connect')" class="btn btn-primary" type="button" :disabled="isLoading" >
          <span v-if="isLoading" class="spinner-border spinner-border-sm me-2" inert="true"></span>
          <span role="status">Connect</span>
        </button>
        <button @click="saveChanges('disconnect')" type="button" class="btn btn-secondary" :disabled="isLoading">
          <span role="status">Disconnect</span>
        </button>
      </div>
    </template>
  </Modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import Modal from '@/components/Modal.vue'
import { toast } from 'vue3-toastify'

const props = defineProps({
  device: Object,
  wanTypes: {
    type: Array,
    default: () => [],
    required: true
  },
  filteredDevices: {
    type: Array,
    default: () => [],
    required: true
  },
  currentWanType: String
})

// console.log('WAN Types data:', JSON.parse(JSON.stringify(props.wanTypes)))
// console.log('Devices data:', JSON.parse(JSON.stringify(props.filteredDevices)))
const emit = defineEmits(['save'])

const modalRef = ref(null)
const modalValue = ref(null)
const modalType = ref('')
const isLoading = ref(false)
const showPPPoECredentials = ref(false)
const showResetHint = ref(true)

const modalTitle = computed(() => {
  switch (modalType.value) {
    case 'wanTypes': 
      return `WAN connection type for ${props.device.shortName} ${props.device.hwId}`
    case 'mwsConnection':
      return `Connecting the ${props.device.shortName} ${props.device.hwId} extender to:`
    case 'dslSettings':
      return `DSL settings for the ${props.device.shortName} ${props.device.hwId}`
    default:
      return ''
  }
})

const filteredWanTypes = computed(() => {
  if (modalType.value === 'wanTypes') {
    return props.wanTypes.filter(wan => 
      wan.vlanId !== undefined && 
      wan.vlanId !== null && 
      wan.type?.trim() !== ""
    )
  } else if (modalType.value === 'dslSettings') {
    return props.wanTypes.filter(wan => 
      wan.description?.trim() !== ""
    )
  }
  return []
})

const filteredDevices = computed(() => {
  return props.filteredDevices.filter(dev => 
    dev.id && 
    dev.hwId && 
    dev.shortName
  )
})

watch(modalValue, (newVal) => {
  showPPPoECredentials.value = newVal === '747'
  showResetHint.value = newVal === null
})

const show = (type, initialValue = null) => {
  modalType.value = type
  modalValue.value = initialValue
  modalRef.value?.show()
  
  // Debug
  // console.log('Modal type:', type)
  // console.log('Filtered WAN types:', filteredWanTypes.value)
  // console.log('Filtered devices:', filteredDevices.value)
}

const closeModal = () => {
  modalValue.value = null
  modalRef.value?.hide()
}


const saveChanges = async (action) => {
  isLoading.value = true;
  try {
    await new Promise((resolve, reject) => {
      emit('save', {
        value: modalValue.value,
        type: modalType.value,
        action,
        callback: (success, error) => {
          if (success) {
            resolve();
          } else {
            reject(new Error(error));
          }
        }
      });
      // console.log('Changes applied for', modalType.value);
    });

    toast.success(`Changes applied for ${props.device.hwId} successfully`, {
      autoClose: 3000,
      hideProgressBar: false
    });
    closeModal();
  } catch (error) {
    console.error('Save error:', error);
    toast.error(`Failed to apply changes for ${props.device.hwId}: ${error.message}`, {
      autoClose: 5000,
      hideProgressBar: false
    });
  } finally {
    isLoading.value = false;
  }
};






defineExpose({ show })
</script>