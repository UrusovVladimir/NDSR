import './loadEnv.js';
import {Server} from "socket.io";
import {broadcastDevicesStatus, sendInitData, setupEvents} from "./src/socketHandler.js";
const io = new Server({
    path: "/ws/",
    cors: {
        origin: "*"
    }
});

io.on("connection", (socket) => {
    setupEvents(socket)
    sendInitData(socket)
});

io.listen(process.env.WS_PORT);
setInterval(broadcastDevicesStatus, process.env.STATUS_CHECK_INTERVAL * 1000, io)
