import { reactive } from "vue";
import { io } from "socket.io-client";

export const state = reactive({
    connected: false,
    //fooEvents: [],
    //barEvents: []
});

export const socket = io(import.meta.env.VITE_WS_HOST, {path: "/ws/"});

socket.on("connect", () => {
    console.log('socket connected');
    state.connected = true;
});

socket.on("disconnect", () => {
    console.log('socket disconnected');
    state.connected = false;
});

/*socket.on("foo", (...args) => {
    state.fooEvents.push(args);
});

socket.on("bar", (...args) => {
    state.barEvents.push(args);
});*/
