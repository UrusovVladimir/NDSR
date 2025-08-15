// useDeviceBooking.js
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { socket } from '@/socket'
import { ElMessageBox } from 'element-plus'

/**
 * Управление бронированием устройства.
 * @param {string} deviceId          - Идентификатор устройства (строка).
 * @param {Ref<string|null>} currentUserId - ref с текущим ID пользователя (например, IP).
 * @param {Function} emit            - emit из компонента-карточки (`@reservation-change`).
 */
export function useDeviceBooking(deviceId, currentUserId, emit) {
  const localBookingStatus = ref({
    isBooked: false,
    bookedBy: null,
    expiresAt: 0,       
    timerSeconds: 0,
    accessPassword: null
  })

  const isSelected = ref(false)          // забронировано текущим пользователем?
  const isLoading = ref(false)           // локальный индикатор запроса
  const showPopup = ref(false)           // показать попап выбора времени
  const popupConfirmed = ref(null)       // выбранное в попапе значение секунд
  const timerSeconds = ref(0)            // оставшееся время (сек)
  const hasWarned = ref(false)           // уже показывали предупреждение <5м
  const initialLoadComplete = ref(false) // чтобы не предупреждать до первой загрузки
  let countdownInterval = null
  let currentSessionId = null            // bookedBy_expiresAt
  let lastExtendAttempt = 0              // антидребезг


  const sessionStorageKey = () => `warned_${deviceId}_${currentSessionId || ''}`

  function clearCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval)
      countdownInterval = null
    }
  }

  function startCountdown() {
    clearCountdown()
    countdownInterval = setInterval(() => {
      if (timerSeconds.value > 0) {
        timerSeconds.value--
      } else {
        clearCountdown()
        // по истечении срока если всё ещё считаем забронировано текущим — освободим
        if (
          localBookingStatus.value.isBooked &&
          localBookingStatus.value.bookedBy === currentUserId.value
        ) {
          releaseDevice() // fire & forget
          sessionStorage.setItem(sessionStorageKey(), '0')
        }
      }
    }, 1000)
  }

  /**
   * Применяем состояние бронирования (универсально: initial load, push, локальная бронь/продление)
   */
  function applyBookingState({ isBooked, bookedBy, expiresAt, accessPassword }) {
    const nowSec = Math.floor(Date.now() / 1000)
    const secondsLeft = Math.max(0, (expiresAt ?? 0) - nowSec)

    // новый sessionId?
    const newSessionId = isBooked ? `${bookedBy}_${expiresAt}` : 'none'
    if (newSessionId !== currentSessionId) {
      currentSessionId = newSessionId
      const warned = sessionStorage.getItem(sessionStorageKey())
      hasWarned.value = warned === '1'
      if (warned === null) {
        sessionStorage.setItem(sessionStorageKey(), '0')
        hasWarned.value = false
      }
    }

    localBookingStatus.value = {
      isBooked: !!isBooked,
      bookedBy: bookedBy ?? null,
      expiresAt: expiresAt ?? 0,
      timerSeconds: secondsLeft,
      accessPassword: accessPassword ?? null
    }

    timerSeconds.value = secondsLeft
    isSelected.value =
      !!isBooked && bookedBy === currentUserId.value

    startCountdown()
    emit('reservationChange', localBookingStatus.value)
  }

  // --- загрузка статуса от сервера ------------------------------------------
  function loadBookingStatus() {
    socket.emit('device:get-booking-status', deviceId, (response) => {
      if (response) {
        applyBookingState({
          isBooked: response.isBooked,
          bookedBy: response.bookedBy,
          expiresAt: response.expiresAt,
          accessPassword: response.accessPassword || null
        })
        initialLoadComplete.value = true
      }
    })
  }

  // --- API вызовы -----------------------------------------------------------
  function bookDevice(durationSeconds) {
    return new Promise((resolve, reject) => {
      socket.emit(
        'device:book',
        { deviceId: deviceId.trim(), duration: durationSeconds },
        (response) => {
          if (response?.success) {
            resolve({
              expiresAt: response.expiresAt,
              accessPassword: response.accessPassword ?? null,
              bookedBy: currentUserId.value,
              isBooked: true
            })
          } else {
            reject(response?.message || 'Booking failed')
          }
        }
      )
    })
  }

  function releaseDevice() {
    return new Promise((resolve, reject) => {
      socket.emit(
        'device:release',
        {
          deviceId: deviceId.trim(),
          bookedBy: currentUserId.value
        },
        (response) => {
          if (response?.status === 'ok') {
            resolve()
          } else {
            reject(response?.message || 'Release failed')
          }
        }
      )
    })
  }

  // --- Пользовательские действия --------------------------------------------

  async function handleBookingChange() {
    if (isLoading.value) return
    isLoading.value = true

    try {
      if (!localBookingStatus.value.isBooked) {
        // бронирование
        popupConfirmed.value = null
        showPopup.value = true
        const confirmedSeconds = await waitForPopupConfirm()
        if (confirmedSeconds !== null) {
          const result = await bookDevice(confirmedSeconds)
          applyBookingState(result) // сразу показать пароль и время
        }
      } else {
        // освобождение
        await releaseDevice()
        applyBookingState({
          isBooked: false,
          bookedBy: null,
          expiresAt: 0,
          accessPassword: null
        })
      }
    } catch (err) {
      console.error('Booking change error:', err)
    } finally {
      isLoading.value = false
      showPopup.value = false
    }
  }

  async function extendBooking() {
    const now = Date.now()
    if (now - lastExtendAttempt < 2000) return
    lastExtendAttempt = now

    const isMine =
      localBookingStatus.value.isBooked &&
      localBookingStatus.value.bookedBy === currentUserId.value
    if (!isMine || isLoading.value) return

    isLoading.value = true
    try {
      popupConfirmed.value = null
      showPopup.value = true
      const confirmedSeconds = await waitForPopupConfirm()
      if (confirmedSeconds !== null) {
        const result = await bookDevice(confirmedSeconds)
        applyBookingState(result) // обновим таймер и пароль
        hasWarned.value = false
        sessionStorage.setItem(sessionStorageKey(), '0')
      }
    } catch (err) {
      console.warn('Extend booking error:', err)
    } finally {
      isLoading.value = false
      showPopup.value = false
    }
  }

  // --- Попап выбора времени -------------------------------------------------
  function handleTimeConfirm(seconds) {
    popupConfirmed.value = seconds
    showPopup.value = false
  }

  function waitForPopupConfirm() {
    return new Promise((resolve) => {
      if (!showPopup.value) {
        resolve(null)
        return
      }

      const stopPopupWatcher = watch(
        () => popupConfirmed.value,
        (val) => {
          if (val !== null) {
            stopPopupWatcher()
            stopCloseWatcher()
            resolve(val)
          }
        }
      )

      const stopCloseWatcher = watch(
        () => showPopup.value,
        (val) => {
          if (!val) {
            stopPopupWatcher()
            stopCloseWatcher()
            resolve(null)
          }
        }
      )
    })
  }

  // --- Предупреждение за 5 мин до конца -------------------------------------
  watch(timerSeconds, (newVal) => {
    if (!initialLoadComplete.value) return

    const alreadyWarned =
      hasWarned.value || sessionStorage.getItem(sessionStorageKey()) === '1'

    if (
      newVal <= 300 &&
      newVal > 0 &&
      localBookingStatus.value.bookedBy === currentUserId.value &&
      !alreadyWarned
    ) {
      hasWarned.value = true
      sessionStorage.setItem(sessionStorageKey(), '1')

      ElMessageBox.confirm(
        `🚨 The device ${deviceId} reservation expires in 5 minutes!\nDon't forget to renew if you need to continue.`,
        'Booking Warning',
        {
          confirmButtonText: 'Extend',
          cancelButtonText: 'Close',
          type: 'warning',
          distinguishCancelAndClose: true
        }
      )
        .then(() => {
          extendBooking()
        })
        .catch((action) => {
          if (action === 'cancel' || action === 'close') {
            sessionStorage.setItem(sessionStorageKey(), '1')
          }
        })
    }
  })

  // --- реакция на изменения статуса локально (избыточно, но оставим совместимость) ---
  watch(
    () => localBookingStatus.value,
    (newVal) => {
      isSelected.value =
        newVal.isBooked && newVal.bookedBy === currentUserId.value
    },
    { deep: true }
  )

  // --- socket listeners -----------------------------------------------------
  function onDeviceBooked(data) {
    if (data.deviceId !== deviceId) return
    applyBookingState({
      isBooked: data.isBooked ?? true,
      bookedBy: data.bookedBy,
      expiresAt: data.expiresAt,
      accessPassword: data.accessPassword
    })
  }

  function onDeviceReleased(data) {
    if (data.deviceId !== deviceId) return
    applyBookingState({
      isBooked: false,
      bookedBy: null,
      expiresAt: 0,
      accessPassword: null
    })
  }

  function addSocketListeners() {
    socket.on('device:booked', onDeviceBooked)
    socket.on('device:released', onDeviceReleased)
  }

  function removeSocketListeners() {
    socket.off('device:booked', onDeviceBooked)
    socket.off('device:released', onDeviceReleased)
  }

  // --- lifecycle ------------------------------------------------------------
  onMounted(() => {
    loadBookingStatus()
    addSocketListeners()
  })

  onUnmounted(() => {
    removeSocketListeners()
    clearCountdown()
  })

  // --- публичное API --------------------------------------------------------
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
