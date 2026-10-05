import { readFileSync, writeFileSync } from 'fs';

// 🔧 п.8: Map с автоперсистентностью. Наследник Map — ВСЕ существующие
// потребители (get/set/delete/has/forEach/entries/size) работают как раньше;
// персистентность включается перегрузкой только мутирующих методов.
// Формат файла: { "deviceId": { mode, routerId, timestamp } }.
// Ограничение: мутации полей ВНУТРИ записей (obj.x = y) не отслеживаются —
// записи менять только через set() целиком (в проекте так и есть).
export class PersistentMap extends Map {
    constructor(filePath) {
        super();
        this.__path = filePath;
        this.__load();
    }

    __save() {
        try {
            writeFileSync(this.__path, JSON.stringify(Object.fromEntries(this), null, 2));
        } catch (e) {
            console.error(`💾 PersistentMap save failed (${this.__path}): ${e.message}`);
        }
    }
    reload() {
        // super.clear(): this.clear() сохранил бы {} на диск ДО чтения файла
        super.clear();
        this.__load();
    }
    
    __load() {
        try {
            const data = JSON.parse(readFileSync(this.__path, 'utf8'));
            for (const [key, value] of Object.entries(data)) {
                super.set(key, value);
            }
            console.log(`💾 PersistentMap loaded ${this.size} entries from ${this.__path}`);
        } catch {
            console.log(`💾 PersistentMap: no state file (${this.__path}), starting fresh`);
        }

        
    }

    
    set(key, value) {
        super.set(key, value);
        this.__save();
        return this;
    }

    delete(key) {
        const had = super.delete(key);
        if (had) this.__save();
        return had;
    }

    clear() {
        super.clear();
        this.__save();
    }
}