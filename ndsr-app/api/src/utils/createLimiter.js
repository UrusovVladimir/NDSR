// 🔧 этап 3: единый лимитер параллелизма.
// Возвращает функцию-обёртку: limit(fn) -> Promise.
// Все вызовы сверх max встают в очередь, старт следующего — через 10мс.
export function createLimiter(max) {
    let active = 0;
    const queue = [];

    return function limit(fn) {
        return new Promise((resolve, reject) => {
            const run = async () => {
                if (active >= max) {
                    queue.push(run);
                    return;
                }
                active++;
                try {
                    resolve(await fn());
                } catch (error) {
                    reject(error);
                } finally {
                    active--;
                    if (queue.length > 0) {
                        setTimeout(queue.shift(), 10);
                    }
                }
            };
            run();
        });
    };
}