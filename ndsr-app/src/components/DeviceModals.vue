<template>
  <Modal :title="modalTitle" ref="modalRef">
    <template #body>
      <!-- WAN Types Modal -->
      <div v-if="modalType === 'wanTypes'">
        <div v-for="wan in filteredWanTypes" :key="wan.vlanId" class="form-check my-3 fs-5">
          <label class="form-check-label">
            <input 
              v-model="modalValue" 
              :value="wan.vlanId" 
              class="form-check-input" 
              type="radio"
              @change="updateSelection"
            >
            {{ wan.type }}
          </label>
        </div>
        <div v-if="showPPPoECredentials" class="alert alert-success d-flex align-items-center mt-3" role="alert">
          <svg class="bi flex-shrink-0 me-2" width="24" height="24"><use xlink:href="/img/info.svg#info-fill"/></svg>
          <div>
            Login: <b>support</b> Password: <b>support2019</b>
          </div>
        </div>
        <div v-if="showResetHint" class="alert alert-success d-flex align-items-center mt-3" role="alert">
          <svg class="bi flex-shrink-0 me-2" width="24" height="24"><use xlink:href="/img/info.svg#info-fill"/></svg>
          <div style="font-family: Segoe UI, sans-serif;font-size: 0.95rem;">
            Please select <b>"Clear WAN type"</b> to disconnect all WAN connections!
          </div>
        </div>
      </div>
      
      <!-- MWS Connection Modal -->
      <div v-if="modalType === 'mwsConnection'">
        <div v-for="dev in filteredDevices" class="form-check" :key="dev.hwId" style="font-family: Segoe UI, sans-serif;font-size: 1.1rem;">
         <label v-if="dev.type === 'router'" class="form-check-label">
          <input  v-model="modalValue" :value="dev.id" class="form-check-input" type="radio">
          {{ dev.hwId }} {{ dev.shortName }}
        </label>
        </div>
      </div>
      
      <!-- DSL Settings Modal -->
      <div v-if="modalType === 'dslSettings'">
        <div v-for="wan in filteredWanTypes" :key="wan.description" class="form-check my-3 fs-5">
          <label class="form-check-label">
            <input v-model="modalValue" :value="wan.description" class="form-check-input" type="radio">
            {{ wan.description }}
          </label>
        </div>
      </div>
      
      <!-- FAQ Modal -->
      <div v-if="modalType === 'faq'" class="faq-modal-content">
   <div class="faq-header mb-3">
      <div class="language-switcher btn-group btn-group-sm ms-2">
      <button 
        @click="currentLanguage = 'en'" 
        class="btn"
        :class="{ 'btn-primary': currentLanguage === 'en', 'btn-outline-secondary': currentLanguage !== 'en' }"
      >
        EN
      </button>
      <button 
        @click="currentLanguage = 'ru'" 
        class="btn"
        :class="{ 'btn-primary': currentLanguage === 'ru', 'btn-outline-secondary': currentLanguage !== 'ru' }"
      >
        RU
      </button>
    </div>
    <div class="faq-search input-group">
      <span class="input-group-text">
        <i class="bi bi-search"></i>
      </span>
      <input 
        v-model="faqSearchQuery" 
        type="text" 
        class="form-control" 
        :placeholder="currentLanguage === 'en' ? 'Search in FAQ...' : 'Поиск в частых вопросах'"
        @keyup.esc="faqSearchQuery = ''"
      >
    </div>
    </div>
        <div class="accordion" id="faqAccordion">
          <div 
            v-for="(item, index) in filteredFaqItems" 
            :key="item.id" 
            class="accordion-item"
          >
            <h2 class="accordion-header">
              <button 
                class="accordion-button collapsed" 
                type="button" 
                data-bs-toggle="collapse" 
                :data-bs-target="'#faqCollapse' + index"
              >
                {{ item.question }}
              </button>
            </h2>
            <div 
              :id="'faqCollapse' + index" 
              class="accordion-collapse collapse" 
              :data-bs-parent="'#faqAccordion'"
            >
              <div class="accordion-body">
                <div class="answer-text">{{ item.answer }}</div>
                <div v-if="item.additionalInfo" class="mt-2 text-muted small">
                  {{ item.additionalInfo }}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div v-if="filteredFaqItems.length === 0" class="text-center py-3 text-muted">
          {{ currentLanguage === 'en' ? 'No questions found matching your search' : 'По вашему запросу, совпадений не найдено' }}
        </div>
      </div>
    </template>
  
    <template #footer v-if="modalType === 'wanTypes'">
      <button @click="closeModal" type="button" class="btn btn-secondary">
        Close
      </button>
      <button @click="saveChanges" class="btn btn-primary" type="button" :disabled="isLoading">
        <span v-if="isLoading" class="spinner-border spinner-border-sm me-2"></span>
        Apply changes
      </button>
    </template>
    
    <template #footer v-if="modalType === 'mwsConnection'">
      <button @click="closeModal" type="button" class="btn btn-secondary">
        Close
      </button>
      <div class="btn-group" role="group" aria-label="Group Button">
        <button @click="saveChanges('connect')" class="btn btn-primary" type="button" :disabled="isLoading">
          <span v-if="isLoading" class="spinner-border spinner-border-sm me-2" inert="true"></span>
          <span role="status">Connect</span>
        </button>
        <button @click="saveChanges('disconnect')" type="button" class="btn btn-secondary" :disabled="isLoading">
          <span role="status">Disconnect</span>
        </button>
      </div>
    </template>
    
    <template #footer v-if="modalType === 'faq'">
      <button @click="closeModal" type="button" class="btn btn-primary">
        Close
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import Modal from '@/components/Modal.vue'
import { toast } from 'vue3-toastify'

