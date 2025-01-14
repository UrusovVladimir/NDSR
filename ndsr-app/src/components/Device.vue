<template>
  <div class="col">
    <div class="card shadow-sm position-relative h-100 justify-content-between">
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
      
      
      <div class="justify-content-between" style="width: auto; height: auto;padding: 1.5%;padding-bottom: 0.5%;">
              <span v-show="device.type==='router'" class="badge rounded-pill bg-secondary" style="height:auto; width: auto;text-align: center">Connect to SSH: {{ device.sshContainer }}</span>
                <span v-if="!displayCheckedWanTypeIds.length || displayCheckedWanTypeIds.length === 0" class="badge rounded-pill bg-secondary" style="height:auto; width: auto;"></span>
                <span v-else class="badge rounded-pill bg-secondary" style="height:auto; width: auto;"></span>
                <span v-show="device.type==='router'" class="badge rounded-pill bg-secondary" style="height:1.50rem; width: auto;">
                  WAN Type: {{ wanTypeValue }}  
                  <Popper style="height: auto; width: auto;"
                    :offset-distance="offsetDistance + ''"
                    :content="currentWanType"
                    :arrow="true"
                    :hover="true"> <svg style="padding-left:1px;" width="14" height="14"><use xlink:href="/img/info.svg#info-fill"/></svg>
                  </Popper>
                </span>
                <span v-show="device.type==='AP'"  class="badge rounded-pill bg-secondary" style="height:auto; width: auto;text-align: center">
                  AP Connected to MWS Router: {{ currentMwsRouter }}   
                  <Popper style="height: auto; width: auto;"
                    :offset-distance="offsetDistance + ''"
                    :content="currentWanType"
                    :arrow="true"
                    :hover="true"> <svg style="padding-left:1px;" width="14" height="14"><use xlink:href="/img/info.svg#info-fill"/></svg>
                  </Popper>
                </span>
      </div> 
            <div class="d-flex justify-content-between align-items-center">
           <div class="btn-group flex-wrap flex-item">
            <button @click="consoleOpen" type="button" class="btn btn-sm btn-outline-secondary">
              <span>Console</span>
            </button>
            <button @click="resetConfig" type="button" class="btn btn-sm btn-outline-secondary">
              <span>Reset config</span>
            </button>
            <button @click="rebootDevice" :disabled="isLoading || isOffline" type="button" class="btn btn-sm btn-outline-secondary">
              <span>Reboot</span>
            </button>
            <button v-if="device.dslPort" @click="resetDslLine" :disabled="isLoading || isOffline" type="button" class="btn btn-sm btn-outline-secondary">
              <span>Reset DSL line</span>
            </button>
            <button v-if="device.type === 'router'" @click="showWanTypesModal" :disabled="isLoading || isOffline" type="button" class="btn btn-sm btn-outline-secondary">
              <span>WAN connection type</span>
            </button>
            <button v-if="device.type === 'AP'" @click="showMwsModal" type="button" class="btn btn-sm btn-outline-secondary">
              <span>Connection to router for MWS</span>
            </button >
          </div>
          
        </div>
        <div  v-if="device.type === 'router'" class="d-flex justify-content-between align-items-center">
           <div class="btn-group flex-wrap flex-item">
             <button  @click="vncOpen" :disabled="isLoading || isOffline"  type="button" class="btn btn-sm btn-outline-secondary">
              <span>Remote Desktop</span>
            </button>
           </div>
          </div>
        </div>
      </div>
    

    <Modal :title="`WAN connection type for ${device.shortName} ${device.hwId}`" ref="wanTypesModal">
      <template #body>
        <div v-for="wan in wanTypes" class="form-check my-3 fs-5">
          <label class="form-check-label">
            <input v-if="wan.type" v-model="wanTypesValues" :value="wan.vlanId" class="form-check-input" type="checkbox">
            {{ wan.type }}
          </label>
        </div>
        <div v-if=anyWanSelected() class="alert alert-primary d-flex align-items-center" role="alert" style="font-family: Segoe UI, sans-serif;font-size: 1.1rem;">
            <div>
              <img src="/img/alert.svg">
                You can choose only one type
            </div>
        </div>
        
        <div v-if="wanTypesValues.length === 0" class="alert alert-success d-flex align-items-center" role="alert">
            <svg class="bi flex-shrink-0 me-2" width="24" height="24"><use xlink:href="/img/info.svg#info-fill"/></svg>
          <div style="font-family: Segoe UI, sans-serif;font-size: 0.95rem;">
            Press apply button without choosing the value to reset the WAN type!
          </div>
        </div>
      </template>
      <template #footer>
        <button @click="saveWanTypes" class="btn btn-primary" type="button" :disabled="isLoading || isOffline || anyWanSelected()">
          <span v-if="isLoading" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
          <span role="status">Apply changes</span>
        </button>
      </template>
    </Modal>


  <ModalLan :title="`Connecting the ${device.shortName} ${device.hwId} extender to:`" ref="lanMwsModal">
    <template #body>
      <div v-for="dev in filteredDevices" class="form-check" :key="dev.hwId" style="font-family: Segoe UI, sans-serif;font-size: 1.1rem;">
         <label v-if="dev.type" class="form-check-label">
          <input  v-model="lanMwsModalValue" :value="dev.id" class="form-check-input" type="radio">
          {{ dev.hwId }} {{ dev.shortName }}
        </label>
      </div>
    </template>
    <template #footer>
    <div class="btn-group" role="group" aria-label="Group Button">
      <button @click="saveMwsDevice()" class="btn btn-primary" type="button" :disabled="isLoading" >
        <span v-if="isLoading" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        <span role="status">Connect</span>
      </button>
      <button @click="saveMwsDevice('disconnect')" type="button" class="btn btn-secondary" :disabled="isLoading || lanMwsModalValue.length === 0">
        <span role="status" >Disconnect</span>
      </button>
    </div>
    </template>
  </ModalLan>

