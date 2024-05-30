<template>
  <div class="modal" tabindex="-1" ref="modalElement">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ title }}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <slot name="body"/>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
            Close
          </button>
          <slot name="footer"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {onMounted, ref} from "vue";
import {Modal} from "bootstrap";

defineProps({
  title: {
    type: String,
  },
});

let modalElement = ref(null);
let thisModalObj = null;

onMounted(() => {
  thisModalObj = new Modal(modalElement.value);
});

function _show() {
  thisModalObj.show();
}

function _hide() {
  thisModalObj.hide();
}

defineExpose({show: _show, hide: _hide});

</script>