const props = defineProps({
  device: Object,
  wanTypes: {
    type: Array,
    default: () => [],
  },
  filteredDevices: {
    type: Array,
    default: () => [],
  },
  currentWanType: String,
})

const currentLanguage = ref('en')
const localizedFaqItems = {
  en: [
  {
      id: 1,
      question: "How do I change the WAN type?",
      answer: "1. On your booked device slate, click the 'Wan Type' button and select desired WAN connection type to be used for the device\n2. Open the device web interface and set up selected type of connection in the 'Internet' menu",
      additionalInfo: "PPPoE requires special credentials (provided in the modal)"
    },
    {
      id: 2,
      question: "How to connect an extender device to MWS?",
      answer: "1. Click the 'Connect to MWS' button\n2. Select your controller router from the list\n3. Click 'Connect'",
      additionalInfo: "Both devices must be powered on and accessible"
    },
    {
      id: 3,
      question: "What is the daily admin password?",
      answer: "The password changes daily and is displayed in the top panel.\nClick the 'Copy' icon to copy it.",
      additionalInfo: "Password is renewed at 03:00 UTC+3"
    },
    {
      id: 4,
      question: "How to reserve a device?",
      answer: "1. Find your device in the list\n2. Flip the 'Book' toggle\n3. Confirm reservation",
      additionalInfo: "Reservations auto-cancel after 24 hours"
    },
    {
      id: 5,
      question: "What to do if the device is not responding?",
      answer: "1. Check console connection to device\n2. If device poses no answer in the console log, please reset the device",
      additionalInfo: "If the problem persists, contact the admin"
    },
    {
      id: 6,
      question: "How to initialize the device after reset, skipping the wizard steps?",
      answer: "1. Click the 'Reset' button for your device and confirm the reset.\n2. After reboot is finished, click the 'Disable EeasyConfig' button",
      additionalInfo: "Resetting will erase all configurations and data"
    },
    {
      id: 7,
      question: "How to check device status?",
      answer: "1. Open device settings\n2. Select 'Status'\n3. View current status and logs",
      additionalInfo: "For detailed logs, connect via console"
    }
  ],
  ru: [
  {
      id: 1,
      question: "Как изменить тип WAN-подключения?",
      answer: "1. На панели устройства нажмите кнопку 'Wan Type' и укажите тип WAN-подключения, который будет использоваться для устройства\n2. Откройте веб-конфигуратор устройства и настройте выбранный тип подключения в меню 'Интернет'",
      additionalInfo: "PPPoE требует специальных учетных данных (отображаются в модальном окне)"
    },
    {
      id: 2,
      question: "Как подключить устройство-ретранслятор к MWS?",
      answer: "1. Нажмите кнопку 'Connect to MWS'\n2. Выберите маршрутизатор-контроллер из списка\n3. Нажмите кнопку 'Connect'",
      additionalInfo: "Оба устройства должны быть включены и доступны"
    },
    {
      id: 3,
      question: "Что такое ежедневный пароль администратора?",
      answer: "Пароль меняется ежедневно и отображается в верхней панели.\nНажмите на иконку 'Копировать', чтобы скопировать его.\nИспользуйте данный пароль в качестве пероля для для доступа к веб-интерфейсу устройства Keenetic с учётной записью admin.",
      additionalInfo: "Пароль обновляется в 03:00 UTC+3"
    },
    {
      id: 4,
      question: "Как зарезервировать устройство?",
      answer: "1. Найдите свое устройство в списке\n2. Перекиньте тумблер 'Book'\n3. Выберите время аренды, подтвердите резервирование",
      additionalInfo: "Резервирование автоматически отменяется в 23:59 текущего дня."
    },
    {
      id: 5,
      question: "Что делать, если устройство не отвечает?",
      answer: "1. Проверьте консольное подключение к устройству\n2. Если ответов от устройства нет в журнале консоли, выполните сброс настроек устройства",
      additionalInfo: "Если проблема сохраняется, обратитесь к администратору"
    },
    {
      id: 6,
      question: "Как инициализировать устройство после перезагрузки, минуя шаги мастера первоначальной настройки?",
      answer: "1. Нажмите кнопку 'Reset' на панельке вашего устройства и подтвердите перезагрузку.\n2. После завершения перезагрузки нажмите кнопку 'Disable EeasyConfig'",
      additionalInfo: "При сбросе будут удалены все настройки и данные"
    },
    {
      id: 7,
      question: "Что означает индикатор состояние устройства?",
      answer: "1. Зелёный индикатор - означает, что устройство отвечает на HTTP запросы.\n2.Серый индикатор - портал в состоянии инициализации, запрос был отправлен на устройство, ожидание ответа\n3. Красный индикатор - устройство не отвечает на HTTP запросы, проверьте консольное подключение, убедитесь, что питание имеется на устройстве.",
      additionalInfo: "При любой проблемной ситуации, первым делом проверяйте консольное подключение и отвечает ли устройство на него."
    },
    {
      id: 8,
      question: "Что такое LAN VNC?",
      answer: "LAN VNC - это локальный хост который подключен к кинетику кабельным соединением. Для управления этим хостом, можно использовать Web VNC клиент, который доступен по нажатию кнопки LAN VNC",
      additionalInfo: "Для доступа к VNC используйте пароль 'debian'"
    },
    {
      id: 9,
      question: "Как скопировать пароль от учетной записи admin в WEB VNC подключение?",
      answer: "1. Выберите забронированное устрйоство, нажмите на LAN VNC, вставьте пароль из буфера обмена и авторизуйтесь.\n2.Далее на портале, скопируйте пароль администратора из шапки с помощью кнопки в буфер обмена \n3. В открытом VNC окне, слева вы увидите скрытое меню, нажмите на него и выберите вторую сверху иконку 'clipboard' вставьте из буфера обмена пароль в рабочую область заметки.'\n4. Откройте браузер, выполните вход по дефолтному url http://192.168.1.1 в поле логина введите admin, в поле пароля вставьте пароль из буфера и нажмите 'Войти'",
      additionalInfo: "Для подробных журналов подключитесь через консоль"
    },
    {
      id: 10,
      question: "Как подключиться по SSH к LAN хосту за Keenetic?",
      answer: "",
      additionalInfo: ""
    },
    {
      id: 11,
      question: "Как подключиться по SSH к Keenetic?",
      answer: "",
      additionalInfo: "",
    }
    
  ]
  }
