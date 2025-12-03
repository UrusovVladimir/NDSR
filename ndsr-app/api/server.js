import './loadEnv.js';
import {Server} from "socket.io";
import {broadcastDevicesStatus, sendInitData, setupEvents,initPasswordSystem} from "./src/socketHandler.js";

// ✅ УСКОРЕННЫЕ НАСТРОЙКИ
const STATUS_CHECK_INTERVAL = Math.max(5, parseInt(process.env.STATUS_CHECK_INTERVAL) || 10); // Минимум 10 секунд
const WS_PORT = process.env.WS_PORT || 3001;

console.log(`🚀 Fast status check interval: ${STATUS_CHECK_INTERVAL} seconds`);
console.log(`⚡ Status check timeout: ${process.env.STATUS_CHECK_TIMEOUT} seconds`);

// ✅ СОЗДАЕМ SERVER С ПРАВИЛЬНЫМИ НАСТРОЙКАМИ
const io = new Server(WS_PORT, {
    path: "/socket.io/",
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8
});

initPasswordSystem(io);

// ✅ ТОЛЬКО ОДИН ОБРАБОТЧИК CONNECTION (убрать дубликат)
io.on("connection", (socket) => {
    console.log(`🔌 New client connected. Total: ${io.engine.clientsCount}`);
    
    // ✅ ОТПРАВЛЯЕМ ДАННЫЕ СРАЗУ ПРИ ПОДКЛЮЧЕНИИ
    setupEvents(socket, io);
    sendInitData(socket);
    
    socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected. Total: ${io.engine.clientsCount}`);
    });
});

const interval = setInterval(() => {
    try {
        broadcastDevicesStatus(io);
    } catch (error) {
        console.error('Error in status check interval:', error);
    }
}, STATUS_CHECK_INTERVAL * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, cleaning up...');
    clearInterval(interval);
    io.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, cleaning up...');
    clearInterval(interval);
    io.close();
    process.exit(0);
});

console.log(`✅ WebSocket server started on port ${WS_PORT}`);
console.log(`⚡ Device status checking every ${STATUS_CHECK_INTERVAL} seconds`);