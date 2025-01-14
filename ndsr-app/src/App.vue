<template>
  <div>
    <header>
      <div class="collapse bg-dark" id="navbarHeader"></div>
      <div class="navbar navbar-dark bg-dark shadow-sm">
        <div class="container">
          <div class="navbar-brand d-flex align-items-center">
            <img src="/img/logo.svg" width="100%" height="100%">
          </div>
           <form class="d-flex">
            <input v-model="searchQuery" class="form-control me-2" type="search" placeholder="Search Device" aria-label="Search Device">
           </form>
        </div>
      </div>
    </header>
    <div v-if="isLoading" class="d-flex justify-content-center mt-5">
      <div class="spinner-border" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>
    <main v-else>
      <div class="album py-5 bg-light">
        <div class="container">
          <div class="row row-cols-1 row-cols-sm-2 row-cols-md-3 g-3">
            <template v-if="devices">
              <card v-for="device in filteredDevices" :filtered-devices="routerDevices" :device="device" :wan-types="wanTypes"/>
            </template>
          </div>
        </div>
      </div>
      <section class="text-muted py-5" style="margin-top: -2rem;">
        <!-- <div class="d-flex justify-content-center">
          <button class="btn btn-primary my-2" disabled>Reset ALL devices</button>
        </div> -->
        <div class="container">
          <p class="float-end mb-1">
            <a class="btn btn-secondary"  href="#">^</a>
          </p>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import card from "@/components/Device.vue"
import {socket} from "@/socket";
import {ref,computed} from "vue";

let isLoading = ref(true);
let devices = ref([]);
const wanTypes = ref([]);
const searchQuery = ref("");
const routerDevices = computed(() => devices.value.filter(device => device.type === 'router'));


socket.on("device:list", (data) => {
  devices.value = data
  isLoading.value = false
})

socket.on("device:statuses", (data) => {
  devices.value.forEach((device, key) => {
    if (device.checkUrl in data)
      devices.value[key].statusCode = data[device.checkUrl]
  })
})

socket.on('device:wanTypes', (data) => {
  wanTypes.value = data})

const filteredDevices = computed(() => {
  if (!searchQuery.value) return devices.value;
  return devices.value.filter(device => 
    device.hwId.includes(searchQuery.value) || 
    device.id.includes(searchQuery.value) || device.shortName.includes(searchQuery.value)
  );
});


</script>


<style scoped>
.spinner-border {
  width: 6rem;
  height: 6rem;
}
</style>