const emit = defineEmits(['save'])

const modalRef = ref(null)
const modalValue = ref(null)
const modalType = ref('')
const isLoading = ref(false)
const showPPPoECredentials = ref(false)
const showResetHint = ref(true)
const faqSearchQuery = ref('')

const modalTitle = computed(() => {
  switch (modalType.value) {
    case 'wanTypes': 
      return `WAN connection type for ${props.device?.shortName} ${props.device?.hwId}`
    case 'mwsConnection':
      return `Connecting the ${props.device?.shortName} ${props.device?.hwId} extender to:`
    case 'dslSettings':
      return `DSL settings for the ${props.device?.shortName} ${props.device?.hwId}`
    case 'faq':
      return currentLanguage.value === 'en' ? 'Frequently Asked Questions' : 'Частые вопросы' 
    default:
      return ''
  }
})

const filteredWanTypes = computed(() => {
  if (modalType.value === 'wanTypes') {
    return props.wanTypes.filter(wan => 
      wan.vlanId !== undefined && 
      wan.vlanId !== null && 
      wan.type?.trim() !== ""
    )
  } else if (modalType.value === 'dslSettings') {
    return props.wanTypes.filter(wan => 
      wan.description?.trim() !== ""
    )
  }
  return []
})

const filteredDevices = computed(() => {
  return props.filteredDevices.filter(dev => 
    dev.id && 
    dev.hwId && 
    dev.shortName
  )
})

