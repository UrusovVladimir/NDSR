<template>
 <Dialog
    v-model:visible="visible"
    :modal="true"
    header="File Manager"
    :style="{ width: '550px', maxWidth: '95vw' }"
    :breakpoints="{ '960px': '85vw', '641px': '95vw' }"
    :contentStyle="{ padding: '1.5rem' }"
    :blockScroll="true"
    class="file-manager-modal"
  >
    <div class="file-manager-content">
      <!-- Загрузка файлов -->
      <div class="upload-section">
        <div class="section-title">
          <i class="pi pi-cloud-upload"></i>
          <span>Upload Files</span>
        </div>
        
        <FileUpload
          name="files"
          :url="uploadUrl"
          :multiple="true"
          :auto="true"
          :maxFileSize="104857600"
          :customUpload="true"
          @uploader="onUpload"
          @select="onFileSelect"
          @before-upload="onBeforeUpload"
          @error="onUploadError"
          :accept="acceptedFileTypes"
        >
          <template #empty>
            <div class="upload-empty-state">
              <i class="pi pi-cloud-upload"></i>
              <p>Drag and drop files here or click to browse</p>
              <small class="text-color-secondary">
                Supported files: .bin, .img, .tar, .gz, .zip (max 100MB)
              </small>
            </div>
          </template>
        </FileUpload>

        <!-- Прогресс загрузки -->
        <div v-if="uploading" class="upload-progress">
          <div class="progress-info">
            <span>
              <i class="pi pi-spin pi-spinner"></i>
              {{ currentFile?.name || 'Uploading...' }}
            </span>
            <span>{{ uploadProgress }}%</span>
            <Button
              icon="pi pi-times"
              class="p-button-text p-button-sm"
              @click="cancelUpload"
              v-tooltip="'Cancel upload'"
            />
          </div>
          <ProgressBar :value="uploadProgress" :showValue="false" />
        </div>

        <!-- Сообщение об успешной загрузке -->
        <Message 
          v-if="uploadSuccess" 
          severity="success" 
          :closable="true"
          @close="uploadSuccess = false"
          class="mt-2"
        >
          <i class="pi pi-check-circle"></i>
          File uploaded successfully!
        </Message>

        <!-- Сообщение об ошибке -->
        <Message 
          v-if="uploadError" 
          severity="error" 
          :closable="true"
          @close="uploadError = null"
          class="mt-2"
        >
          <i class="pi pi-exclamation-circle"></i>
          {{ uploadError }}
        </Message>
      </div>

      <!-- Список файлов -->
      <div class="files-section">
        <div class="section-title">
          <i class="pi pi-folder-open"></i>
          <span>Uploaded Files ({{ files.length }})</span>
          <Button
            icon="pi pi-refresh"
            class="p-button-text p-button-sm"
            @click="loadFiles"
            :loading="loading"
            v-tooltip="'Refresh list'"
          />
        </div>

        <div v-if="loading" class="loading-state">
          <i class="pi pi-spin pi-spinner"></i>
          <span>Loading files...</span>
        </div>

        <div v-else-if="files.length === 0" class="empty-state">
          <i class="pi pi-inbox"></i>
          <p>No files uploaded yet</p>
          <small class="text-color-secondary">
            Click or drag files to upload
          </small>
        </div>

        <div v-else class="files-list">
          <div
            v-for="file in files"
            :key="file.name"
            class="file-item"
            :class="{ 'file-selected': selectedFile === file.name }"
            @click="selectFile(file.name)"
          >
            <div class="file-icon">
              <i :class="getFileIcon(file.name)"></i>
            </div>
            <div class="file-info">
              <div class="file-name">{{ file.name }}</div>
              <div class="file-meta">
                <span class="file-size">{{ formatFileSize(file.size) }}</span>
                <span class="file-date">{{ formatDate(file.modified) }}</span>
              </div>
            </div>
            <div class="file-actions">
              <Button
                icon="pi pi-download"
                class="p-button-text p-button-sm"
                @click.stop="downloadFile(file.name)"
                v-tooltip="'Download'"
              />
              <Button
                icon="pi pi-trash"
                class="p-button-text p-button-danger p-button-sm"
                @click.stop="confirmDelete(file.name)"
                v-tooltip="'Delete'"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer">
        <Button
          label="Close"
          icon="pi pi-times"
          @click="closeModal"
          class="p-button-text"
        />
        <Button
          v-if="selectedFile"
          label="Apply to Device"
          icon="pi pi-check"
          @click="applyToDevice"
          :loading="applying"
          :disabled="!selectedFile"
        />
      </div>
    </template>

    <ConfirmDialog />
    
    <DeviceSelector
      ref="deviceSelectorRef"
      :fileName="selectedFile"
      :fileSize="getFileSize(selectedFile)"
      @close-files="handleCloseFiles"
    />
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import Dialog from 'primevue/dialog'
import FileUpload from 'primevue/fileupload'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import ConfirmDialog from 'primevue/confirmdialog'
import Message from 'primevue/message'
// ✅ ИМПОРТИРУЕМ DeviceSelector
import DeviceSelector from './DeviceSelector.vue'

