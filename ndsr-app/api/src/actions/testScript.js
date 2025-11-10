// [file name]: testNftables.js
import { SSHManager } from './sshManager.js';
import { HOST_CONFIG } from '../utils/hostConfig.js';
import { NftablesManager } from '../utils/nftablesManager.js';


async function finalTest() {
    let sshManager = null;
    
    try {
        console.log('🔧 ФИНАЛЬНЫЙ ТЕСТ РАБОТЫ С ПРАВИЛАМИ');
        console.log('===================================\n');
        
        sshManager = new SSHManager(
            HOST_CONFIG.mainHost.host,
            HOST_CONFIG.mainHost.port,
            HOST_CONFIG.mainHost.username,
            HOST_CONFIG.mainHost.privateKeyPath,
            true
        );
        
        await sshManager.connect();

        const nftManager = new NftablesManager(sshManager);
        const port = '2610';
        const destination = '10.10.19.7:2610';

        // 1. ОЧИСТКА - удаляем ВСЕ правила для нашего destination
        console.log('1. 🧹 ОЧИСТКА всех старых правил...');
        await nftManager.deleteRule(port, destination);

        // 2. ДОБАВЛЕНИЕ - добавляем ОДНО правило
        console.log('2. 🧪 ДОБАВЛЕНИЕ одного правила...');
        await nftManager.addRule(port, destination);

        // 3. ПРОВЕРКА - проверяем что правило только одно
        console.log('3. 🔍 ПРОВЕРКА результата...');
        const checkCommand = `nft -a list chain ip nat PREROUTING | grep "tcp dport ${port}" | grep "10.10.19.7"`;
        const checkResult = await sshManager.executeCommand(checkCommand);
        
        const lines = checkResult.stdout.split('\n').filter(line => line.trim());
        console.log(`   Найдено правил: ${lines.length}`);
        
        if (lines.length === 1) {
            console.log('   ✅ СУПЕР! Правило добавлено корректно');
            console.log(`   Правило: ${lines[0]}`);
        } else {
            console.log('   ❌ ПРОБЛЕМА! Найдено несколько правил:');
            lines.forEach((line, index) => {
                console.log(`   ${index + 1}: ${line}`);
            });
        }

    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        if (sshManager) {
            sshManager.disconnect();
        }
    }
}

finalTest();