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
  let countdownInterval = null
  let lastExtendAttempt = 0

  const updateTimer = () => {
    if (countdownInterval) clearInterval(countdownInterval)
  
    countdownInterval = setInterval(() => {
      if (timerSeconds.value > 0) {
        timerSeconds.value--
      } else if (
        localBookingStatus.value.isBooked &&
        localBookingStatus.value.bookedBy === currentUserId.value
      ) {
        // Независимо от того, открылось ли ElMessageBox или нет — освобождаем
        releaseDevice()
      }
    }, 1000)
  }
  

  const updateBookingStatus = (data) => {
    const secondsLeft = Math.max(0, data.expiresAt
      ? data.expiresAt - Math.floor(Date.now() / 1000)
      : 0)

    localBookingStatus.value = {
      isBooked: data.isBooked ?? true,
      bookedBy: data.bookedBy,
      timerSeconds: secondsLeft
    }

    timerSeconds.value = secondsLeft
    isSelected.value = data.bookedBy === currentUserId.value
    hasWarned.value = false
    updateTimer()
    emit('reservationChange', localBookingStatus.value)
  }

  const loadBookingStatus = () => {
    socket.emit('device:get-booking-status', deviceId, (response) => {
      if (response) updateBookingStatus(response)
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
    clearInterval(countdownInterval)
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
      console.log('[Popup] Confirmed with seconds:', seconds);
    popupConfirmed.value = seconds
    showPopup.value = false
  }

  const handleBookingChange = async () => {
    if (isLoading.value) return;
    isLoading.value = true;
  
    const isCurrentlyBookedByUser =
      localBookingStatus.value.isBooked &&
      localBookingStatus.value.bookedBy === currentUserId.value;
  
    try {
      if (!isCurrentlyBookedByUser) {
        popupConfirmed.value = null;
        showPopup.value = true;
  
        const confirmedSeconds = await waitForPopupConfirm();
        if (confirmedSeconds !== null) { // Добавляем проверку на null
          await bookDevice(confirmedSeconds);
        }
      } else {
        await releaseDevice();
      }
    } catch (error) {
      console.warn('Booking error:', error.message);
      isSelected.value = isCurrentlyBookedByUser;
    } finally {
      isLoading.value = false;
      showPopup.value = false;
    }
  };

  const extendBooking = async () => {
    const now = Date.now();
    if (now - lastExtendAttempt < 2000) return;
    lastExtendAttempt = now;
  
    const isCurrentlyBookedByUser =
      localBookingStatus.value.isBooked &&
      localBookingStatus.value.bookedBy === currentUserId.value;
  
    if (!isCurrentlyBookedByUser) {
      console.warn('❌ Нельзя продлить бронирование — устройство принадлежит другому пользователю.');
      return;
    }
  
    if (isLoading.value) return;
    isLoading.value = true;
  
    try {
      popupConfirmed.value = null;
      showPopup.value = true;
  
      const confirmedSeconds = await waitForPopupConfirm();
      if (confirmedSeconds !== null) { // Добавляем проверку на null
        await bookDevice(confirmedSeconds);
      }
    } catch (error) {
      console.warn('Extend booking error:', error.message);
    } finally {
      isLoading.value = false;
      showPopup.value = false;
      isSelected.value = isCurrentlyBookedByUser;
      
      if (countdownInterval) {
        clearInterval(countdownInterval);
        updateTimer();
      }
    }
  };

  watch(timerSeconds, (newVal) => {
    if (
      newVal <= 300 &&
      newVal > 0 &&
      localBookingStatus.value.bookedBy === currentUserId.value &&
      !hasWarned.value
    ) {
      hasWarned.value = true
  
      // Показать предупреждение
      ElMessageBox.confirm(
        "🚨 The device reservation expires in 5 minutes!\nDon't forget to renew if you need to continue.",
        'Booking Warning',
        {
          confirmButtonText: 'Extend',
          cancelButtonText: 'Close',
          type: 'warning',
          distinguishCancelAndClose: true,
        }
      )
        .then(() => {
          // Пользователь нажал "Extend"
          extendBooking()
        })
        .catch(() => {
          // Пользователь проигнорировал или закрыл
          // ничего не делаем тут — отпуск произойдёт по таймеру
        })
  
      // Важно: продолжаем отсчёт до 0 — release произойдет в updateTimer
    }
  })
  

  const waitForPopupConfirm = () => {
    return new Promise((resolve, reject) => {
      // Если попап уже закрыт, сразу возвращаем null
      if (!showPopup.value) {
        resolve(null);
        return;
      }
  
      const stopPopupWatcher = watch(() => popupConfirmed.value, (val) => {
        if (val !== null) {
          stopPopupWatcher();
          stopCloseWatcher();
          resolve(val); // Возвращаем выбранное время
        }
      });
  
      const stopCloseWatcher = watch(() => showPopup.value, (val) => {
        if (!val) {
          stopPopupWatcher();
          stopCloseWatcher();
          resolve(null); // Возвращаем null при закрытии
        }
      });
  
    });
  };

  watch(
    () => localBookingStatus.value,
    (newVal) => {
      isSelected.value = newVal.isBooked && newVal.bookedBy === currentUserId.value
    },
    { deep: true }  // Добавьте deep: true для отслеживания вложенных изменений
  )


  console.log('[extendBooking] Start', { 
    isSelected: isSelected.value,
    lastExtendAttempt 
  })
  watch(() => isSelected.value, (val) => {
    console.log('[extendBooking] isSelected changed', val)
})
  
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