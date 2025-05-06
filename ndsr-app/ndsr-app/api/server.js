import './loadEnv.js';
import {Server} from "socket.io";
import {broadcastDevicesStatus, sendInitData, setupEvents,initPasswordSystem} from "./src/socketHandler.js";

const io = new Server({
    path: "/ws/",
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
    
});
initPasswordSystem(io);
io.on("connection", (socket) => {
    setupEvents(socket, io);
    sendInitData(socket)

});

io.listen(process.env.WS_PORT);
setInterval(broadcastDevicesStatus, process.env.STATUS_CHECK_INTERVAL * 1000, io)

export{
    io
}