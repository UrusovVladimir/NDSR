import { ref, onMounted, onUnmounted, watch } from 'vue'
import { socket } from '@/socket'
import { ElMessageBox } from 'element-plus'

export function useDeviceBooking(deviceId, currentUserId, emit) {
  const localBookingStatus = ref({
    isBooked: false,
    bookedBy: null,
    timerSeconds: 0
  })

  const isSelected = ref(false)
  const isLoading = ref(false)
  const showPopup = ref(false)
  const popupConfirmed = ref(null)
  const timerSeconds = ref(0)
  const hasWarned = ref(false)
  const initialLoadComplete = ref(false)
  let countdownInterval = null
  let lastExtendAttempt = 0
  let currentBookingSessionId = null

  function getWarnedKey() {
    return `warned_${deviceId}`
  }

  const updateTimer = () => {
    if (countdownInterval) clearInterval(countdownInterval)

    countdownInterval = setInterval(() => {
      if (timerSeconds.value > 0) {
        timerSeconds.value--
      } else {
        clearInterval(countdownInterval)
        countdownInterval = null

        if (
          localBookingStatus.value.isBooked &&
          localBookingStatus.value.bookedBy === currentUserId.value
        ) {
          releaseDevice()
          sessionStorage.setItem(getWarnedKey(), '0')
          
        }
      }
    }, 1000)
  }

  const updateBookingStatus = (data) => {
    const secondsLeft = Math.max(0, data.expiresAt
      ? data.expiresAt - Math.floor(Date.now() / 1000)
      : 0)

    const sessionId = `${data.bookedBy}_${data.expiresAt}`

    if (sessionId !== currentBookingSessionId) {
      currentBookingSessionId = sessionId
    
      const alreadyWarned = sessionStorage.getItem(getWarnedKey())
      if (alreadyWarned === null) {
        // Только если вообще не было взаимодействия — устанавливаем в '0'
        sessionStorage.setItem(getWarnedKey(), '0')
        hasWarned.value = false
      } else {
        hasWarned.value = alreadyWarned === '1'
      }
    }
    

    localBookingStatus.value = {
      isBooked: data.isBooked ?? true,
      bookedBy: data.bookedBy,
      timerSeconds: secondsLeft
    }

    timerSeconds.value = secondsLeft
    isSelected.value = data.bookedBy === currentUserId.value

    updateTimer()
    emit('reservationChange', localBookingStatus.value)
  }

  const loadBookingStatus = () => {
    socket.emit('device:get-booking-status', deviceId, (response) => {
      if (response) {
        const warnedFromSession = sessionStorage.getItem(getWarnedKey()) === '1'
        hasWarned.value = warnedFromSession
        updateBookingStatus(response)
        initialLoadComplete.value = true
      }
    })
  }

  onMounted(() => {
    loadBookingStatus()

    socket.on('device:booked', (data) => {
      if (data.deviceId === deviceId) updateBookingStatus(data)
    })

    socket.on('device:released', (data) => {
      if (data.deviceId === deviceId) {
        updateBookingStatus({ isBooked: false, bookedBy: null, expiresAt: 0 })
      }
    })
  })

  onUnmounted(() => {
    socket.off('device:booked')
    socket.off('device:released')
    if (countdownInterval) {
      clearInterval(countdownInterval)
      countdownInterval = null
    }
  })

  const bookDevice = (durationSeconds) => {
    return new Promise((resolve, reject) => {
      socket.emit('device:book', {
        deviceId: deviceId.trim(),
        duration: durationSeconds
      }, (response) => {
        if (response?.success) {
          resolve(response.expiresAt)
        } else {
          reject(response?.message || 'Booking failed')
        }
      })
    })
  }

  const releaseDevice = () => {
    return new Promise((resolve, reject) => {
      socket.emit('device:release', {
        deviceId: deviceId.trim(),
        bookedBy: currentUserId.value
      }, (response) => {
        if (response?.status === 'ok') {
          resolve()
        } else {
          reject(response?.message || 'Release failed')
        }
      })
    })
  }

  const handleTimeConfirm = (seconds) => {
    popupConfirmed.value = seconds
    showPopup.value = false
  }

  const handleBookingChange = async () => {
    if (isLoading.value) return
    isLoading.value = true
    const isCurrentlyBookedByUser =
      localBookingStatus.value.isBooked &&
      localBookingStatus.value.bookedBy === currentUserId.value

    try {
      if (!isCurrentlyBookedByUser) {
        popupConfirmed.value = null
        showPopup.value = true

        const confirmedSeconds = await waitForPopupConfirm()
        if (confirmedSeconds !== null) {
          await bookDevice(confirmedSeconds)
        }
      } else {
        await releaseDevice()
        sessionStorage.setItem(getWarnedKey(), '0')
      }
    } catch (error) {
      console.warn('Booking error:', error.message)
      isSelected.value = isCurrentlyBookedByUser
    } finally {
      isLoading.value = false
      showPopup.value = false
    }
  }

  const extendBooking = async () => {
    const now = Date.now()
    if (now - lastExtendAttempt < 2000) return
    lastExtendAttempt = now

    const isCurrentlyBookedByUser =
      localBookingStatus.value.isBooked &&
      localBookingStatus.value.bookedBy === currentUserId.value
    if (!isCurrentlyBookedByUser) return
    if (isLoading.value) return

    isLoading.value = true
    try {
      popupConfirmed.value = null
      showPopup.value = true

      const confirmedSeconds = await waitForPopupConfirm()
      if (confirmedSeconds !== null) {
        await bookDevice(confirmedSeconds)

        hasWarned.value = false
        sessionStorage.removeItem(getWarnedKey())
      }
    } catch (error) {
      console.warn('Extend booking error:', error.message)
    } finally {
      isLoading.value = false
      showPopup.value = false
      if (countdownInterval) {
        clearInterval(countdownInterval)
        updateTimer()
      }
    }
  }

  watch(timerSeconds, (newVal) => {
    if (!initialLoadComplete.value) return

    const alreadyWarned = hasWarned.value || sessionStorage.getItem(getWarnedKey()) === '1'

    if (
      newVal <= 300 &&
      newVal > 0 &&
      localBookingStatus.value.bookedBy === currentUserId.value &&
      !alreadyWarned
    ) {
      hasWarned.value = true
      sessionStorage.setItem(getWarnedKey(), '1')

      ElMessageBox.confirm(
        `🚨 The device  ${deviceId} reservation expires in 5 minutes!\nDon't forget to renew if you need to continue.`,
        'Booking Warning',
        {
          confirmButtonText: 'Extend',
          cancelButtonText: 'Close',
          type: 'warning',
          distinguishCancelAndClose: true,
        }
      )
        .then(() => {
          extendBooking()
        })
        .catch((action) => {
          if (action === 'cancel' || action === 'close') {
            sessionStorage.setItem(getWarnedKey(), '1')
          }
        })
    }
  })

  const waitForPopupConfirm = () => {
    return new Promise((resolve) => {
      if (!showPopup.value) {
        resolve(null)
        return
      }

      const stopPopupWatcher = watch(() => popupConfirmed.value, (val) => {
        if (val !== null) {
          stopPopupWatcher()
          stopCloseWatcher()
          resolve(val)
        }
      })

      const stopCloseWatcher = watch(() => showPopup.value, (val) => {
        if (!val) {
          stopPopupWatcher()
          stopCloseWatcher()
          resolve(null)
        }
      })
    })
  }

  watch(
    () => localBookingStatus.value,
    (newVal) => {
      isSelected.value = newVal.isBooked && newVal.bookedBy === currentUserId.value
    },
    { deep: true }
  )

  return {
    localBookingStatus,
    isSelected,
    isLoading,
    handleBookingChange,
    showPopup,
    popupConfirmed,
    handleTimeConfirm,
    timerSeconds,
    extendBooking
  }
}
