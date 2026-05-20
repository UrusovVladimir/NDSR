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
        
        <!-- Зона загрузки -->
        <div 
          class="drop-zone"
          :class="{ 'drag-over': isDragOver }"
          @dragover.prevent="isDragOver = true"
          @dragleave.prevent="isDragOver = false"
          @drop.prevent="onDrop"
        >
          <input
            ref="fileInputRef"
            type="file"
            multiple
            accept=".bin,.txt,.conf"
            style="display: none"
            @change="onFileInputChange"
          />
          
          <div class="drop-zone-content" @click="triggerFileSelect">
            <div class="upload-icon">
              <i class="pi pi-cloud-upload"></i>
            </div>
            <div class="upload-text">
              <span class="title">Drag & drop files here</span>
              <span class="subtitle">or click to browse</span>
            </div>
            <div class="upload-hint">
                <i class="pi pi-info-circle"></i>
                <span>Supported: .bin, .txt, .conf up to 100MB</span>
            </div>
          </div>
        </div>

        <!-- Список выбранных файлов -->
        <Transition name="slide-fade">
          <div v-if="selectedFilesList.length > 0" class="selected-files-preview">
            <div class="preview-header">
              <div class="preview-title">
                <i class="pi pi-paperclip"></i>
                <span>{{ selectedFilesList.length }} file{{ selectedFilesList.length > 1 ? 's' : '' }} selected</span>
              </div>
              <div class="preview-actions">
                <Button
                  icon="pi pi-upload"
                  label="Upload All"
                  class="p-button-sm p-button-success upload-btn"
                  @click="uploadAllFiles"
                  :loading="uploading"
                />
                <Button
                  icon="pi pi-trash"
                  class="p-button-sm p-button-outlined p-button-secondary clear-btn"
                  @click="clearSelectedFiles"
                  v-tooltip="'Clear all'"
                />
              </div>
            </div>
            <div class="preview-list">
              <div
                v-for="(file, index) in selectedFilesList"
                :key="file.name + index"
                class="preview-item"
                :style="{ animationDelay: `${index * 50}ms` }"
              >
                <div class="preview-item-icon">
                  <i :class="getFileIcon(file.name)"></i>
                </div>
                <div class="preview-item-info">
                  <div class="preview-item-name">{{ file.name }}</div>
                  <div class="preview-item-size">{{ formatFileSize(file.size) }}</div>
                </div>
                <Button
                  icon="pi pi-times"
                  class="p-button-text p-button-sm p-button-rounded remove-btn"
                  @click="removeSelectedFile(index)"
                  v-tooltip="'Remove'"
                />
              </div>
            </div>
          </div>
        </Transition>

        <!-- Прогресс загрузки -->
        <Transition name="fade">
          <div v-if="uploading" class="upload-progress">
            <div class="progress-card">
              <div class="progress-header">
                <div class="progress-info">
                  <i class="pi pi-spin pi-spinner"></i>
                  <span>{{ uploadProgressMessage }}</span>
                </div>
                <span class="progress-percent">{{ uploadProgress }}%</span>
              </div>
              <ProgressBar :value="uploadProgress" :showValue="false" />
            </div>
          </div>
        </Transition>

        <!-- Сообщения -->
        <Transition name="fade">
          <Message 
            v-if="uploadSuccess" 
            severity="success" 
            :closable="true"
            @close="uploadSuccess = false"
            class="mt-2"
          >
            <div class="message-content">
              <i class="pi pi-check-circle"></i>
              <span>{{ uploadSuccessMessage }}</span>
            </div>
          </Message>
        </Transition>

        <Transition name="fade">
          <Message 
            v-if="uploadError" 
            severity="error" 
            :closable="true"
            @close="uploadError = null"
            class="mt-2"
          >
            <div class="message-content">
              <i class="pi pi-exclamation-circle"></i>
              <span>{{ uploadError }}</span>
            </div>
          </Message>
        </Transition>
      </div>

      <!-- Список файлов -->
      <div class="files-section">
        <div class="section-header">
          <div class="section-title">
            <i class="pi pi-folder-open"></i>
            <span>Uploaded Files</span>
            <Badge :value="files.length" class="file-count-badge" />
          </div>
          <div class="section-actions">
            <Button
              v-if="files.length > 0"
              icon="pi pi-trash"
              label="Delete All"
              class="p-button-sm p-button-outlined p-button-danger delete-all-btn"
              @click="confirmDeleteAll"
              :loading="deletingAll"
              v-tooltip="'Delete all files from server'"
            />
            <Button
              icon="pi pi-refresh"
              class="p-button-text p-button-rounded refresh-btn"
              @click="loadFiles"
              :loading="loading"
              v-tooltip="'Refresh list'"
            />
          </div>
        </div>

        <div v-if="loading" class="loading-state">
          <i class="pi pi-spin pi-spinner"></i>
          <span>Loading files...</span>
        </div>

        <div v-else-if="files.length === 0" class="empty-state">
          <i class="pi pi-inbox"></i>
          <p>No files uploaded yet</p>
          <small>Upload .bin, .txt, or .conf files</small>
        </div>

        <TransitionGroup name="file-list" tag="div" class="files-list">
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
                <span class="file-size">
                  <i class="pi pi-database"></i>
                  {{ formatFileSize(file.size) }}
                </span>
                <span class="file-date">
                  <i class="pi pi-calendar"></i>
                  {{ formatDate(file.modified) }}
                </span>
              </div>
            </div>
            <div class="file-actions">
              <Button
                icon="pi pi-download"
                class="p-button-text p-button-rounded download-btn"
                @click.stop="downloadFile(file.name)"
                v-tooltip="'Download'"
              />
              <Button
                icon="pi pi-trash"
                class="p-button-text p-button-rounded delete-btn"
                @click.stop="confirmDelete(file.name)"
                v-tooltip="'Delete'"
              />
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer">
        <Button
          label="Close"
          icon="pi pi-times"
          @click="closeModal"
          class="p-button-text close-btn"
        />
        <Button
          v-if="selectedFile"
          label="Apply to Device"
          icon="pi pi-check"
          @click="applyToDevice"
          :loading="applying"
          class="p-button-primary apply-btn"
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
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import ConfirmDialog from 'primevue/confirmdialog'
import Message from 'primevue/message'
import Badge from 'primevue/badge'
import DeviceSelector from './DeviceSelector.vue'

