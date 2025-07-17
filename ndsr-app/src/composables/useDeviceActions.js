import { ref } from 'vue'
import { socket } from '@/socket'
import { toast } from 'vue3-toastify'

export function useDeviceActions(device, isOffline) {
    const isLoading = ref(false)
    
    const resetConfig = () => {
      if (!confirm(`Do you really want to reset configuration ${device.hwId}?`)) return;
      
      isLoading.value = true;
      socket.timeout(120000).emit('device:resetConfig', device.id, (error, response) => {
          isLoading.value = false;
          
          if (error) {
              if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
                  toast.error(`Timeout: Device ${device.shortName} (${device.hwId}) not responding`, { 
                      autoClose: 5000,
                      hideProgressBar: false
                  });
              } else if (error.message.includes('Cannot connect')) {
                  toast.error(`Connection error: Cannot reach device ${device.shortName} (${device.hwId})`, {
                      autoClose: 5000,
                      hideProgressBar: false
                  });
              } else {
                toast.error(`Reset config for ${device.shortName}: ${device.hwId} done, but something went wrong device is not accessible!`,{
                     autoClose: 4000,
                     hideProgressBar: false
                 });
              }
              return;
          }
          if (!response || response.status !== 'ok') {
              const errorMsg = response?.error || 'Unknown error occurred or not connected to reset relay';
              toast.error(`Reset failed for ${device.shortName}: ${errorMsg}`, {
                  autoClose: 5000,
                  hideProgressBar: false
              });
              return;
          }
          toast.success(`Configuration successfully reset for ${device.shortName} (${device.hwId})`, {
              autoClose: 3000,
              hideProgressBar: false
          });
      });
  };
  const rebootDevice = () => {
    if (!confirm(`Do you really want to reboot ${device.hwId}?`)) return;
    
    isLoading.value = true;
    
    socket.timeout(120000).emit('device:reboot', device.id, (error, response) => {
      isLoading.value = false;
      
      if (error) {
        // Обработка ошибок соединения/таймаута
        if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
          toast.error(`Timeout: Device ${device.shortName} (${device.hwId}) not responding`, {
            autoClose: 5000,
            hideProgressBar: false
          });
        } 
        else if (error.message.includes('Cannot connect') || error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') {
          toast.error(`Connection error: Cannot reach device ${device.shortName} (${device.hwId})`, {
            autoClose: 5000,
            hideProgressBar: false
          });
        }
        else {
          toast.error(`Reboot command for ${device.shortName}: ${device.hwId} done, but something went wrong device is not accessible!`,{
            autoClose: 5000,
            hideProgressBar: false
          });
        }
        console.error('Reboot error details:', error);
        return;
      }
  
      // Обработка ответа сервера
      if (!response || response.status !== 'ok') {
        const errorMsg = response?.error || 'Unknown error occurred or not connected to reset relay';
        toast.error(`Reboot failed: ${errorMsg}`, {
          autoClose: 5000,
          hideProgressBar: false
        });
        return;
      }
  
      toast.success(`${device.shortName} ${device.hwId} was successfully rebooted!`, { 
        autoClose: 3000, 
        hideProgressBar: false 
      });
    });
  };

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
        toast.error(`Device ${device.hwId} is offline. Cannot initialize.`, { 
          autoClose: 4000, 
          hideProgressBar: false 
        });
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
              if (error) {
                // Обработка специфических ошибок соединения
                if (error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') {
                  reject(new Error(`Connection timeout to ${device.shortName} (${device.hwId}) at ${url}`));
                } 
                else if (error.message.includes('fetch failed')) {
                  reject(new Error(`Network failure: Could not reach ${device.shortName}`));
                }
                else if (error.message.includes('Unexpected token')) {
                  reject(new Error('Invalid response format from device'));
                }
                else {
                  reject(error);
                }
              } else {
                resolve(response);
              }
            }
          );
        });
    
        if (!response) {
          throw new Error('Empty response from server');
        }
    
        if (response.success) {
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(password);
              toast.success(`${device.hwId} initialized! Password copied to clipboard.`, { 
                autoClose: 3000,
                hideProgressBar: false  
              });
            } else {
              copyToClipboardFallback(password);
              toast.success(`Initialized ${device.hwId}! Password: ${password}`, { 
                autoClose: 3000,
                hideProgressBar: false
              });
            }
          } catch (clipboardError) {
            toast.success(`Initialized ${device.hwId}! Password: ${password}`, { 
              autoClose: 3000,
              hideProgressBar: false
            });
          }
        } else {
          throw new Error(response.error || 'Unknown error during initialization');
        }
      } catch (error) {
        console.error('Initialization error:', error);
        
        // Специфические сообщения для разных типов ошибок
        if (error.message.includes('Connection timeout')) {
          toast.error(`Timeout: ${error.message}`, { 
            autoClose: 6000,
            hideProgressBar: false 
          });
        }
        else if (error.message.includes('Network failure')) {
          toast.error(`${error.message}. Please check device connectivity`, { 
            autoClose: 6000,
            hideProgressBar: false 
          });
        }
        else if (error.message.includes('Invalid response format')) {
          toast.error(`Configuration error: ${error.message}`, { 
            autoClose: 5000,
            hideProgressBar: false 
          });
        }
        else if (error.message.includes('fetch failed')) {
          toast.error(`Network failure: Could not reach ${device.shortName}, error: ${error.message}`, {
            autoClose: 5000,
            hideProgressBar: false 
          });
        }
        else {
          toast.error(`Initialization failed,authorization required: ${error.message}`, { 
            autoClose: 5000,
            hideProgressBar: false 
          });
        }
      } finally {
        isLoading.value = false;
      }
    };
    
    // Фолбэк для копирования в буфер
    async function copyToClipboardFallback(text) {
        try {
          // Пробуем современный API (работает в 95% браузеров)
          await navigator.clipboard.writeText(text);
        } catch {
          // Fallback для старых браузеров (IE/Safari < 10)
          const area = document.createElement('textarea');
          area.value = text;
          area.style.position = 'fixed';
          area.style.opacity = 0;
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          document.body.removeChild(area);
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