const toast = useToast()
const confirm = useConfirm()

// Состояния
const visible = ref(false)
const loading = ref(false)
const uploading = ref(false)
const applying = ref(false)
const files = ref([])
const selectedFile = ref(null)
const uploadProgress = ref(0)
const currentFile = ref(null)
const uploadSuccess = ref(false)
const uploadError = ref(null)

// ✅ Реф для DeviceSelector
const deviceSelectorRef = ref(null)
const handleCloseFiles = () => {
  // Закрываем FileManager
  visible.value = false
  selectedFile.value = null
  console.log('✅ FileManager closed after firmware apply')
}
// URL для API
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://192.168.5.150:3000'

const uploadUrl = computed(() => {
  return `${API_BASE_URL}/api/upload`
})

const acceptedFileTypes = '.bin,.img,.tar,.gz,.zip'

// ✅ Функция для получения размера файла
const getFileSize = (fileName) => {
  if (!fileName) return ''
  const file = files.value.find(f => f.name === fileName)
  return file ? formatFileSize(file.size) : ''
}

// Методы
const show = () => {
  visible.value = true
  loadFiles()
  uploadSuccess.value = false
  uploadError.value = null
}

const closeModal = () => {
  visible.value = false
  selectedFile.value = null
  currentFile.value = null
  uploadProgress.value = 0
  uploadSuccess.value = false
  uploadError.value = null
}

const cancelUpload = () => {
  uploading.value = false
  uploadProgress.value = 0
  currentFile.value = null
  uploadError.value = null
  toast.add({
    severity: 'info',
    summary: 'Cancelled',
    detail: 'Upload cancelled',
    life: 2000
  })
}

const loadFiles = async () => {
  loading.value = true
  try {
    const response = await fetch(`${API_BASE_URL}/api/files`)
    if (response.ok) {
      const data = await response.json()
      files.value = data.files || []
      console.log(`✅ Loaded ${files.value.length} files`)
    } else {
      throw new Error('Failed to load files')
    }
  } catch (error) {
    console.error('❌ Failed to load files:', error)
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load file list. Make sure backend server is running on port 3000',
      life: 5000
    })
  } finally {
    loading.value = false
  }
}

const onBeforeUpload = () => {
  console.log('📤 Starting upload...')
  uploadSuccess.value = false
  uploadError.value = null
}

const onFileSelect = (event) => {
  const file = event.files[0]
  if (file) {
    currentFile.value = file
    uploadProgress.value = 0
    console.log(`📁 File selected: ${file.name} (${formatFileSize(file.size)})`)
    
    toast.add({
      severity: 'info',
      summary: 'Uploading',
      detail: `Starting upload of "${file.name}"...`,
      life: 2000
    })
  }
}