const toast = useToast()
const confirm = useConfirm()

// Состояния
const visible = ref(false)
const loading = ref(false)
const uploading = ref(false)
const applying = ref(false)
const deletingAll = ref(false)
const files = ref([])
const selectedFile = ref(null)
const uploadProgress = ref(0)
const uploadSuccess = ref(false)
const uploadError = ref(null)
const uploadSuccessMessage = ref('')
const uploadProgressMessage = ref('')
const selectedFilesList = ref([])
const fileInputRef = ref(null)
const isDragOver = ref(false)

// Реф для DeviceSelector
const deviceSelectorRef = ref(null)

const handleCloseFiles = () => {
  visible.value = false
  selectedFile.value = null
}

// URL для API
const API_BASE_URL = import.meta.env.VITE_API_URL

const getFileSize = (fileName) => {
  if (!fileName) return ''
  const file = files.value.find(f => f.name === fileName)
  return file ? formatFileSize(file.size) : ''
}

// Методы для управления файлами
const triggerFileSelect = () => {
  if (fileInputRef.value && !uploading.value) {
    fileInputRef.value.click()
  }
}

const onFileInputChange = (event) => {
  const files = Array.from(event.target.files)
  addFiles(files)
  event.target.value = ''
}

const onDrop = (event) => {
  isDragOver.value = false
  const files = Array.from(event.dataTransfer.files)
  addFiles(files)
}

const addFiles = (newFiles) => {
  const MAX_FILE_SIZE = 100 * 1024 * 1024
  const validFiles = []
  const oversizedFiles = []
  
  for (const file of newFiles) {
    if (file.size > MAX_FILE_SIZE) {
      oversizedFiles.push(file.name)
    } else if (file.name.toLowerCase().endsWith('.bin') || 
               file.name.toLowerCase().endsWith('.txt') || 
               file.name.toLowerCase().endsWith('.conf')) {
      validFiles.push(file)  // ✅ Принимаем .bin, .txt, .conf
    } else {
      toast.add({
        severity: 'warn',
        summary: 'Invalid File',
        detail: `${file.name} is not a supported file type`,
        life: 3000
      })
    }
  }
  
  if (oversizedFiles.length > 0) {
    toast.add({
      severity: 'error',
      summary: 'File Too Large',
      detail: `${oversizedFiles.length} file(s) exceed 100MB limit`,
      life: 4000
    })
  }
  
  if (validFiles.length > 0) {
    selectedFilesList.value = [...selectedFilesList.value, ...validFiles]
  }
}

const removeSelectedFile = (index) => {
  selectedFilesList.value.splice(index, 1)
}

