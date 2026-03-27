import './loadEnv.js';
import { Server } from "socket.io";
import { broadcastDevicesStatus, sendInitData, setupEvents, initPasswordSystem } from "./src/socketHandler.js";
import express from 'express';
import http from 'http';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ✅ Получаем текущую директорию
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Используем переменные из .env
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const PORT = process.env.WS_PORT || 3000; // Используем WS_PORT из .env
const STATUS_CHECK_INTERVAL = Math.max(5, parseInt(process.env.STATUS_CHECK_INTERVAL) || 10);

console.log(`🚀 Fast status check interval: ${STATUS_CHECK_INTERVAL} seconds`);
console.log(`⚡ Status check timeout: ${process.env.STATUS_CHECK_TIMEOUT} seconds`);
console.log(`📁 Upload directory: ${UPLOAD_DIR}`);

// ✅ Создаем директорию для загрузок если её нет
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log(`📁 Created upload directory: ${UPLOAD_DIR}`);
}

// ✅ Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.bin', '.img', '.tar', '.gz', '.zip'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Allowed: .bin, .img, .tar, .gz, .zip'));
        }
    }
});

// ✅ Создаем Express приложение
const app = express();

// ✅ Middleware для парсинга JSON
app.use(express.json());

// ✅ CORS для HTTP запросов
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ========== FILE MANAGER API ENDPOINTS ==========

// ✅ Загрузка файла
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    console.log(`✅ File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);
    
    res.json({
        success: true,
        file: {
            name: req.file.originalname,
            size: req.file.size,
            path: req.file.path
        }
    });
});

// ✅ Получение списка файлов
app.get('/api/files', (req, res) => {
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) {
            console.error('Failed to read upload directory:', err);
            return res.status(500).json({ error: 'Failed to read directory' });
        }
        
        const fileList = files.map(file => {
            const filePath = path.join(UPLOAD_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    size: stats.size,
                    modified: stats.mtime,
                    type: path.extname(file).substring(1)
                };
            } catch (statError) {
                console.error(`Failed to stat file ${file}:`, statError);
                return null;
            }
        }).filter(file => file !== null);
        
        res.json({ files: fileList });
    });
});

// ✅ Скачивание файла
app.get('/api/files/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(UPLOAD_DIR, filename);
    
    // Проверяем безопасность имени файла (защита от path traversal)
    const safePath = path.normalize(filePath);
    if (!safePath.startsWith(UPLOAD_DIR)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    if (fs.existsSync(safePath)) {
        res.download(safePath, filename);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// ✅ Удаление файла
app.delete('/api/files/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(UPLOAD_DIR, filename);
    
    // Проверяем безопасность имени файла
    const safePath = path.normalize(filePath);
    if (!safePath.startsWith(UPLOAD_DIR)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    fs.unlink(safePath, (err) => {
        if (err) {
            console.error(`Failed to delete file ${filename}:`, err);
            return res.status(500).json({ error: 'Failed to delete file' });
        }
        console.log(`✅ File deleted: ${filename}`);
        res.json({ success: true });
    });
});

// ✅ Опционально: получить информацию о конкретном файле
app.get('/api/files/:filename/info', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(UPLOAD_DIR, filename);
    const safePath = path.normalize(filePath);
    
    if (!safePath.startsWith(UPLOAD_DIR)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    if (fs.existsSync(safePath)) {
        try {
            const stats = fs.statSync(safePath);
            res.json({
                name: filename,
                size: stats.size,
                modified: stats.mtime,
                type: path.extname(filename).substring(1)
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to read file info' });
        }
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// ========== СОЗДАЕМ HTTP СЕРВЕР ==========

// ✅ СОЗДАЕМ HTTP СЕРВЕР
const server = http.createServer(app);

// ✅ СОЗДАЕМ SOCKET.IO НА ОСНОВЕ HTTP СЕРВЕРА
const io = new Server(server, {
    path: "/socket.io/",
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8
});

// ✅ ИНИЦИАЛИЗАЦИЯ
initPasswordSystem(io);

io.on("connection", (socket) => {
    console.log(`🔌 New client connected. Total: ${io.engine.clientsCount}`);
    
    setupEvents(socket, io);
    sendInitData(socket);
    
    socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected. Total: ${io.engine.clientsCount}`);
    });
});

// ✅ ПЕРИОДИЧЕСКАЯ ПРОВЕРКА СТАТУСОВ
const interval = setInterval(() => {
    try {
        broadcastDevicesStatus(io);
    } catch (error) {
        console.error('Error in status check interval:', error);
    }
}, STATUS_CHECK_INTERVAL * 1000);

// ✅ Graceful shutdown
const cleanup = () => {
    console.log('🛑 Received shutdown signal, cleaning up...');
    clearInterval(interval);
    io.close();
    server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
    });
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// ✅ ЗАПУСК СЕРВЕРА
server.listen(PORT, () => {
    console.log(`✅ HTTP & WebSocket server started on port ${PORT}`);
    console.log(`📁 Upload directory: ${UPLOAD_DIR}`);
    console.log(`📡 WebSocket path: /socket.io/`);
    console.log(`📁 File API: http://localhost:${PORT}/api/files`);
    console.log(`⚡ Device status checking every ${STATUS_CHECK_INTERVAL} seconds`);
    console.log(`🚀 Server ready!`);
});