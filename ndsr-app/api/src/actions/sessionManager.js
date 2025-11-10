class SessionManager {
    constructor() {
        this.sessions = new Map(); // Хранилище сессий: key -> { sessionCookie, timestamp, type }
        this.SESSION_TTL = 30 * 60 * 1000; // 30 минут TTL
        this.ALREADY_AUTH_TTL = 5 * 60 * 1000; // 5 минут для уже авторизованных устройств
    }

    /**
     * Генерирует ключ для сессии на основе параметров
     */
    generateKey(ip, login) {
        return `${ip}_${login}`;
    }

    /**
     * Сохраняет сессию в кэш
     */
    setSession(ip, login, sessionCookie) {
        const key = this.generateKey(ip, login);
        
        let type = 'normal';
        let ttl = this.SESSION_TTL;
        
        // ✅ ОПРЕДЕЛЯЕМ ТИП СЕССИИ
        if (sessionCookie === 'ALREADY_AUTHENTICATED') {
            type = 'already_authenticated';
            ttl = this.ALREADY_AUTH_TTL; // Более короткий TTL для уже авторизованных
        }
        
        this.sessions.set(key, {
            sessionCookie,
            timestamp: Date.now(),
            type,
            ttl
        });
        
        console.log(`💾 Сессия сохранена для ${ip} (тип: ${type})`);
    }

    /**
     * Получает сессию из кэша (с проверкой TTL)
     */
    getSession(ip, login) {
        const key = this.generateKey(ip, login);
        const session = this.sessions.get(key);
        
        if (!session) {
            return null;
        }

        const now = Date.now();
        const sessionAge = now - session.timestamp;
        
        // ✅ ПРОВЕРЯЕМ TTL В ЗАВИСИМОСТИ ОТ ТИПА СЕССИИ
        const ttl = session.ttl || this.SESSION_TTL;
        
        if (sessionAge > ttl) {
            console.log(`🧹 Сессия для ${ip} устарела (тип: ${session.type}), удаляем`);
            this.sessions.delete(key);
            return null;
        }

        console.log(`💾 Используем кэшированную сессию для ${ip} (тип: ${session.type})`);
        return session.sessionCookie;
    }

    /**
     * Удаляет сессию из кэша
     */
    clearSession(ip, login) {
        const key = this.generateKey(ip, login);
        const session = this.sessions.get(key);
        
        if (session) {
            console.log(`🧹 Сессия удалена для ${ip} (тип: ${session.type})`);
            this.sessions.delete(key);
        } else {
            console.log(`ℹ️ Сессия для ${ip} не найдена в кэше`);
        }
    }

    /**
     * Очищает все устаревшие сессии
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, session] of this.sessions.entries()) {
            const ttl = session.ttl || this.SESSION_TTL;
            if (now - session.timestamp > ttl) {
                this.sessions.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`🧹 Очищено ${cleanedCount} устаревших сессий`);
        }
    }
    
    /**
     * Получает статистику по сессиям
     */
    getStats() {
        const stats = {
            total: this.sessions.size,
            normal: 0,
            already_authenticated: 0
        };
        
        for (const session of this.sessions.values()) {
            if (session.type === 'already_authenticated') {
                stats.already_authenticated++;
            } else {
                stats.normal++;
            }
        }
        
        return stats;
    }
}

// Создаем глобальный экземпляр менеджера сессий
export const sessionManager = new SessionManager();

// Периодическая очистка устаревших сессий (раз в 5 минут)
setInterval(() => {
    sessionManager.cleanupExpiredSessions();
}, 5 * 60 * 1000);

// Логируем статистику каждые 10 минут
setInterval(() => {
    const stats = sessionManager.getStats();
    console.log(`📊 Статистика сессий: всего ${stats.total} (нормальных: ${stats.normal}, уже авторизованных: ${stats.already_authenticated})`);
}, 10 * 60 * 1000);

export default sessionManager;