const clearSelectedFiles = () => {
  selectedFilesList.value = []
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

const uploadAllFiles = async () => {
  if (selectedFilesList.value.length === 0) return
  
  uploading.value = true
  uploadProgress.value = 0
  uploadError.value = null
  
  try {
    const formData = new FormData()
    for (const file of selectedFilesList.value) {
      formData.append('files', file)
    }
    
    const xhr = new XMLHttpRequest()
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100)
        uploadProgress.value = progress
        uploadProgressMessage.value = `Uploading ${progress}%`
      }
    })
    
    const uploadPromise = new Promise((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.response)
            if (response.success) {
              resolve(response)
            } else {
              reject(new Error(response.error || 'Upload failed'))
            }
          } catch (e) {
            reject(new Error('Invalid response format'))
          }
        } else if (xhr.status === 413) {
          reject(new Error('File too large (max 100MB)'))
        } else {
          reject(new Error(`Upload failed (status ${xhr.status})`))
        }
      }
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.open('POST', `${API_BASE_URL}/api/upload`)
      xhr.send(formData)
    })
    
    await uploadPromise
    
    clearSelectedFiles()
    
    uploadSuccess.value = true
    uploadSuccessMessage.value = 'Files uploaded successfully!'
    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: 'Files uploaded successfully',
      life: 3000
    })
    
    await loadFiles()
    
  } catch (error) {
    console.error('Upload failed:', error)
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
    setTimeout(() => {
      uploadSuccess.value = false
      uploadError.value = null
    }, 3000)
  }
}

// DELETE ALL - удаление всех файлов с сервера
const confirmDeleteAll = () => {
  confirm.require({
    message: `Delete all ${files.value.length} files?`,
    header: 'Confirm Delete All',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete All',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: () => deleteAllFiles()
  })
}

const deleteAllFiles = async () => {
  if (files.value.length === 0) return
  
  deletingAll.value = true
  
  try {
    const deletePromises = files.value.map(file => 
      fetch(`${API_BASE_URL}/api/files/${encodeURIComponent(file.name)}`, {
        method: 'DELETE'
      })
    )
    
    const results = await Promise.all(deletePromises)
    const failed = results.filter(r => !r.ok)
    
    if (failed.length === 0) {
      toast.add({
        severity: 'success',
        summary: 'Success',
        detail: `Deleted ${files.value.length} file${files.value.length > 1 ? 's' : ''}`,
        life: 3000
      })
      selectedFile.value = null
      await loadFiles()
    } else {
      toast.add({
        severity: 'warn',
        summary: 'Partial Success',
        detail: `Deleted ${files.value.length - failed.length} of ${files.value.length} files`,
        life: 5000
      })
      await loadFiles()
    }
    
  } catch (error) {
    console.error('Delete all failed:', error)
    toast.add({
      severity: 'error',
      summary: 'Delete Failed',
      detail: 'Failed to delete some files',
      life: 5000
    })
  } finally {
    deletingAll.value = false
  }
}

const loadFiles = async () => {
  loading.value = true
  try {
    const response = await fetch(`${API_BASE_URL}/api/files`)
    if (response.ok) {
      const data = await response.json()
      files.value = data.files || []
    } else {
      throw new Error('Failed to load files')
    }
  } catch (error) {
    console.error('Failed to load files:', error)
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load file list',
      life: 5000
    })
  } finally {
    loading.value = false
  }
}

const downloadFile = async (fileName) => {
  try {
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
        detail: fileName,
        life: 2000
      })
    }
  } catch (error) {
    console.error('Download failed:', error)
    toast.add({
      severity: 'error',
      summary: 'Download Failed',
      detail: fileName,
      life: 3000
    })
  }
}

const confirmDelete = (fileName) => {
  confirm.require({
    message: `Delete "${fileName}"?`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
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
        detail: fileName,
        life: 2000
      })
      
      if (selectedFile.value === fileName) {
        selectedFile.value = null
      }
      
      await loadFiles()
    }
  } catch (error) {
    console.error('Delete failed:', error)
    toast.add({
      severity: 'error',
      summary: 'Delete Failed',
      detail: fileName,
      life: 3000
    })
  }
}

const selectFile = (fileName) => {
  selectedFile.value = selectedFile.value === fileName ? null : fileName
}

const applyToDevice = () => {
  if (!selectedFile.value) return
  if (deviceSelectorRef.value) {
    deviceSelectorRef.value.show()
  }
}

const show = () => {
  visible.value = true
  loadFiles()
}

const closeModal = () => {
  visible.value = false
  selectedFile.value = null
  clearSelectedFiles()
  uploadSuccess.value = false
  uploadError.value = null
}

const getFileIcon = (fileName) => {
  if (!fileName) return 'pi pi-file'
  const ext = fileName.split('.').pop().toLowerCase()
  switch (ext) {
    case 'bin': return 'pi pi-microchip'
    case 'txt': return 'pi pi-file-edit'
    case 'conf': return 'pi pi-cog'
    default: return 'pi pi-file'
  }
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const formatDate = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleDateString()
}

defineExpose({ show })
</script>

<style scoped>
/* Анимации */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}

.file-list-enter-active {
  transition: all 0.2s ease-out;
}

.file-list-leave-active {
  transition: all 0.2s ease-in;
  position: absolute;
}

.file-list-enter-from,
.file-list-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.file-list-move {
  transition: transform 0.2s ease;
}