</template>

<script setup>
import {socket} from "@/socket.js";
import {computed, ref,watch} from "vue";
import Modal from "@/components/Modal.vue";
import ModalLan from "@/components/ModalLan.vue";
import {toast} from "vue3-toastify";
import {onMounted} from "vue";
import Popper from "vue3-popper";


const props = defineProps(['device','wanTypes','filteredDevices'])
const isLoading = ref(false)
const isOffline = computed(() => props.device.statusCode !== 200)
const wanTypesModal = ref();
const lanMwsModal = ref();
const lanMwsModalValue = ref([]);
const currentWan = ref([]);
const wanTypesValues = ref([]);
const displayCheckedWanTypeIds = ref([]);
const {VITE_WEB_TELNET_IP} = import.meta.env
const offsetDistance = ref(15);
const displayCheckMwsRouterId = ref([])




const wanTypeValue = computed(() => {
  if (displayCheckedWanTypeIds.value.length === 0) {
    return currentWan.value.vlan || "None  ";
  } else {
    return displayCheckedWanTypeIds.value.join(', ');
  }
});

function infoWanType(vlanId) {
  if(vlanId != null){
    let info = props.wanTypes.find(wan => String(wan.vlanId) === String(vlanId));
    return info ? info.type : null;}
  }

const currentWanType = computed(() => {
    return infoWanType(wanTypeValue.value) || "ISP not configured!";
  });




function infoMwsRouter(id){
  if (id === "None" || id === {}){
    return "None"; 
  }
  else{
  let info = props.filteredDevices.find(device => String(device.id) === String(id));
    return info ? info.hwId : info.hwId; }
}




const currentMwsRouter = computed(() => {
  if (displayCheckMwsRouterId.value.length === 0){
    // console.log("Сейчас ноль!")
    return displayCheckMwsRouterId.value || "None"
  }
  else{
  return infoMwsRouter(displayCheckMwsRouterId.value)
}})


socket.on('device:currentMwsRouter',(currentMwsRouter,connectDisconnectAp) =>{
  if (connectDisconnectAp === 'None'){
    displayCheckMwsRouterId.value = currentMwsRouter
  }
  else{
    displayCheckMwsRouterId.value = currentMwsRouter
  }
})

function anyWanSelected() {
       return wanTypesValues.value.length > 1;
   }
   

socket.on("device:status", (id,URL, status) => {
  if (props.device.URL === URL)
    props.device.statusCode = status
})


socket.on('device:checkWan', (deviceId, checkedWanTypeIds) => {
    if (deviceId === props.device.id) {
        displayCheckedWanTypeIds.value = checkedWanTypeIds;
    }
});

socket.on('device:currentWanType', (deviceId, value) => {
    if (deviceId === props.device.id){
      currentWan.value = getKeyValueByDeviceId(value)
    }
});

socket.on('device:checkMws', (extenderId, routerId) =>{
  displayCheckMwsRouterId.value = routerId
  console.log(routerId)
})


function getKeyValueByDeviceId(value) {
  for (const key in value) {
    if (value.hasOwnProperty(key) && key === props.device.id) {
      return {
        device: key,
        vlan: value[key][0]
      };
    }
  }
  return { device: null, vlan: "None" };
}

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

function showMwsModal() {
  lanMwsModal.value.show()
}

function saveWanTypes(disconnect) {
  if (isOffline.value) return
  console.log(disconnect)
  isLoading.value = true  
  socket.timeout(60000).emit('device:wanTypes:save', props.device.id, wanTypesValues.value, (error, response) => {
    if (error || response.status !== 'ok') {
      toast.error(`Something went wrong!Failed connection to ${props.device.shortName}: ${props.device.hwId}`, {autoClose: false});
    } else {
      wanTypesModal.value.hide()
      toast.success(`WAN type for ${props.device.shortName} ${props.device.hwId} have been changed!`,{autoClose: true});
    }
    isLoading.value = false
  });
}

function saveMwsDevice(disconnect) {
  isLoading.value = true  
  socket.timeout(6000).emit('device:mwsConnected',props.device.id,lanMwsModalValue.value, disconnect ? disconnect:null,(error, response) => {
    let sowHwId = infoMwsRouter(lanMwsModalValue.value)
    if (error || response.status !== 'ok'){
      toast.error(`Could not evoke connection for ${sowHwId}`,{autoClose: false});
    }
    else {
      lanMwsModal.value.hide();
      disconnect ? toast.success(`Disconnection completed from: ${sowHwId}`,{autoClose: true}) : toast.success(`Connection completed to: ${sowHwId}`,{autoClose: true})
    }
    isLoading.value = false
  });
  
}

function consoleOpen() {
  let params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`;
  window.open(`http://${VITE_WEB_TELNET_IP}/remote/telnet/telnet/${props.device.consolePort}`, props.device.hwId, params);
}

function vncOpen() {
  let params = `scrollbars=no,resizable=no,status=no,location=no,toolbar=no,menubar=no,width=900,height=600,left=200,top=100`;
  window.open(`${props.device.vncUrl}`, props.device.hwId, params);
}
</script>