const onUploadError = (event) => {
  console.error('Upload error:', event)
  const errorMsg = event?.xhr?.status === 413 
    ? 'File too large (max 100MB)' 
    : event?.message || 'Upload failed'
  
  uploadError.value = errorMsg
  uploading.value = false
  
  toast.add({
    severity: 'error',
    summary: 'Upload Failed',
    detail: errorMsg,
    life: 5000
  })
}

const onUpload = async (event) => {
  const file = event.files[0]
  if (!file) return

  const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
  
  if (file.size > MAX_FILE_SIZE) {
    const errorMsg = `File too large: ${formatFileSize(file.size)} (max 100MB)`
    uploadError.value = errorMsg
    toast.add({
      severity: 'error',
      summary: 'File Too Large',
      detail: errorMsg,
      life: 5000
    })
    return
  }

  uploading.value = true
  uploadProgress.value = 0
  uploadError.value = null

  try {
    const formData = new FormData()
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100)
        uploadProgress.value = progress
        console.log(`📊 Upload progress: ${progress}%`)
      }
    })

    const uploadPromise = new Promise((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.response)
            resolve(response)
          } catch (e) {
            reject(new Error('Invalid response format'))
          }
        } else if (xhr.status === 413) {
          reject(new Error('File too large (max 100MB)'))
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`))
        }
      }
      xhr.onerror = () => reject(new Error('Network error - check if backend is running'))
      xhr.open('POST', uploadUrl.value)
      xhr.send(formData)
    })

    await uploadPromise
    
    uploadSuccess.value = true
    toast.add({
      severity: 'success',
      summary: 'Upload Complete',
      detail: `File "${file.name}" uploaded successfully!`,
      life: 3000
    })
    
    await loadFiles()
    
  } catch (error) {
    console.error('❌ Upload failed:', error)
    uploadError.value = error.message
    toast.add({
      severity: 'error',
      summary: 'Upload Failed',
      detail: error.message,
      life: 5000
    })
  } finally {
    uploading.value = false
    uploadProgress.value = 0
    currentFile.value = null
    
    if (uploadSuccess.value) {
      setTimeout(() => {
        uploadSuccess.value = false
      }, 3000)
    }
  }
}

const downloadFile = async (fileName) => {
  try {
    toast.add({
      severity: 'info',
      summary: 'Downloading',
      detail: `Starting download of "${fileName}"...`,
      life: 2000
    })
    
    const response = await fetch(`${API_BASE_URL}/api/files/${encodeURIComponent(fileName)}`)
    if (response.ok) {
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      
      toast.add({
        severity: 'success',
        summary: 'Download Started',
        detail: `"${fileName}" is being downloaded`,
        life: 3000
      })
    } else {
      throw new Error('Download failed')
    }
  } catch (error) {
    console.error('❌ Download failed:', error)
    toast.add({
      severity: 'error',
      summary: 'Download Failed',
      detail: `Failed to download "${fileName}"`,
      life: 3000
    })
  }
}

const confirmDelete = (fileName) => {
  confirm.require({
    message: `Are you sure you want to delete "${fileName}"?`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Yes',
    rejectLabel: 'No',
    accept: () => deleteFile(fileName)
  })
}

const deleteFile = async (fileName) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/files/${encodeURIComponent(fileName)}`, {
      method: 'DELETE'
    })
    
    if (response.ok) {
      toast.add({
        severity: 'success',
        summary: 'Deleted',
        detail: `File "${fileName}" deleted successfully`,
        life: 3000
      })
      
      if (selectedFile.value === fileName) {
        selectedFile.value = null
      }
      
      await loadFiles()
    } else {
      throw new Error('Delete failed')
    }
  } catch (error) {
    console.error('❌ Delete failed:', error)
    toast.add({
      severity: 'error',
      summary: 'Delete Failed',
      detail: `Failed to delete "${fileName}"`,
      life: 3000
    })
  }
}

