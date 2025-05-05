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

    return {
        isLoading,
        resetConfig,
        rebootDevice,
        resetDslLine
    }
}