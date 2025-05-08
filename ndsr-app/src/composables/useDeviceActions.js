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
                toast.error(`Reset config for ${device.shortName}: ${device.hwId} done, but something went wrong device is not access!`, { autoClose: 4000, hideProgressBar: false })
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
                toast.error(`Something went wrong ${device.shortName}: ${device.hwId}!`, { autoClose: 4000, hideProgressBar: false })
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
                toast.error("Something went wrong!", { autoClose: 4000, hideProgressBar: false })
            else
                toast.success(`${device.shortName} ${device.hwId} successful reset DSL line!`, { autoClose: 3000, hideProgressBar: false })
            isLoading.value = false
        })
    }


    const initializationDevice = async (password) => {
      if (isOffline.value) {
        toast.error(`Device ${device.hwId} is offline. Cannot initialize.`, { autoClose: 4000, hideProgressBar: false });
        return;
      }
    
      const host = device.checkUrl;
      const url = `${host}/rci/`;
      
      try {
        isLoading.value = true;
        
        const response = await new Promise((resolve, reject) => {
          socket.timeout(30000).emit(
            'device:init',
            {
              url: `${url}`,
              body: [
                { "eula": { "accept": {} }},
                {"dpn": {"accept": {}}},
                {"easyconfig": {"disable": true}},
                {"user":{"password":{"plain":{"name":"admin","password":`${password}`}}}},
                {"user":{"password":{"name":"admin","password":`${password}`}}},
                {"system": {"configuration": {"save": true}}}
              ]
            },
            (error, response) => {
              if (error) reject(error);
              else resolve(response);
            }
          );
        });
    
        // console.log('Initialization response:', response);
    
        if (!response) {
          toast.error('Answer from server is empty.', { autoClose: 4000, hideProgressBar: false });
          return;
        }
    
        if (response.success) {
          try {
            // Безопасное копирование в буфер обмена
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              await navigator.clipboard.writeText(password);
              toast.success(`${device.hwId} initialized! Password copied to clipboard.`, { autoClose: 3000 });
            } else {
              // Альтернативный метод для старых браузеров
              copyToClipboardFallback(password);
              toast.success(`${device.hwId} initialized! Password: ${password}`, { autoClose: 3000 });
            }
          } catch (clipboardError) {
            // console.warn('Clipboard copy failed:', clipboardError);
            toast.success(`${device.hwId} initialized! Password: ${password}`, { autoClose: 3000 });
          }
        } else if ((response.error?.includes('Unexpected token')) || (!response.success)) {
          toast.error(`Initialization failed! Password was set.`, { autoClose: 4000 });
        }
      } catch (error) {
        // console.error('Initialization error:', error);
        toast.error(`Initialization failed: ${error.message}`, { autoClose: 4000 });
      } finally {
        isLoading.value = false;
      }
    };
    
    // Фолбэк для копирования в буфер
    function copyToClipboardFallback(text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.select();
      
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Fallback copy failed:', err);
      } finally {
        document.body.removeChild(textarea);
      }
    }
    
    return {
        isLoading,
        resetConfig,
        rebootDevice,
        resetDslLine,
        initializationDevice
    }
}