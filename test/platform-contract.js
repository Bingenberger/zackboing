const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const QRCode = require('qrcode');
const BASE = process.env.BASE_URL;
const ORIGIN = process.env.ZACKBOING_EXPECTED_ORIGIN;
const mode = process.env.ZACKBOING_CONTRACT_MODE || 'game';
if (new URL(BASE).hostname.endsWith('.localhost') !== true || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  throw new Error('Contract checks require verified local TLS.');
}
let cookie = '';
let phase = 'initial';
async function api(path, method = 'GET', body) {
  const headers = { Cookie: cookie, Origin: ORIGIN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { response, body: await response.json() };
}
async function connect(origin, authenticated = false) {
  const socket = io(BASE, { transports: ['websocket'], reconnection: false,
    extraHeaders: { Origin: origin, ...(authenticated ? { Cookie: cookie } : {}) } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error('TLS websocket connection timeout')); }, 10000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timer); socket.disconnect(); reject(new Error('Websocket rejected')); });
  });
  return socket;
}
const once = (socket, event) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Event timeout: ' + event)), 15000);
  socket.once(event, value => { clearTimeout(timer); resolve(value); });
});
const ack = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));

async function main() {
  assert.equal((await api('/api/admin/users')).response.status, 401);
  const data = { email: 'tls-admin@example.invalid', name: 'Synthetic TLS', password: 'synthetic-zack-password' };
  if (mode === 'game' && process.env.ZACKBOING_TEST_EXISTING !== '1') {
    assert.equal((await api('/api/register', 'POST', data)).response.status, 403);
    const bootstrapToken = fs.readFileSync(process.env.ZACKBOING_TEST_BOOTSTRAP_FILE, 'utf8').trim();
    const registration = await api('/api/register', 'POST', { ...data, bootstrapToken });
    assert(registration.response.ok && registration.body.user.role === 'admin');
  }
  const login = await api('/api/login', 'POST', data);
  assert(login.response.ok);
  const header = login.response.headers.get('set-cookie');
  assert(header.includes('Secure') && header.includes('HttpOnly'));
  cookie = header.split(';')[0];
  const userId = login.body.user.id;
  const qr = await fetch(BASE + '/qr/123456.png', { headers: { 'X-Forwarded-Host': 'spoof.example.invalid', 'X-Forwarded-Proto': 'http' } });
  const expected = await QRCode.toBuffer(ORIGIN + '/?pin=123456', { width: 480, margin: 1 });
  assert.equal(crypto.createHash('sha256').update(Buffer.from(await qr.arrayBuffer())).digest('hex'),
               crypto.createHash('sha256').update(expected).digest('hex'));
  const wrong = await connect('https://spoof.example.invalid').then(socket => { socket.disconnect(); return false; }, () => true);
  assert(wrong);
  if (process.env.ZACKBOING_OLD_ORIGIN) {
    assert(await connect(process.env.ZACKBOING_OLD_ORIGIN).then(socket => { socket.disconnect(); return false; }, () => true));
  }
  const guest = await connect(ORIGIN);
  assert((await ack(guest, 'host:create', { quizId: 1 })).error);
  if (mode !== 'game') {
    const host = await connect(ORIGIN, true);
    host.disconnect(); guest.disconnect();
    const mine = await api('/api/quizzes');
    assert(mine.body.quizzes.some(quiz => quiz.title === 'TLS synthetic'));
    console.log(JSON.stringify({ tls: true, canonicalQr: true, websocketOrigin: true, oldOriginDenied: !!process.env.ZACKBOING_OLD_ORIGIN, userId }));
    return;
  }
  const quiz = await api('/api/quizzes', 'POST', { title: 'TLS synthetic',
    questions: [{ type: 'truefalse', text: 'Synthetic?', correct: 1, time: 5 }] });
  assert(quiz.response.ok);
  const upload = await fetch(BASE + '/api/media?name=synthetic.png', { method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'image/png' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64') });
  assert(upload.ok);
  const mediaUrl = (await upload.json()).url;
  phase = 'teacher';
  const teacher = await api('/api/admin/users', 'POST', { email: 'tls-teacher@example.invalid', name: 'Synthetic Teacher',
    password: 'synthetic-teacher-password', role: 'teacher' });
  assert(teacher.response.ok || (process.env.ZACKBOING_TEST_EXISTING === '1' && teacher.response.status === 409));
  const host = await connect(ORIGIN, true);
  const created = await ack(host, 'host:create', { quizId: quiz.body.id });
  assert(created.pin);
  assert((await ack(guest, 'player:join', { pin: created.pin, name: 'Synthetic Child' })).ok);
  const resume = new Promise(resolve => process.stdin.once('data', resolve));
  console.log('GAME_ACTIVE');
  await resume; phase = 'expired-session'; // parent verifies stop refusal and expires the original session
  assert.equal((await api('/api/me')).body.user, null);
  assert((await ack(host, 'host:create', { quizId: quiz.body.id })).error);
  phase = 'question';
  const question = once(guest, 'game:question');
  host.emit('host:start');
  await question;
  phase = 'answer';
  const results = once(host, 'game:results');
  assert((await ack(guest, 'player:answer', { index: 1 })).ok);
  await results;
  phase = 'podium';
  const podium = once(guest, 'player:podium');
  host.emit('host:next');
  await podium;
  host.disconnect(); guest.disconnect();
  console.log(JSON.stringify({ tls: true, canonicalQr: true, websocketOrigin: true, publicPinJoin: true,
    expiredSessionCannotCreateAnotherGame: true, gameCompleted: true, userId, quizId: quiz.body.id, mediaUrl }));
}
main().then(() => process.exit(0)).catch(error => { console.error('Contract check failed at ' + phase + ' (' + error.name + '); no credentials emitted.'); process.exit(1); });