const selectFile = (fileName) => {
  selectedFile.value = selectedFile.value === fileName ? null : fileName
  if (selectedFile.value) {
    toast.add({
      severity: 'info',
      summary: 'File Selected',
      detail: `Selected: ${fileName}`,
      life: 2000
    })
  }
}

// ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ applyToDevice
const applyToDevice = () => {
  if (!selectedFile.value) return
  
  // Открываем DeviceSelector
  if (deviceSelectorRef.value) {
    deviceSelectorRef.value.show()
  } else {
    console.error('DeviceSelector ref is not available')
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Device selector not available',
      life: 3000
    })
  }
}

const getFileIcon = (fileName) => {
  if (!fileName) return 'pi-file'
  
  const extension = fileName.split('.').pop().toLowerCase()
  
  const iconMap = {
    'bin': 'pi-microchip',
    'img': 'pi-image',
    'tar': 'pi-box',
    'gz': 'pi-box',
    'zip': 'pi-file-archive',
    'pdf': 'pi-file-pdf',
    'txt': 'pi-file',
    'json': 'pi-code',
    'xml': 'pi-code',
    'html': 'pi-code',
    'css': 'pi-code',
    'js': 'pi-code',
    'png': 'pi-image',
    'jpg': 'pi-image',
    'jpeg': 'pi-image',
    'gif': 'pi-image',
    'svg': 'pi-image',
    'mp4': 'pi-video',
    'mp3': 'pi-volume-up',
    'doc': 'pi-file-word',
    'docx': 'pi-file-word',
    'xls': 'pi-file-excel',
    'xlsx': 'pi-file-excel',
    'ppt': 'pi-file-powerpoint',
    'pptx': 'pi-file-powerpoint'
  }
  
  return iconMap[extension] || 'pi-file'
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  if (!bytes) return 'Unknown'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDate = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
}

defineExpose({ show })
</script>

<style scoped>
.mt-2 {
  margin-top: 0.5rem;
}

/* Остальные стили остаются без изменений */
.file-manager-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.upload-section,
.files-section {
  background: var(--surface-ground);
  border-radius: 8px;
  padding: 1rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--text-color);
  font-size: 1rem;
}

.section-title i {
  color: var(--primary-color);
}

:deep(.p-fileupload) {
  border: 2px dashed var(--surface-border);
  border-radius: 8px;
  background: var(--surface-card);
  transition: all 0.3s ease;
}

:deep(.p-fileupload:hover) {
  border-color: var(--primary-color);
  background: var(--surface-hover);
}

.upload-empty-state {
  text-align: center;
  padding: 2rem;
}

.upload-empty-state i {
  font-size: 2.5rem;
  color: var(--text-color-secondary);
  margin-bottom: 0.5rem;
}

.upload-empty-state p {
  margin: 0.5rem 0;
  color: var(--text-color);
}

.upload-progress {
  margin-top: 1rem;
  padding: 0.75rem;
  background: var(--surface-card);
  border-radius: 6px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-color-secondary);
}

.progress-info i {
  margin-right: 0.5rem;
}

.files-list {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-item:hover {
  background: var(--surface-hover);
  border-color: var(--primary-color);
}

.file-selected {
  background: var(--primary-color-light);
  border-color: var(--primary-color);
}

.file-icon {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-ground);
  border-radius: 4px;
  color: var(--primary-color);
  font-size: 1.2rem;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-weight: 500;
  margin-bottom: 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

.file-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--text-color-secondary);
}

.loading-state i,
.empty-state i {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  display: block;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (max-width: 768px) {
  .file-manager-content {
    gap: 1rem;
  }
  
  .upload-section,
  .files-section {
    padding: 0.75rem;
  }
  
  .file-item {
    padding: 0.5rem;
  }
  
  .file-meta {
    flex-direction: column;
    gap: 0.25rem;
  }
}
</style>