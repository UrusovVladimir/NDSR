import { createApp } from 'vue'
import App from './App.vue'
import Vue3Toasity from 'vue3-toastify'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import { createPinia } from 'pinia' 

// PrimeVue Theme
import 'primevue/resources/themes/lara-light-indigo/theme.css'
import 'primevue/resources/primevue.min.css'
import 'primeicons/primeicons.css'
import 'primeflex/primeflex.css'

// Кастомные стили
import './assets/main.css'
import './assets/common-table-styles.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// PrimeVue
app.use(PrimeVue, { 
  ripple: true,
  inputStyle: 'outlined'
})
app.use(ToastService)
app.directive('tooltip', Tooltip)

// Vue3-Toastify
app.use(Vue3Toasity, {
  autoClose: 2000,
  position: 'top-right',
  transition: 'slide',
  closeOnClick: true,
  pauseOnHover: true,
  pauseOnFocusLoss: false,
  draggable: true,
  draggablePercent: 0.6,
  hideProgressBar: false,
  newestOnTop: true,
  rtl: false,
})

// Глобальные компоненты
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleButton from 'primevue/togglebutton'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Sidebar from 'primevue/sidebar'
import ProgressSpinner from 'primevue/progressspinner'
import Toast from 'primevue/toast'
import Dialog from 'primevue/dialog'
import Slider from 'primevue/slider'
import RadioButton from 'primevue/radiobutton'
import Accordion from 'primevue/accordion'
import AccordionTab from 'primevue/accordiontab'
import Message from 'primevue/message'
import Chip from 'primevue/chip'
import Dropdown from 'primevue/dropdown'
import ProgressBar from 'primevue/progressbar'
import Badge from 'primevue/badge'
import InputNumber from 'primevue/inputnumber' 

app.component('Button', Button)
app.component('InputText', InputText)
app.component('ToggleButton', ToggleButton)
app.component('DataTable', DataTable)
app.component('Column', Column)
app.component('Tag', Tag)
app.component('Sidebar', Sidebar)
app.component('ProgressSpinner', ProgressSpinner)
app.component('Toast', Toast)
app.component('Dialog', Dialog)
app.component('Slider', Slider)
app.component('Chip', Chip)
app.component('Message', Message)
app.component('AccordionTab', AccordionTab)
app.component('Accordion', Accordion)
app.component('RadioButton', RadioButton)
app.component('Dropdown', Dropdown)
app.component('ProgressBar', ProgressBar)
app.component('Badge', Badge)
app.component('InputNumber', InputNumber)

app.mount('#app')