<template>
  <div class="col">
    <div class="card shadow-sm position-relative h-100">
      <div class="led-box">
        <div :class="[!isOffline ? 'led-green' : 'led-red', { 'led-grey': !device.statusCode }]"></div>
      </div>
      <a :href="device.URL" target="_blank">
        <svg class="bd-placeholder-img card-img-top" width="100%" height="225" role="button" focusable="false">
          <title>{{ device.shortName }} {{ device.hwId }}</title>
          <rect width="100%" height="100%" fill="#55595c"/>
          <text x="50%" y="50%" fill="#eceeef" dy=".3em">{{ device.shortName }} {{ device.hwId }}</text>
        </svg>
      </a>
      <div v-if="isLoading" class="spinner-border spinner-border-sm position-absolute text-white" style="top:10px; left: 10px"></div>
      <div class="card-body">
        <p class="card-text">Connect to SSH: {{ device.sshContainer }}</p>
        <div class="d-flex justify-content-between align-items-center">
          <div class="btn-group flex-wrap">
            <button @click="consoleOpen" type="button" class="btn btn-sm btn-outline-secondary">
              <span>Console</span>
            </button>
            <button @click="resetConfig" :disabled="isLoading || isOffline" type="button" class="btn btn-sm btn-outline-secondary">
              <span>Reset config</span>
            </button>
            <button @click="rebootDevice" :disabled="isLoading || isOffline" type="button" class="btn btn-sm btn-outline-secondary">
              <span>Reboot</span>
            </button>
            <button v-if="device.dslPort" @click="resetDslLine" :disabled="isLoading || isOffline" type="button" class="btn btn-sm btn-outline-secondary">
              <span>Reset DSL line</span>
            </button>
            <button @click="showWanTypesModal" :disabled="isLoading || isOffline" type="button" class="btn btn-sm btn-outline-secondary">
              <span>WAN connection type</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <Modal :title="`${device.shortName} ${device.hwId}`" ref="wanTypesModal">
      <template #body>
        <div v-for="wan in wanTypes" class="form-check my-3 fs-5">
          <label class="form-check-label">
            <input v-model="wanTypesValues" :value="wan.vlanId" class="form-check-input" type="checkbox">
            {{ wan.type }}
          </label>
        </div>
      </template>
      <template #footer>
        <button @click="saveWanTypes" class="btn btn-primary" type="button" :disabled="isLoading || isOffline">
          <span v-if="isLoading" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
          <span role="status">Apply changes</span>
        </button>
      </template>
    </Modal>

  </div>
</template>

<script setup>
import {socket} from "@/socket.js";
import {computed, ref} from "vue";
import Modal from "@/components/Modal.vue";
import {toast} from "vue3-toastify";

const props = defineProps(['device', 'wanTypes'])
const isLoading = ref(false)
const isOffline = computed(() => props.device.statusCode !== 200)
const wanTypesModal = ref();
const wanTypesValues = ref([])
const {VITE_WEB_TELNET_IP} = import.meta.env

socket.on("device:status", (URL, status) => {
  if (props.device.URL === URL)
    props.device.statusCode = status
})

function resetConfig() {
  if (isOffline.value) return
  if (!confirm(`Do you really want to reset configuration ${props.device.hwId}?`)) return;
  isLoading.value = true
  socket.timeout(120000).emit('device:resetConfig', props.device.id, (error, response) => {
    if (error || response.status !== 'ok')
      toast.error(`Something went wrong ${props.device.shortName}: ${props.device.hwId}!`, {autoClose: false});
    else
      toast.success(`${props.device.shortName} ${props.device.hwId} successful configuration reset!`);

    isLoading.value = false
  });
}

function rebootDevice() {
  if (isOffline.value) return
  if (!confirm(`Do you really want to reboot ${props.device.hwId}?`)) return;
  isLoading.value = true
  socket.timeout(120000).emit('device:reboot', props.device.id, (error, response) => {
    if (error || response.status !== 'ok')
      toast.error(`Something went wrong ${props.device.shortName}: ${props.device.hwId}!`, {autoClose: false});
    else
      toast.success(`${props.device.shortName} ${props.device.hwId} was successfully rebooted!`);

    isLoading.value = false
  });
}

function resetDslLine() {
  if (isOffline.value) return
  isLoading.value = true
  socket.timeout(60000).emit('device:resetDslLine', props.device.id, (error, response) => {
    if (error || response.status !== 'ok')
      toast.error("Something went wrong!", {autoClose: false});
    else
      toast.success(`${props.device.shortName} ${props.device.hwId} successful reset DSL line!`);
    isLoading.value = false
  });
}

function showWanTypesModal() {
  wanTypesModal.value.show();
}

function saveWanTypes() {
  if (isOffline.value) return
  isLoading.value = true
  socket.timeout(60000).emit('device:wanTypes:save', props.device.id, wanTypesValues.value, (error, response) => {
    if (error || response.status !== 'ok') {
      toast.error(`Something went wrong!Check the console ${props.device.shortName}: ${props.device.hwId} is closed?`, {autoClose: false});
    } else {
      wanTypesModal.value.hide()
      toast.success(`${props.device.shortName} ${props.device.hwId} wan types have been changed!`);
    }
    isLoading.value = false
  });
}

function consoleOpen() {
  let params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`;
  window.open(`http://${VITE_WEB_TELNET_IP}/remote/telnet/telnet/${props.device.consolePort}`, props.device.hwId, params);
}
</script>
