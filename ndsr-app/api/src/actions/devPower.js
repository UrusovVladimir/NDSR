import net from 'net';

async function getPortPowerStatus(deviceId, maxRetries = 3) {
  const portNum = deviceId;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[GET_POWER_STATUS] Attempt ${attempt}, port: ${portNum}`);
    
    try {
      const result = await new Promise((resolve, reject) => {
        const client = new net.Socket();
        let data = '';
        let resolved = false;
        let commandSent = false;
        
        // 1. Таймаут создаем 
        let timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            client.destroy();
            reject(new Error('Connection timeout'));
          }
        }, 5000);
        
        // 2. Обработчик ошибок
        client.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            client.destroy();
            reject(err);
          }
        });
        
        // 3. Подключаемся
        client.connect(23, '192.168.1.5', () => {
          console.log('Connected to Keenetic');
          // Обновляем таймаут для операции
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              client.destroy();
              reject(new Error('Operation timeout'));
            }
          }, 5000);
        });
        
        client.on('data', (chunk) => {
            const str = chunk.toString();
            
            if (!commandSent) {
                
                if (str.includes('(config)>')) {
                    console.log('Prompt found! Sending command now');
                    commandSent = true;
                    data = '';
                    client.write('show channels\n');
                }
                return;
            }
            
            if (resolved) return;
            
            data += str;
            
            const regex = new RegExp(`name: ${portNum}[\\s\\S]*?power: (on|off)`, 'm');
            const match = data.match(regex);
            
            if (match) {
                resolved = true;
                clearTimeout(timeout);
                client.destroy();
                resolve({ port: portNum, power: match[1]});
            }
        });
                
        client.on('close', () => {
          console.log('Connection closed');
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            reject(new Error('Connection closed unexpectedly'));
          }
        });
      });
      
      console.log('[GET_POWER_STATUS] Result:', result);
      return result;
      
    } catch (error) {
      console.error(`[GET_POWER_STATUS] Attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Тест
getPortPowerStatus(1)
  .then(result => console.log('Final result:', result.power))
  .catch(err => console.error('Failed:', err.message));