import './assets/main.css'
import {createApp} from 'vue'
import App from './App.vue'
import Vue3Toasity from 'vue3-toastify';
// import Popper from "vue3-popper";

const app = createApp(App)

app.use(Vue3Toasity,
    {
        position: 'bottom-right',
        hideProgressBar: true,
        newestOnTop: true,
    }
)
// app.component("Popper", Popper);

app.mount('#app')
