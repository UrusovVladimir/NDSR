// services/progress.js — эмиттеры прогресса операций (имена событий — контракт фронта).

function sendMwsProgress(io, deviceId, progress, step = null) {
  console.log(`📤 MWS Progress: ${deviceId}, ${progress}%, step: ${step}`)
  
  // Отправляем всем клиентам (уже работает)
  io.emit('device:mwsOperationProgress', {
    deviceId: deviceId,
    progress: progress,
    operationType: 'mws_connection',
    step: step,
    timestamp: Date.now()
  });
  
  // Также отправляем общее событие прогресса для универсальной модалки
  io.emit('device:operationProgress', {
    deviceId: deviceId,
    progress: progress,
    operationType: 'mwsConnection',
    step: step,
    details: step ? `MWS: ${step}` : null,
    timestamp: Date.now()
  });
}

function sendModeChangeProgress(io, deviceId, progress, step = null) {
  console.log(`📤 SERVER SENDING Mode Change Progress: ${deviceId}, ${progress}%, step: ${step}`) 
  
  io.emit('device:modeChangeProgress', {
    deviceId: deviceId,
    progress: progress,
    operationType: 'mode_change', 
    step: step,
    timestamp: Date.now()
  });
}

function sendOperationProgress(io, deviceId, progress, operationType) {
  console.log(`📤 Operation Progress: ${deviceId}, ${operationType}, ${progress}%`)
  io.emit('device:operationProgress', {
    deviceId: deviceId,
    progress: progress,
    operationType: operationType,
    timestamp: Date.now()
  });
}

export { sendMwsProgress, sendModeChangeProgress, sendOperationProgress };
