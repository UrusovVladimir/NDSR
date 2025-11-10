import { reactive } from "vue";
import { io } from "socket.io-client";

export const state = reactive({
    connected: false,
    //fooEvents: [],
    //barEvents: []
});

export const socket = io(import.meta.env.VITE_WS_HOST, {path: "/ws/"});

// ✅ ГЛОБАЛЬНЫЕ ОБРАБОТЧИКИ ПОДКЛЮЧЕНИЯ
socket.on("connect", () => {
    console.log('🔌 Socket connected');
    state.connected = true;
    
    // Триггерим глобальное событие для всех компонентов/stores
    window.dispatchEvent(new CustomEvent('socket:connected', {
        detail: { socketId: socket.id }
    }));
});

socket.on("disconnect", () => {
    console.log('🔌 Socket disconnected');
    state.connected = false;
    
    window.dispatchEvent(new CustomEvent('socket:disconnected'));
});

socket.on("reconnect", () => {
    console.log('🔁 Socket reconnected');
    state.connected = true;
    
    window.dispatchEvent(new CustomEvent('socket:reconnected', {
        detail: { socketId: socket.id }
    }));
});

/*socket.on("foo", (...args) => {
    state.fooEvents.push(args);
});

socket.on("bar", (...args) => {
    state.barEvents.push(args);
});*/