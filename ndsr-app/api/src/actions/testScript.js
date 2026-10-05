// testNdw4.js — x-ndw4-interactive: SCRAM-SHA3-512 + Argon2id
// Запуск: node testNdw4.js http://172.16.77.254:2710 '3sDjU^sx'
import http from 'http';
import crypto from 'crypto';
import { argon2id } from 'hash-wasm';

const [base, password] = process.argv.slice(2);
const login = 'admin';
const url = new URL(base);
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

function raw(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname, port: url.port || 80, path, method, headers, agent
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const BH = {
  'Accept': 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36'
};

// ── ШАГ 1: запрос сессии ──
const r1 = await raw('GET', '/auth', BH);
console.log('GET /auth:', r1.status);
console.log('WWW-Authenticate:', r1.headers['www-authenticate']);

const sc = r1.headers['set-cookie']?.[0]?.split(';')[0];
if (!sc) { console.log('⛔ нет Set-Cookie'); process.exit(1); }

const wa = r1.headers['www-authenticate'] || '';

// Надёжно: ищем endpoint в КОНКРЕТНО ndw4-фрагменте заголовка.
// Сначала режем заголовок по схемам
const ndw4Chunk = wa.split(',').find(c => c.includes('x-ndw4-interactive')) || wa;
const endpointMatch = ndw4Chunk.match(/endpoint="([^"]*)"/);
if (!endpointMatch) {
  console.log('⛔ endpoint не найден в:', ndw4Chunk);
  process.exit(1);
}
const endpoint = endpointMatch[1];
console.log('✅ схема ndw4, endpoint:', endpoint, '\n');
const ndw4 = wa.match(/x-ndw4-interactive[^,]*endpoint="([^"]*)"/);
if (!ndw4) {
  console.log('⛔ x-ndw4-interactive НЕ объявлен. Объявлено:', wa);
  process.exit(1);
}

const post = (obj) => raw('POST', endpoint, {
  ...BH, 'Cookie': sc, 'Content-Type': 'application/json',
  'Content-Length': Buffer.byteLength(JSON.stringify(obj))
}, JSON.stringify(obj));

const readData = (r) => {
  const b64 = r.headers['x-ndm-data'];
  if (!b64) {
    console.log('⛔ нет X-NDM-Data, status:', r.status);
    console.log('   ВСЕ заголовки ответа:', JSON.stringify(r.headers, null, 2));
    console.log('   body:', r.body.slice(0, 300));
    process.exit(1);
  }
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
};

// ── ФАЗА 1: запрос challenge ──
const clientNonce = crypto.randomBytes(16).toString('base64');
const p1 = await post({ login, nonce: clientNonce });
const d1 = readData(p1);
console.log('Phase 1:', p1.status, '| iter:', d1.iter, '| memcost:', d1.memcost, 'KiB');
if (d1.error || d1.e) { console.log('⛔ ошибка:', d1.error || d1.e); process.exit(1); }
if (!d1.nonce?.startsWith(clientNonce)) { console.log('⛔ nonce mismatch'); process.exit(1); }

// AuthMessage — ВАЖНО: raw значения iter/memcost ровно как пришли!
const authMessage = `login1=${login},nonce1=${clientNonce};iter2=${d1.iter},memcost2=${d1.memcost},nonce2=${d1.nonce},salt2=${d1.salt};login3=${login},nonce3=${d1.nonce}`;

// ── Вывод ключей ──
console.log('Argon2id вывод ключа...');
const saltedPassword = await argon2id({
  password,
  salt: Buffer.from(d1.salt, 'base64'),
  iterations: parseInt(d1.iter),
  memorySize: parseInt(d1.memcost),
  parallelism: 1,
  hashLength: 64,
  outputType: 'binary'
});

const clientKey = crypto.createHmac('sha3-512', Buffer.from(saltedPassword)).update('NDW4 Interactive Client Key').digest();
const storedKey = crypto.createHash('sha3-512').update(clientKey).digest();
const serverKey = crypto.createHmac('sha3-512', Buffer.from(saltedPassword)).update('NDW4 Interactive Server Key').digest();

const proof = (message) => {
  const mac = crypto.createHmac('sha3-512', storedKey).update(message).digest();
  const xored = Buffer.alloc(clientKey.length);
  for (let i = 0; i < clientKey.length; i++) xored[i] = clientKey[i] ^ mac[i];
  return xored.toString('base64');
};

// ── ФАЗА 2: client proof ──
const p2 = await post({ login, nonce: d1.nonce, proof: proof(authMessage) });
const d2 = readData(p2);
if (d2.error || d2.e) { console.log('⛔ phase2:', d2.error || d2.e, '← вероятно, неверный пароль'); process.exit(1); }

const expectedSig = crypto.createHmac('sha3-512', serverKey).update(authMessage).digest('base64');
if (d2.signature !== expectedSig) { console.log('⛔ signature mismatch'); process.exit(1); }
console.log('✅ Сервер доказал знание пароля (signature верифицирован)');

// ── ФАЗА 3: подтверждение ──
const p3 = await post({ login, nonce: d1.nonce, 'signature-proof': proof(authMessage + ';signature4=' + d2.signature) });
console.log('Phase 3:', p3.status);
if (p3.status !== 200) { console.log('⛔ phase3 failed'); process.exit(1); }

// ── Проверка сессии ──
const chk = await raw('GET', '/auth', { ...BH, 'Cookie': sc });
console.log(chk.status === 200 ? '🎉🎉🎉 АВТОРИЗАЦИЯ ПРОШЛА!' : `⚠️ GET /auth: ${chk.status}`);
if (chk.status === 200) {
  const rci = await raw('GET', '/rci/show/system/mode', { ...BH, 'Cookie': sc });
  console.log('RCI mode:', rci.status, rci.body.slice(0, 120));
}
agent.destroy();