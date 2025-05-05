import {devices} from "../devices.js";

function resetAllDevice(isLoading, toast) {
  devices.forEach(device => {
    resetConfig(device, isLoading, toast);
  });
}




function resetConfig(device, isLoading, toast) {
  if (!confirm(`Do you really want to reset configuration ${device.hwId}?`)) return;

  isLoading.value = true;

  socket.timeout(90000).emit('device:resetConfig', device.id, (error, response) => {
    if (error || response.status !== 'ok') {
      toast.error(
        `Reset config for ${device.shortName}: ${device.hwId} done, but something went wrong. Device is not accessible!`,
        { autoClose: false }
      );
    } else {
      toast.success(
        `${device.shortName} ${device.hwId} successful configuration reset!`,
        { autoClose: 3000, hideProgressBar: false }
      );
    }

    isLoading.value = false;
  });
}


export {resetAllDevice,
        resetConfig
}