/* Основные стили */
.file-manager-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.upload-section,
.files-section {
  background: var(--surface-ground);
  border-radius: 12px;
  padding: 1rem;
}

.section-title,
.section-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--text-color);
  font-size: 0.95rem;
}

.section-title i,
.section-header i {
  color: var(--primary-color);
}

.section-header {
  justify-content: space-between;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.file-count-badge {
  margin-left: 0.5rem;
}

.delete-all-btn {
  transition: all 0.2s ease;
}

/* Drop zone */
.drop-zone {
  border: 2px dashed var(--surface-border);
  border-radius: 12px;
  transition: all 0.2s ease;
  cursor: pointer;
  overflow: hidden;
}

.drop-zone:hover {
  border-color: var(--primary-color);
  background: var(--surface-hover);
}

.drop-zone.drag-over {
  border-color: var(--primary-color);
  background: var(--primary-50);
}

.drop-zone-content {
  padding: 2rem;
  text-align: center;
}

.upload-icon i {
  font-size: 2.5rem;
  color: var(--primary-color);
  margin-bottom: 0.75rem;
}

.upload-text {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.upload-text .title {
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-color);
}

.upload-text .subtitle {
  font-size: 0.85rem;
  color: var(--text-color-secondary);
}

.upload-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

/* Выбранные файлы */
.selected-files-preview {
  margin-top: 1rem;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--surface-card);
  overflow: hidden;
}

.preview-header {
  padding: 0.75rem 1rem;
  background: var(--surface-ground);
  border-bottom: 1px solid var(--surface-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.preview-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  font-size: 0.85rem;
}

.preview-actions {
  display: flex;
  gap: 0.5rem;
}

.preview-list {
  max-height: 200px;
  overflow-y: auto;
}

.preview-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--surface-border);
  transition: background 0.2s;
  animation: slideIn 0.2s ease-out backwards;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.preview-item:hover {
  background: var(--surface-hover);
}

.preview-item-icon {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-ground);
  border-radius: 8px;
  font-size: 1.1rem;
}

.preview-item-info {
  flex: 1;
  min-width: 0;
}

.preview-item-name {
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-item-size {
  font-size: 0.7rem;
  color: var(--text-color-secondary);
}

/* Прогресс */
.upload-progress {
  margin-top: 1rem;
}

.progress-card {
  padding: 0.75rem;
  background: var(--surface-card);
  border-radius: 10px;
  border: 1px solid var(--surface-border);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  font-size: 0.8rem;
}

.progress-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-color-secondary);
}

.progress-percent {
  font-weight: 600;
  color: var(--primary-color);
}

/* Список файлов */
.files-list {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: relative;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-item:hover {
  border-color: var(--primary-color);
  background: var(--surface-hover);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.file-selected {
  background: var(--primary-50);
  border-color: var(--primary-color);
}

.file-icon {
  width: 2.25rem;
  height: 2.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-ground);
  border-radius: 10px;
  font-size: 1.2rem;
  color: var(--primary-color);
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.7rem;
  color: var(--text-color-secondary);
}

.file-meta i {
  margin-right: 0.25rem;
  font-size: 0.65rem;
}

.file-actions {
  display: flex;
  gap: 0.25rem;
  opacity: 0;
  transition: opacity 0.2s;
}

.file-item:hover .file-actions {
  opacity: 1;
}

/* Состояния */
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
  opacity: 0.5;
}

.empty-state p {
  margin: 0.5rem 0;
}

.empty-state small {
  font-size: 0.75rem;
}

/* Сообщения */
.message-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.mt-2 {
  margin-top: 0.5rem;
}

/* Футер */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* Кнопки */
.upload-btn,
.clear-btn,
.refresh-btn,
.download-btn,
.delete-btn,
.delete-all-btn,
.close-btn,
.apply-btn {
  transition: all 0.2s ease;
}

.delete-btn:hover,
.delete-all-btn:hover {
  background: var(--red-50) !important;
  color: var(--red-600) !important;
}

.download-btn:hover {
  background: var(--green-50) !important;
  color: var(--green-600) !important;
}

/* Мобильная адаптация */
@media (max-width: 768px) {
  .file-manager-content {
    gap: 1rem;
  }
  
  .upload-section,
  .files-section {
    padding: 0.75rem;
  }
  
  .drop-zone-content {
    padding: 1.5rem;
  }
  
  .preview-header {
    flex-direction: column;
    align-items: stretch;
  }
  
  .preview-actions {
    justify-content: stretch;
  }
  
  .preview-actions .p-button {
    flex: 1;
  }
  
  .section-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  
  .section-actions {
    justify-content: stretch;
  }
  
  .section-actions .p-button {
    flex: 1;
  }
  
  .file-actions {
    opacity: 1;
  }
  
  .file-meta {
    flex-direction: column;
    gap: 0.25rem;
  }
}
</style>