const filteredFaqItems = computed(() => {
  const items = localizedFaqItems[currentLanguage.value] || []
  if (!faqSearchQuery.value) return items
  
  const query = faqSearchQuery.value.toLowerCase()
  return items.filter(item => 
    item.question.toLowerCase().includes(query) || 
    item.answer.toLowerCase().includes(query)
  )
})

watch(modalValue, (newVal) => {
  showPPPoECredentials.value = newVal === '747'
  showResetHint.value = newVal === null
})

const show = (type, initialValue = null) => {
  modalType.value = type
  modalValue.value = initialValue
  faqSearchQuery.value = ''
  modalRef.value?.show()
}

const closeModal = () => {
  modalValue.value = null
  modalRef.value?.hide()
  document.activeElement.blur(); 
}

const saveChanges = async (action) => {
  isLoading.value = true;
  try {
    await new Promise((resolve, reject) => {
      emit('save', {
        value: modalValue.value,
        type: modalType.value,
        action,
        callback: (success, error) => {
          if (success) {
            resolve();
          } else {
            reject(new Error(error));
          }
        }
      });
    });

    toast.success(`Changes applied for ${props.device.hwId} successfully`, {
      autoClose: 3000,
      hideProgressBar: false
    });
    closeModal();
  } catch (error) {
    console.error('Save error:', error);
    toast.error(`Failed to apply changes for ${props.device.hwId}: ${error.message}`, {
      autoClose: 5000,
      hideProgressBar: false
    });
  } finally {
    isLoading.value = false;
  }
};

defineExpose({ show })
</script>

<style scoped>
.faq-modal-content {
  max-height: 60vh;
  overflow-y: auto;
  margin-left: 0.5rem;
  margin-right: 0.5rem;
}

.accordion-button:not(.collapsed) {
  background-color: #f8f9fa;
  color: #0d6efd;
}

.accordion-body {
  background-color: #f8f9fa;
}

.faq-search {
  position: sticky;
  top: 0;
  background: white;
  padding: 0.5rem 0;
  z-index: 10;
}


.faq-header {
  position: sticky;
  top: 0;
  background: white;
  z-index: 10;
}

.faq-search .input-group-text {
  background-color: #f8f9fa;
}

.accordion-button:focus {
  box-shadow: none;
  border-color: rgba(0,0,0,.125);
}

.accordion-button:not(.collapsed) {
  background-color: #f8f9fa;
  color: #0d6efd;
  box-shadow: inset 0 -1px 0 rgba(0,0,0,.125);
}

.accordion-body {
  padding: 1rem 1.25rem;
  background-color: #f8f9fa;
}
.answer-text {
  white-space: pre-line;
}

/* Анимация для аккордеона */
.accordion-collapse {
  transition: all 0.3s ease;
}

/* Адаптивность */
@media (max-width: 768px) {
  .faq-modal-content {
    max-height: 70vh;
    overflow-y: auto;
  } 
  .accordion-button {
    padding: 0.75rem 1rem;
    font-size: 0.9rem;
  }
}
.language-switcher {
  white-space: nowrap;
}
.language-switcher .btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.7rem;
  min-width: 40px;
  transition: background-color 0.3s, color 0.3s;
}

</style>