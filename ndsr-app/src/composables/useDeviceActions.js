import { ref } from 'vue'
import { socket } from '@/socket'
import { toast } from 'vue3-toastify'

export function useDeviceActions(device, isOffline) {
    const isLoading = ref(false)
    
    const resetConfig = () => {
        if (!confirm(`Do you really want to reset configuration ${device.hwId}?`)) return
        isLoading.value = true
        socket.timeout(120000).emit('device:resetConfig', device.id, (error, response) => {
            if (error || response.status !== 'ok')
                toast.error(`Reset config for ${device.shortName}: ${device.hwId} done, but something went wrong device is not access!`, { autoClose: false })
            else
                toast.success(`${device.shortName} ${device.hwId} successful configuration reset!`, { autoClose: 3000, hideProgressBar: false })
            isLoading.value = false
        })
    }

    const rebootDevice = () => {
        if (isOffline.value) return
        if (!confirm(`Do you really want to reboot ${device.hwId}?`)) return
        isLoading.value = true
        socket.timeout(120000).emit('device:reboot', device.id, (error, response) => {
            if (error || response.status !== 'ok')
                toast.error(`Something went wrong ${device.shortName}: ${device.hwId}!`, { autoClose: false })
            else
                toast.success(`${device.shortName} ${device.hwId} was successfully rebooted!`, { autoClose: 3000, hideProgressBar: false })
            isLoading.value = false
        })
    }

    const resetDslLine = () => {
        if (isOffline.value) return
        isLoading.value = true
        socket.timeout(60000).emit('device:resetDslLine', device.id, (error, response) => {
            if (error || response.status !== 'ok')
                toast.error("Something went wrong!", { autoClose: false })
            else
                toast.success(`${device.shortName} ${device.hwId} successful reset DSL line!`, { autoClose: 3000, hideProgressBar: false })
            isLoading.value = false
        })
    }


    const initializationDevice = (password) => {
        if (isOffline.value) {
          toast.error(`Device ${device.hwId} is offline. Cannot initialize.`);
          return;
        }
      
        const host = device.URL;
        const url = `${host}/rci/`;
      
        socket.timeout(30000).emit(
            'device:init',
            {
              url: `${url}`,
              body: [
              { "eula": { "accept": {} }},
              {"dpn": {"accept": {}}},
              {"easyconfig": {"disable": true}},
              {"user":{"password":{"plain":{"name":"admin","password":`${password}`}}}},
              {"system": {"configuration": {"save": true}}
            }
            ]},
            (error,response) => {
              console.log('Initialization request sent to:',response);
              isLoading.value = false;
              
              if (!response) {
                toast.error('Ответ сервера пуст.');
                console.error('Null response. Possible reasons:', {
                  socketConnected: socket.connected,
                  eventRegistered: socket.hasListeners('device:init')
                });
                return;
              }
              if (error) {
                toast.error('Ошибка при обращении к устройству.');
                console.error('Initialization error:', error);
                return;
              }
              console.log('Full server response:', response);
              if (response.success) {
                navigator.clipboard.writeText(password);
                console.log('Password copied to clipboard');
                toast.success(`${device.hwId} device initialization complete! The password was copied to your clipboard.` , { autoClose: 3000, hideProgressBar: false });
              } else if (response.error.includes('Unexpected token')) {
                toast.error(`Device ${device.hwId} initialization failed! Password is set.`, { autoClose:false });
              }
            }
          );
    }
    
    return {
        isLoading,
        resetConfig,
        rebootDevice,
        resetDslLine,
        initializationDevice
    }
}