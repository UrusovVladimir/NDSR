import './assets/main.css'
import {createApp} from 'vue'
import App from './App.vue'
import Vue3Toasity from 'vue3-toastify';

const app = createApp(App)

app.use(Vue3Toasity,
    {
        position: 'bottom-right',
        hideProgressBar: true,
        newestOnTop: true,
    }
)

app.mount('#app')
