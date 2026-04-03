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
const PORT = process.env.WS_PORT || 3000; 
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
        const originalName = file.originalname;
        const filePath = path.join(UPLOAD_DIR, originalName);
        
        if (fs.existsSync(filePath)) {
            const nameWithoutExt = path.parse(originalName).name;
            const ext = path.parse(originalName).ext;
            const timestamp = Date.now();
            cb(null, `${nameWithoutExt}_${timestamp}${ext}`);
        } else {
            cb(null, originalName);
        }
    }
});

const upload = multer({
    storage,
    limits: { 
        fileSize: 100 * 1024 * 1024, // 100MB per file
        files: 50
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.bin'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Allowed: .bin'));
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

// ✅ Загрузка файлов
app.post('/api/upload', (req, res) => {
    console.log('📤 Upload request received');
    
    upload.array('files', 50)(req, res, (err) => {
        // Обработка ошибок multer
        if (err) {
            console.error('❌ Upload error:', err);
            console.error('❌ Error code:', err.code);
            console.error('❌ Error message:', err.message);
            
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ 
                    success: false,
                    error: `File too large. Maximum size is 100MB per file.`,
                    code: 'FILE_TOO_LARGE'
                });
            }
            
            if (err.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({ 
                    success: false,
                    error: 'Too many files. Maximum 50 files per request.',
                    code: 'TOO_MANY_FILES'
                });
            }
            
            return res.status(400).json({ 
                success: false,
                error: err.message,
                code: err.code || 'UNKNOWN_ERROR'
            });
        }
        
        // Проверяем, есть ли файлы
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ 
                success: false,
                error: 'No files uploaded' 
            });
        }
        
        // Проверяем каждый файл на размер (дополнительная защита)
        const oversizedFiles = req.files.filter(f => f.size > 100 * 1024 * 1024);
        if (oversizedFiles.length > 0) {
            return res.status(413).json({ 
                success: false,
                error: `File(s) too large: ${oversizedFiles.map(f => f.originalname).join(', ')} (max 100MB)`,
                code: 'FILE_TOO_LARGE'
            });
        }
        
        const uploadedFiles = req.files.map(file => ({
            name: file.originalname,
            size: file.size,
            path: file.path,
            savedName: file.filename
        }));
        
        console.log(`✅ Uploaded ${uploadedFiles.length} file(s):`, uploadedFiles.map(f => f.name).join(', '));
        
        // Если загружен один файл
        if (uploadedFiles.length === 1) {
            return res.json({
                success: true,
                file: uploadedFiles[0]
            });
        }
        
        // Если несколько файлов
        res.json({
            success: true,
            files: uploadedFiles,
            count: uploadedFiles.length
        });
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
        
        fileList.sort((a, b) => new Date(b.modified) - new Date(a.modified));
        
        res.json({ files: fileList });
    });
});

// ✅ Скачивание файла
app.get('/api/files/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(UPLOAD_DIR, filename);
    
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

// ========== СОЗДАЕМ HTTP СЕРВЕР ==========

const server = http.createServer(app);

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

initPasswordSystem(io);

io.on("connection", (socket) => {
    console.log(`🔌 New client connected. Total: ${io.engine.clientsCount}`);
    
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

server.listen(PORT, () => {
    console.log(`✅ HTTP & WebSocket server started on port ${PORT}`);
    console.log(`📁 Upload directory: ${UPLOAD_DIR}`);
    console.log(`📡 WebSocket path: /socket.io/`);
    console.log(`📁 File API: http://localhost:${PORT}/api/files`);
    console.log(`⚡ Device status checking every ${STATUS_CHECK_INTERVAL} seconds`);
    console.log(`🚀 Server ready!`);
});