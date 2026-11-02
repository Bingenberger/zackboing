/* End-to-End-Test: Admin, Medien, alle Fragetypen, komplettes Spiel.
 * Nur isolierte synthetische Instanzen: explizite Migration und Bootstrapcode-Datei.
 * Keine produktiven Datenbanken oder Domains verwenden.
 */
const { io } = require('socket.io-client');

const fs = require('node:fs');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const target = new URL(BASE);
if (!['app','zackboing','localhost','127.0.0.1'].includes(target.hostname) && !target.hostname.endsWith('.localhost')) {
  throw new Error('End-to-End tests require an isolated local hostname.');
}
const BOOTSTRAP = process.env.ZACKBOING_TEST_BOOTSTRAP_FILE ? fs.readFileSync(process.env.ZACKBOING_TEST_BOOTSTRAP_FILE, 'utf8').trim() : '';
let failures = 0;

function check(label, cond, extra = '') {
  const safe = String(extra).replace(/("(?:token|hostToken|sessionToken|bootstrapToken|pin)"[ ]*:[ ]*")[^"]+/gi, "$1<redacted>");
  console.log(`${cond ? '✅' : '❌'} ${label}${safe ? ` (${safe})` : ''}`);
  if (!cond) failures++;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function once(socket, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function jsonReq(path, { method = 'GET', body, cookie, raw } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (raw) headers['Content-Type'] = raw.mime;
  else if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ? raw.buffer : body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { res, data };
}

async function main() {
  if (!BOOTSTRAP) throw new Error('ZACKBOING_TEST_BOOTSTRAP_FILE is required for this fresh synthetic database.');
  // ---------- Konten & Admin ----------
  let r = await jsonReq('/api/register', { method: 'POST', body: { email: 'admin@example.invalid', name: 'Frau Admin', password: 'geheim123', bootstrapToken: BOOTSTRAP } });
  check('Erstes Konto registriert', r.res.ok);
  check('Erstes Konto ist automatisch Admin', r.data.user && r.data.user.role === 'admin');
  const adminCookie = (r.res.headers.get('set-cookie') || '').split(';')[0];

  r = await jsonReq('/api/admin/settings', { cookie: adminCookie });
  check('Admin: Einstellungen abrufbar', r.res.ok && r.data.settings.registration_open === '0');
  check('Admin: Galerie-URL voreingestellt', r.data.settings.gallery_url === 'https://pix.foerster.rocks');

  r = await jsonReq('/api/admin/settings', { method: 'PUT', cookie: adminCookie, body: { registration_open: '0' } });
  check('Admin: Registrierung deaktiviert', r.res.ok);

  r = await jsonReq('/api/register', { method: 'POST', body: { email: 'fremd@example.invalid', name: 'Fremd', password: 'geheim123' } });
  check('Registrierung bei geschlossener Anmeldung blockiert', r.res.status === 403);

  r = await jsonReq('/api/admin/users', { method: 'POST', cookie: adminCookie, body: { email: 'lehrer@example.invalid', name: 'Herr Lehrer', password: 'geheim123', role: 'teacher' } });
  check('Admin: Konto manuell angelegt', r.res.ok);
  const teacherId = r.data.id;

  r = await jsonReq('/api/login', { method: 'POST', body: { email: 'lehrer@example.invalid', password: 'geheim123' } });
  check('Manuell angelegtes Konto kann sich anmelden', r.res.ok && r.data.user.role === 'teacher');
  const teacherCookie = (r.res.headers.get('set-cookie') || '').split(';')[0];

  r = await jsonReq('/api/admin/users', { cookie: teacherCookie });
  check('Lehrkraft hat keinen Admin-Zugriff', r.res.status === 403);

  r = await jsonReq(`/api/admin/users/${teacherId}`, { method: 'PATCH', cookie: adminCookie, body: { password: 'neues-geheim99' } });
  check('Admin: Passwort zurückgesetzt', r.res.ok);
  r = await jsonReq('/api/login', { method: 'POST', body: { email: 'lehrer@example.invalid', password: 'neues-geheim99' } });
  check('Login mit neuem Passwort klappt', r.res.ok);
  const teacherCookie2 = (r.res.headers.get('set-cookie') || '').split(';')[0];

  r = await jsonReq('/api/admin/users/1', { method: 'PATCH', cookie: adminCookie, body: { role: 'teacher' } });
  check('Letzter Admin kann nicht herabgestuft werden', r.res.status === 400);

  // ---------- Medien-Upload ----------
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  r = await jsonReq('/api/media?name=test.png', { method: 'POST', cookie: adminCookie, raw: { mime: 'image/png', buffer: png } });
  check('Medien-Upload angenommen', r.res.ok && r.data.url.startsWith('/media/'), r.data.url);
  const mediaUrl = r.data.url;
  const mediaRes = await fetch(`${BASE}${mediaUrl}`);
  check('Hochgeladene Datei abrufbar', mediaRes.ok && (mediaRes.headers.get('content-type') || '').includes('image/png'));

  r = await jsonReq('/api/media?name=boese.exe', { method: 'POST', cookie: adminCookie, raw: { mime: 'application/x-msdownload', buffer: png } });
  check('Unerlaubter Dateityp abgelehnt', r.res.status === 400);

  // ---------- Quiz mit allen Fragetypen ----------
  const questions = [
    { type: 'choice', text: '1 + 1 = ?', answers: [{ text: '1' }, { text: '2', media: { url: mediaUrl, kind: 'image' } }, { text: '3' }], correct: 1, time: 5, points: 'normal', media: { url: mediaUrl, kind: 'image' } },
    { type: 'truefalse', text: 'Die Erde ist eine Scheibe.', correct: 1, time: 5, points: 'normal' },
    { type: 'freetext', text: 'Hauptstadt von Frankreich?', accepted: ['Paris'], time: 5, points: 'normal' },
    { type: 'slider', text: 'Wie viele Bundesländer hat Deutschland? (0–100)', min: 0, max: 100, step: 1, correct: 50, tolerance: 5, time: 5, points: 'normal' },
    { type: 'order', text: 'Sortiere aufsteigend!', answers: [{ text: 'eins' }, { text: 'zwei' }, { text: 'drei' }], time: 5, points: 'normal' },
    { type: 'poll', text: 'Lieblingsfach?', answers: [{ text: 'Mathe' }, { text: 'Deutsch' }, { text: 'Sport' }], time: 5 },
    { type: 'scale', text: 'Wie gut war die Stunde?', min: 1, max: 5, minLabel: 'schlecht', maxLabel: 'super', time: 5 },
    { type: 'wordcloud', text: 'Ein Wort zum Thema Sommer!', time: 5 },
    { type: 'brainstorm', text: 'Ideen für den Wandertag?', time: 60 },
  ];
  r = await jsonReq('/api/quizzes', { method: 'POST', cookie: adminCookie, body: { title: 'Alle Typen', subject: 'Mathematik', shared: true, questions } });
  check('Quiz mit allen Fragetypen gespeichert', r.res.ok, JSON.stringify(r.data));
  const quizId = r.data.id;

  // ---------- Import / Export ----------
  {
    const res = await fetch(`${BASE}/api/quizzes/${quizId}/export`, { headers: { Cookie: adminCookie } });
    const exported = await res.json();
    check('Export: Datei-Download mit Format-Kennung', res.ok && exported.format === 'zackboing-quiz' && exported.version === 1
      && /attachment; filename="Alle-Typen\.zackboing\.json"/.test(res.headers.get('content-disposition')));
    check('Export: alle Fragen enthalten', exported.questions.length === questions.length && exported.subject === 'Mathematik');

    // Round-Trip: Export unverändert wieder importieren
    r = await jsonReq('/api/quizzes/import', { method: 'POST', cookie: adminCookie, body: exported });
    check('Import: exportierte Datei wird angenommen', r.res.ok && r.data.imported.length === 1 && r.data.warnings.length === 0, JSON.stringify(r.data));
    const rt = await jsonReq(`/api/quizzes/${r.data.imported[0].id}`, { cookie: adminCookie });
    check('Import: Round-Trip ergibt identische Fragen', JSON.stringify(rt.data.quiz.questions) === JSON.stringify(exported.questions));
    check('Import: Kopie ist nicht freigegeben', rt.data.quiz.shared === false);

    // Chatbot-Stil: minimal, mit Aliassen, Antworttext statt Index, ohne Zeitangaben
    const chatbot = {
      title: 'Vom Chatbot',
      subject: 'biologie',
      questions: [
        { type: 'quiz', text: 'Welches Organ pumpt Blut?', answers: ['Lunge', 'Herz', 'Leber'], correct: 'Herz' },
        { type: 'Wahr/Falsch', text: 'Spinnen sind Insekten.', correct: 'falsch' },
        { type: 'freetext', text: 'Wie viele Beine hat eine Spinne?', answer: '8, acht', time: 17 },
        { type: 'estimate', text: 'Wie alt wird eine Riesenschildkröte (Jahre)?', min: 0, max: 300, correct: 150, tolerance: 30 },
        { type: 'puzzle', text: 'Sortiere nach Größe (klein → groß):', answers: ['Maus', 'Katze', 'Pferd'], points: 'double' },
        { type: 'umfrage', text: 'Lieblingstier?', options: ['Hund', 'Katze'] },
        { type: 'skala', text: 'Wie spannend war das?', maxLabel: 'sehr' },
        { type: 'wortwolke', text: 'Ein Tier, das dir einfällt:' },
        { type: 'brainstorming', text: 'Was können wir für Igel tun?', media: 'https://example.org/igel.jpg' },
      ],
    };
    r = await jsonReq('/api/quizzes/import', { method: 'POST', cookie: adminCookie, body: chatbot });
    check('Import: tolerantes Chatbot-JSON wird angenommen', r.res.ok && r.data.imported.length === 1, JSON.stringify(r.data));
    check('Import: Zeitlimit-Rundung wird gemeldet', r.res.ok && r.data.warnings.some((w) => /17 s auf 20 s/.test(w)), JSON.stringify(r.data.warnings));
    const cb = (await jsonReq(`/api/quizzes/${r.data.imported[0].id}`, { cookie: adminCookie })).data.quiz;
    const cq = cb.questions;
    check('Import: Fach an Fächerliste angeglichen', cb.subject === 'Biologie');
    check('Import: Antworttext → Index, Aliasse aufgelöst',
      cq[0].type === 'choice' && cq[0].correct === 1 && cq[1].type === 'truefalse' && cq[1].correct === 1
      && cq[3].type === 'slider' && cq[4].type === 'order' && cq[5].type === 'poll' && cq[6].type === 'scale' && cq[7].type === 'wordcloud' && cq[8].type === 'brainstorm');
    check('Import: Standardwerte & Freitext-Liste aus String',
      cq[0].time === 20 && cq[0].points === 'normal' && cq[2].accepted.join('|') === '8|acht' && cq[2].time === 20
      && cq[3].step === 1 && cq[4].points === 'double' && cq[5].points === 'none' && cq[6].min === 1 && cq[6].max === 5);
    check('Import: externe Medien-URL übernommen', cq[8].media && cq[8].media.url === 'https://example.org/igel.jpg' && cq[8].media.kind === 'image');

    // Mehrere Quizze in einer Datei
    r = await jsonReq('/api/quizzes/import', { method: 'POST', cookie: adminCookie, body: [
      { title: 'A', questions: [{ type: 'truefalse', text: 'A?', correct: true }] },
      { title: 'B', questions: [{ type: 'truefalse', text: 'B?', correct: false }] },
    ] });
    check('Import: Sammeldatei mit mehreren Quizzen', r.res.ok && r.data.imported.map((q) => q.title).join() === 'A,B', JSON.stringify(r.data));

    // Fehlerfälle: verständliche Meldung, nichts wird angelegt
    const before = (await jsonReq('/api/quizzes', { cookie: adminCookie })).data.quizzes.length;
    r = await jsonReq('/api/quizzes/import', { method: 'POST', cookie: adminCookie, body: [
      { title: 'ok', questions: [{ type: 'truefalse', text: 'x', correct: true }] },
      { title: 'kaputt', questions: [{ type: 'choice', text: 'x', answers: ['a', 'b'], correct: 'Zebra' }] },
    ] });
    const after = (await jsonReq('/api/quizzes', { cookie: adminCookie })).data.quizzes.length;
    check('Import: Fehler mit Quiz- und Fragenummer', r.res.status === 400 && /^Quiz 2: Frage 1: .*Antwortliste/.test(r.data.error), r.data.error);
    check('Import: bei Fehler wird nichts angelegt (Transaktion)', before === after);
    r = await jsonReq('/api/quizzes/import', { method: 'POST', cookie: adminCookie, body: { title: 'x', questions: [{ type: 'rätsel', text: 'x' }] } });
    check('Import: unbekannter Typ wird gemeldet', r.res.status === 400 && /unbekannter Fragetyp/.test(r.data.error), r.data.error);
    r = await jsonReq('/api/quizzes/import', { method: 'POST', cookie: adminCookie, body: { title: 'x', questions: [] } });
    check('Import: leere Fragenliste wird gemeldet', r.res.status === 400 && /keine Fragen/.test(r.data.error), r.data.error);
    r = await jsonReq('/api/quizzes/import', { method: 'POST', body: chatbot });
    check('Import: ohne Anmeldung abgelehnt', r.res.status === 401);

    // Gesamt-Export & Doku
    const all = await fetch(`${BASE}/api/quizzes/export`, { headers: { Cookie: adminCookie } });
    const allData = await all.json();
    check('Export: Gesamtexport enthält alle eigenen Quizze', all.ok && allData.quizzes.length === after && allData.format === 'zackboing-quiz');
    const doc = await fetch(`${BASE}/import-format.md`);
    const docText = await doc.text();
    check('Formatdoku ist als Text abrufbar', doc.ok && /text\/plain/.test(doc.headers.get('content-type')) && docText.includes('"format": "zackboing-quiz"'));
    // Das vollständige Beispiel aus der Doku muss importierbar sein
    const example = docText.slice(docText.lastIndexOf('```json') + 7, docText.lastIndexOf('```'));
    r = await jsonReq('/api/quizzes/import', { method: 'POST', cookie: adminCookie, body: JSON.parse(example) });
    check('Formatdoku: Beispiel-Quiz lässt sich importieren', r.res.ok && r.data.imported[0].questionCount === 8 && r.data.warnings.length === 0, JSON.stringify(r.data));
  }

  // ---------- Fach, Freigabe & Bibliothek ----------
  r = await jsonReq('/api/subjects', { cookie: teacherCookie2 });
  check('Fächerliste abrufbar', r.res.ok && r.data.subjects.includes('Mathematik'));

  r = await jsonReq('/api/admin/settings', { method: 'PUT', cookie: adminCookie, body: { subjects: 'Mathematik, Deutsch, Schulgarten' } });
  check('Admin: Fächerliste anpassbar', r.res.ok);
  r = await jsonReq('/api/subjects', { cookie: teacherCookie2 });
  check('Neues Fach erscheint in der Liste', r.data.subjects.includes('Schulgarten') && r.data.subjects.length === 3);

  r = await jsonReq('/api/quizzes', { method: 'POST', cookie: adminCookie, body: { title: 'Privates Quiz', subject: 'Deutsch', shared: false, questions: [questions[1]] } });
  const privateQuizId = r.data.id;

  r = await jsonReq('/api/library', { cookie: teacherCookie2 });
  check('Bibliothek zeigt nur freigegebene Quizze', r.res.ok && r.data.quizzes.length === 1 && r.data.quizzes[0].title === 'Alle Typen');
  check('Bibliothek nennt Fach und Besitzer', r.data.quizzes[0].subject === 'Mathematik' && r.data.quizzes[0].owner === 'Frau Admin' && r.data.quizzes[0].mine === false);

  r = await jsonReq('/api/library?subject=Mathematik', { cookie: teacherCookie2 });
  check('Filter nach Fach findet Quiz', r.data.quizzes.length === 1);
  r = await jsonReq('/api/library?subject=Deutsch', { cookie: teacherCookie2 });
  check('Filter nach anderem Fach leer', r.data.quizzes.length === 0);
  r = await jsonReq('/api/library?q=typen', { cookie: teacherCookie2 });
  check('Titelsuche in der Bibliothek', r.data.quizzes.length === 1);

  r = await jsonReq(`/api/library/${quizId}/copy`, { method: 'POST', cookie: teacherCookie2 });
  check('Freigegebenes Quiz kopiert', r.res.ok);
  r = await jsonReq(`/api/library/${privateQuizId}/copy`, { method: 'POST', cookie: teacherCookie2 });
  check('Privates Quiz nicht kopierbar', r.res.status === 404);
  r = await jsonReq('/api/quizzes', { cookie: teacherCookie2 });
  check('Kopie liegt in eigener Sammlung', r.data.quizzes.length === 1 && r.data.quizzes[0].title === 'Alle Typen (von Frau Admin)' && r.data.quizzes[0].questionCount === 9);

  // Freigegebenes Quiz darf von Kollegen direkt gestartet werden, privates nicht
  const guestHost = io(BASE, { extraHeaders: { Cookie: teacherCookie2 } });
  let created2 = await emitAck(guestHost, 'host:create', { quizId });
  check('Kollege startet freigegebenes Quiz', !!created2.pin);
  created2 = await emitAck(guestHost, 'host:create', { quizId: privateQuizId });
  check('Privates Quiz für Kollegen nicht startbar', !!created2.error);
  guestHost.disconnect();

  r = await jsonReq('/api/quizzes', { method: 'POST', cookie: adminCookie, body: { title: 'Kaputt', questions: [{ type: 'slider', text: 'x', min: 10, max: 5, correct: 7, time: 5, points: 'normal' }] } });
  check('Validierung: kaputter Zahlenbereich abgelehnt', r.res.status === 400);

  // ---------- Spiel ----------
  const host = io(BASE, { extraHeaders: { Cookie: adminCookie } });
  const created = await emitAck(host, 'host:create', { quizId });
  check('Spiel eröffnet', !!created.pin);

  const anna = io(BASE);
  const ben = io(BASE);
  const annaJoin = await emitAck(anna, 'player:join', { pin: created.pin, name: 'Anna' });
  check('Anna tritt bei', annaJoin.ok);
  check('Ben tritt bei', (await emitAck(ben, 'player:join', { pin: created.pin, name: 'Ben' })).ok);

  // Avatar in der Lobby neu würfeln: anderer Avatar, Host-Lobby zieht mit
  {
    const upd = once(host, 'lobby:update');
    const sh = await emitAck(anna, 'player:shuffleAvatar', {});
    check('Lobby: Avatar-Wechsel liefert anderen Avatar', sh.ok && sh.avatar && sh.avatar !== annaJoin.avatar, JSON.stringify(sh));
    const players = (await upd).players;
    check('Lobby: Host sieht den neuen Avatar', players.find((p) => p.name === 'Anna')?.avatar === sh.avatar);
  }

  const nextQuestion = (sock) => once(sock, 'game:question', 12000);
  const results = () => Promise.all([once(anna, 'player:result'), once(ben, 'player:result'), once(host, 'game:results')]);

  // --- Q1 Auswahl (mit Medien)
  let qAnna = nextQuestion(anna);
  let qHost = nextQuestion(host);
  host.emit('host:start');
  let [qa, qh] = await Promise.all([qAnna, qHost]);
  check('Q1: Spieler sieht nur Anzahl, keine Lösung', qa.view.answerCount === 3 && qa.view.answers === undefined && qa.media === undefined);
  check('Q1: Host sieht Antworten + Medien', qh.view.answers.length === 3 && qh.media.url === mediaUrl && qh.view.answers[1].media.url === mediaUrl);
  await emitAck(anna, 'player:answer', { index: 1 });
  await emitAck(ben, 'player:answer', { index: 0 });
  let [ra, rb, rh] = await results();
  check('Q1: Anna richtig, Ben falsch', ra.correct && ra.gained >= 500 && !rb.correct);
  check('Q1: Verteilung stimmt', rh.summary.distribution.join(',') === '1,1,0' && rh.summary.correct === 1);

  // --- Q2 Wahr/Falsch
  qAnna = nextQuestion(anna);
  host.emit('host:next');
  qa = await qAnna;
  check('Q2: Wahr/Falsch mit 2 Optionen', qa.type === 'truefalse' && qa.view.answerCount === 2);
  await emitAck(anna, 'player:answer', { index: 1 });
  await emitAck(ben, 'player:answer', { index: 0 });
  [ra, rb, rh] = await results();
  check('Q2: Anna richtig (Falsch) + Serienbonus', ra.correct && ra.streak === 2 && ra.gained > 600);

  // --- Q3 Freitext
  qAnna = nextQuestion(anna);
  host.emit('host:next');
  await qAnna;
  check('Q3: Groß-/Kleinschreibung egal', (await emitAck(anna, 'player:answer', { text: '  PARIS ' })).ok);
  await emitAck(ben, 'player:answer', { text: 'London' });
  [ra, rb, rh] = await results();
  check('Q3: Freitext korrekt gewertet', ra.correct && !rb.correct);
  check('Q3: Host sieht Antwortliste', rh.summary.given.length === 2 && rh.summary.given[0].correct === true);

  // --- Q4 Schätzfrage
  qAnna = nextQuestion(anna);
  host.emit('host:next');
  await qAnna;
  await emitAck(anna, 'player:answer', { value: 52 });
  await emitAck(ben, 'player:answer', { value: 80 });
  [ra, rb, rh] = await results();
  check('Q4: Schätzung in Toleranz = richtig', ra.correct && ra.gained > 0);
  check('Q4: Weit daneben = 0 Punkte', !rb.correct && rb.gained === 0);
  check('Q4: Host sieht Durchschnitt + Ziel', rh.summary.average === 66 && rh.summary.correct === 50);

  // --- Q5 Puzzle
  qAnna = nextQuestion(anna);
  host.emit('host:next');
  qa = await qAnna;
  check('Q5: Teile kommen gemischt mit IDs an', qa.view.items.length === 3 && qa.view.items.every((i) => 'id' in i));
  const correctOrder = [...qa.view.items].sort((a, b) => a.id - b.id).map((i) => i.id);
  await emitAck(anna, 'player:answer', { order: correctOrder });
  await emitAck(ben, 'player:answer', { order: [...correctOrder].reverse() });
  [ra, rb, rh] = await results();
  check('Q5: perfekte Reihenfolge gewinnt', ra.correct && !rb.correct);
  check('Q5: Host sieht Lösung + Trefferzahl', rh.summary.correctOrder.join(',') === 'eins,zwei,drei' && rh.summary.perfectCount === 1);

  const annaScoreAfterQ5 = ra.score;

  // --- Q6 Umfrage (keine Punkte)
  qAnna = nextQuestion(anna);
  host.emit('host:next');
  qa = await qAnna;
  check('Q6: Umfrage ist unbewertet markiert', qa.scored === false);
  await emitAck(anna, 'player:answer', { index: 2 });
  await emitAck(ben, 'player:answer', { index: 2 });
  [ra, rb, rh] = await results();
  check('Q6: keine Punkte vergeben', ra.scored === false && ra.score === annaScoreAfterQ5);
  check('Q6: Stimmen gezählt', rh.summary.distribution.join(',') === '0,0,2' && rh.summary.correct === null);

  // --- Q7 Skala
  qAnna = nextQuestion(anna);
  host.emit('host:next');
  await qAnna;
  await emitAck(anna, 'player:answer', { value: 4 });
  await emitAck(ben, 'player:answer', { value: 5 });
  [ra, rb, rh] = await results();
  check('Q7: Skala-Durchschnitt stimmt', rh.summary.average === 4.5 && rh.summary.distribution[4] === 1);

  // --- Q8 Wortwolke
  qAnna = nextQuestion(anna);
  host.emit('host:next');
  await qAnna;
  await emitAck(anna, 'player:answer', { text: 'Eis' });
  await emitAck(ben, 'player:answer', { text: '  eis ' });
  [ra, rb, rh] = await results();
  check('Q8: Wortwolke bündelt gleiche Wörter', rh.summary.words.length === 1 && rh.summary.words[0].count === 2);

  // --- Q9 Brainstorming (endet nur per Host)
  qAnna = nextQuestion(anna);
  host.emit('host:next');
  await qAnna;
  const live = once(host, 'game:liveEntry');
  await emitAck(anna, 'player:answer', { text: 'Kletterwald' });
  check('Q9: Idee erscheint live beim Host', (await live).text === 'Kletterwald');
  await emitAck(anna, 'player:answer', { text: 'Zoo' });
  check('Q9: Duplikate abgelehnt', !!(await emitAck(anna, 'player:answer', { text: 'zoo' })).error);
  await emitAck(ben, 'player:answer', { text: 'Freibad' });
  await wait(300);
  const resultPromise = results();
  host.emit('host:skip');
  [ra, rb, rh] = await resultPromise;
  check('Q9: alle Ideen gesammelt', rh.summary.ideas.length === 3);

  // --- Podium
  const podiumHost = once(host, 'game:podium');
  const podiumAnna = once(anna, 'player:podium');
  host.emit('host:next');
  const [ph, pa] = await Promise.all([podiumHost, podiumAnna]);
  check('Podium: Anna gewinnt', ph.board[0].name === 'Anna');
  check('Podium: nur Wissensfragen gezählt', pa.totalQuestions === 5 && pa.correctCount === 5);

  host.disconnect();
  anna.disconnect();
  ben.disconnect();

  // ---------- Verbindungsabbrüche & Wiedereinstieg ----------
  const host2 = io(BASE, { extraHeaders: { Cookie: adminCookie } });
  const created3 = await emitAck(host2, 'host:create', { quizId });
  check('Host bekommt Wiedereinstiegs-Token', !!created3.hostToken);

  let carla = io(BASE);
  const joinAck = await emitAck(carla, 'player:join', { pin: created3.pin, name: 'Carla' });
  check('Beitritt liefert Wiedereinstiegs-Token', joinAck.ok && !!joinAck.token && joinAck.pin === created3.pin);
  const dave = io(BASE);
  await emitAck(dave, 'player:join', { pin: created3.pin, name: 'Dave' });

  // Abbruch in der Lobby: Platz bleibt reserviert (ausgegraut), kein Rauswurf
  let lobbyUpd = once(host2, 'lobby:update');
  carla.disconnect();
  const lu = await lobbyUpd;
  check('Lobby: Getrennte bleiben reserviert', lu.players.length === 2 && lu.players.some((p) => p.name === 'Carla' && p.connected === false));

  carla = io(BASE);
  let re = await emitAck(carla, 'player:rejoin', { pin: created3.pin, token: joinAck.token });
  check('Lobby: Wiedereinstieg klappt', re.ok === true && re.state === 'lobby' && re.name === 'Carla');

  // Abbruch mitten in der Frage: zurück mit Spielstand und Restzeit
  let q3 = once(carla, 'game:question', 12000);
  host2.emit('host:start');
  await q3;
  await wait(200);
  carla.disconnect();
  await wait(200);
  carla = io(BASE);
  re = await emitAck(carla, 'player:rejoin', { pin: created3.pin, token: joinAck.token });
  check('Frage: Wiedereinstieg liefert laufende Frage', re.ok === true && re.state === 'question'
    && re.question.answered === false && re.question.elapsedMs > 0 && re.question.view.answerCount === 3);

  const eve = io(BASE);
  check('Falsches Token wird abgelehnt', !!(await emitAck(eve, 'player:rejoin', { pin: created3.pin, token: 'falsch' })).error);
  eve.disconnect();

  const res3 = Promise.all([once(carla, 'player:result'), once(dave, 'player:result')]);
  await emitAck(carla, 'player:answer', { index: 1 });
  await emitAck(dave, 'player:answer', { index: 1 });
  const [rc3] = await res3;
  check('Antwort nach Wiedereinstieg zählt', rc3.correct && rc3.gained > 0);

  // Host-Abbruch: Spiel läuft weiter, Beamer holt sich den Stand zurück
  const host2b = io(BASE, { extraHeaders: { Cookie: adminCookie } });
  host2.disconnect();
  const resyncResults = once(host2b, 'game:results', 5000);
  const hre = await emitAck(host2b, 'host:rejoin', { pin: created3.pin, token: created3.hostToken });
  check('Host-Wiedereinstieg: Spiel lebt noch', hre.ok === true && hre.state === 'results' && hre.players.length === 2);
  const rr = await resyncResults;
  check('Host-Wiedereinstieg: Ergebnis-Re-Sync', rr.resync === true && rr.summary.distribution.join(',') === '0,2,0');

  host2b.disconnect();
  carla.disconnect();
  dave.disconnect();

  // ---------- Kopfrechenrunde ----------
  {
    // Generator: Aufgaben korrekt, ganzzahlig, nicht negativ, im Zahlenraum
    const mentalGen = require('../server/mental');
    let genOk = true;
    for (const range of mentalGen.RANGES) {
      for (const op of mentalGen.OPERATIONS) {
        for (const q of mentalGen.generateQuestions(mentalGen.normalizeConfig({ range, ops: [op], count: 50 }), 300)) {
          const [a, sym, b] = q.text.split(' ');
          const val = { '+': +a + +b, '−': +a - +b, '·': +a * +b, ':': +a / +b }[sym];
          if (val !== q.correct || !Number.isInteger(val) || val < 0 || +a > range || +b > range || val > range) genOk = false;
        }
      }
    }
    check('Kopfrechnen: Generator liefert nur gültige Aufgaben', genOk);

    // Anlegen & Validierung
    const cfg = { count: 10, range: 20, ops: ['add', 'mul'], time: 5 };
    r = await jsonReq('/api/quizzes', { method: 'POST', cookie: adminCookie, body: { mode: 'mental', title: 'Einmaleins', subject: 'Mathematik', shared: true, mental: cfg } });
    check('Kopfrechnen: Runde gespeichert', r.res.ok, JSON.stringify(r.data));
    const mentalId = r.data.id;
    r = await jsonReq('/api/quizzes', { method: 'POST', cookie: adminCookie, body: { mode: 'mental', title: 'x', mental: { ...cfg, ops: [] } } });
    check('Kopfrechnen: ohne Rechenart abgelehnt', r.res.status === 400 && /Rechenart/.test(r.data.error), r.data.error);
    r = await jsonReq('/api/quizzes', { method: 'POST', cookie: adminCookie, body: { mode: 'mental', title: 'x', mental: { ...cfg, range: 50 } } });
    check('Kopfrechnen: ungültiger Zahlenraum abgelehnt', r.res.status === 400 && /Zahlenraum/.test(r.data.error), r.data.error);
    r = await jsonReq('/api/quizzes', { method: 'POST', cookie: adminCookie, body: { mode: 'mental', title: 'x', mental: { ...cfg, count: 99 } } });
    check('Kopfrechnen: zu viele Aufgaben abgelehnt', r.res.status === 400 && /Aufgabenzahl/.test(r.data.error), r.data.error);

    r = await jsonReq(`/api/quizzes/${mentalId}`, { cookie: adminCookie });
    check('Kopfrechnen: Einstellungen abrufbar', r.data.quiz.mode === 'mental' && r.data.quiz.mental.range === 20 && r.data.quiz.mental.ops.join() === 'add,mul');
    r = await jsonReq(`/api/quizzes/${mentalId}`, { method: 'PUT', cookie: adminCookie, body: { mode: 'mental', title: 'Einmaleins', subject: 'Mathematik', shared: true, mental: { ...cfg, ops: ['mul', 'add', 'mul'] } } });
    check('Kopfrechnen: Bearbeiten speichert (Rechenarten sortiert, doppelte entfernt)', r.res.ok
      && (await jsonReq(`/api/quizzes/${mentalId}`, { cookie: adminCookie })).data.quiz.mental.ops.join() === 'add,mul');
    const listed = (await jsonReq('/api/quizzes', { cookie: adminCookie })).data.quizzes.find((q) => q.id === mentalId);
    check('Kopfrechnen: Liste zeigt Aufgabenzahl & Beschreibung', listed.mode === 'mental' && listed.questionCount === 10 && listed.mentalInfo === 'bis 20 · + ·', JSON.stringify(listed));
    const inLib = (await jsonReq('/api/library', { cookie: adminCookie })).data.quizzes.find((q) => q.id === mentalId);
    check('Kopfrechnen: erscheint in der Bibliothek', inLib && inLib.mode === 'mental' && inLib.questionCount === 10);
    r = await jsonReq(`/api/library/${mentalId}/copy`, { method: 'POST', cookie: adminCookie });
    const copied = (await jsonReq(`/api/quizzes/${r.data.id}`, { cookie: adminCookie })).data.quiz;
    check('Kopfrechnen: Kopie aus Bibliothek behält Einstellungen', copied.mode === 'mental' && copied.mental.ops.join() === 'add,mul');
    r = await jsonReq('/api/mental/preview', { method: 'POST', cookie: adminCookie, body: { range: 10, ops: ['sub'] } });
    check('Kopfrechnen: Vorschau liefert Beispielaufgaben', r.res.ok && r.data.examples.length === 8 && r.data.examples.every((e) => /^\d+ − \d+ = \d+$/.test(e)), JSON.stringify(r.data));

    // Export / Import
    const exp = await (await fetch(`${BASE}/api/quizzes/${mentalId}/export`, { headers: { Cookie: adminCookie } })).json();
    check('Kopfrechnen: Export enthält Modus & Einstellungen', exp.mode === 'mental' && exp.mental.count === 10 && !exp.questions);
    r = await jsonReq('/api/quizzes/import', { method: 'POST', cookie: adminCookie, body: exp });
    check('Kopfrechnen: Export lässt sich importieren', r.res.ok && r.data.imported[0].mode === 'mental' && r.data.imported[0].questionCount === 10, JSON.stringify(r.data));
    r = await jsonReq('/api/quizzes/import', { method: 'POST', cookie: adminCookie, body: { title: 'Geteilt', mode: 'kopfrechnen', mental: { range: 100, ops: ['geteilt', ':'] } } });
    const impQ = r.res.ok && (await jsonReq(`/api/quizzes/${r.data.imported[0].id}`, { cookie: adminCookie })).data.quiz;
    check('Kopfrechnen: Import tolerant (Aliasse, Standardwerte)', impQ && impQ.mental.ops.join() === 'div' && impQ.mental.count === 10 && impQ.mental.time === 20, JSON.stringify(r.data));

    // Live-Spiel: 3 Aufgaben (Lobby-Regler), automatisches Weiter, Anhalten
    const mhost = io(BASE, { extraHeaders: { Cookie: adminCookie } });
    const mc = await emitAck(mhost, 'host:create', { quizId: mentalId });
    check('Kopfrechnen: Spiel eröffnet im Kopfrechenmodus', mc.pin && mc.mode === 'mental' && mc.questionCount === 10 && mc.mental.info === 'bis 20 · + ·', JSON.stringify(mc));
    const kim = io(BASE);
    const kimJoin = await emitAck(kim, 'player:join', { pin: mc.pin, name: 'Kim' });
    check('Kopfrechnen: Kind tritt bei', kimJoin.ok);

    let prep = once(kim, 'game:prepare');
    mhost.emit('host:start', { count: 3 });
    let allTexts = [];
    for (let i = 0; i < 3; i++) {
      const p = await prep;
      if (i === 0) check('Kopfrechnen: Aufgabe wird in der Vorbereitung nicht verraten', p.type === 'arith' && p.text === '' && p.total === 3 && p.prepareMs === 3000, JSON.stringify(p));
      const q = await once(kim, 'game:question', 8000);
      allTexts.push(q.text);
      const [a, sym, b] = q.text.split(' ');
      const solution = { '+': +a + +b, '−': +a - +b, '·': +a * +b, ':': +a / +b }[sym];
      const hostRes = once(mhost, 'game:results');
      const kimRes = once(kim, 'player:result');
      // Aufgabe 2 absichtlich falsch
      const ans = await emitAck(kim, 'player:answer', { value: i === 1 ? solution + 1 : solution });
      if (i === 0) {
        check('Kopfrechnen: Aufgabe als Zahl beantwortet', ans.ok, JSON.stringify(ans));
        check('Kopfrechnen: keine Mehrfachantwort', !!(await emitAck(kim, 'player:answer', { value: solution })).error);
      }
      const [hr, kr] = await Promise.all([hostRes, kimRes]);
      if (i === 0) {
        check('Kopfrechnen: richtige Antwort gibt Punkte + Lösung', kr.correct && kr.gained >= 500 && kr.solution === `${q.text} = ${solution}`, JSON.stringify(kr));
        check('Kopfrechnen: Beamer zeigt Lösung & Trefferzahl', hr.summary.correct === solution && hr.summary.rightCount === 1 && hr.autoNextMs === 6000, JSON.stringify(hr.summary));
        const t0 = Date.now();
        const next = await once(kim, 'game:prepare', 9000);
        check('Kopfrechnen: geht ohne Klick automatisch weiter', Date.now() - t0 > 4000 && next.number === 2);
        prep = Promise.resolve(next);
      } else if (i === 1) {
        check('Kopfrechnen: falsche Antwort gibt 0 Punkte', !kr.correct && kr.gained === 0 && hr.summary.given.some((g) => g.value === solution + 1 && !g.correct));
        const held = once(mhost, 'game:autoHeld', 3000);
        mhost.emit('host:holdAuto');
        await held;
        let advanced = false;
        const onPrep = () => { advanced = true; };
        kim.once('game:prepare', onPrep);
        await wait(7000);
        check('Kopfrechnen: Anhalten stoppt das automatische Weiter', !advanced);
        kim.off('game:prepare', onPrep);
        prep = once(kim, 'game:prepare');
        mhost.emit('host:next');
      } else {
        const podium = once(kim, 'player:podium', 10000);
        const pd = await podium;
        check('Kopfrechnen: Podium nach eingestellter Aufgabenzahl', pd.totalQuestions === 3 && pd.correctCount === 2, JSON.stringify(pd));
      }
    }
    check('Kopfrechnen: Rechenarten der Runde passen zur Einstellung', allTexts.every((t) => /^\d+ [+·] \d+$/.test(t)), allTexts.join(' | '));
    mhost.disconnect();
    kim.disconnect();
  }

  // ---------- Ausschließlich lokales synthetisches Bildarchiv ----------
  if (process.env.ZACKBOING_TEST_GALLERY_URL) {
    const fixture = new URL(process.env.ZACKBOING_TEST_GALLERY_URL);
    if (!['fixture', 'localhost', '127.0.0.1'].includes(fixture.hostname)) {
      throw new Error('Gallery tests require the local fixture.');
    }
    await jsonReq('/api/admin/settings', { method: 'PUT', cookie: adminCookie,
      body: { gallery_url: fixture.origin } });
    r = await jsonReq('/api/gallery?q=hund', { cookie: adminCookie });
    check('Bildarchiv-Suche liefert lokale Fixture', r.res.ok && r.data.items.length > 0);
    if (r.res.ok && r.data.items.length) {
      const imp = await jsonReq('/api/gallery/import', { method: 'POST', cookie: adminCookie, body: { file: r.data.items[0].file } });
      check('Bildarchiv-Import speichert lokale Fixture', imp.res.ok && imp.data.url.startsWith('/media/'));
    }
  } else {
    console.log('NICHT AUSGEFÜHRT: optionales Bildarchiv ohne lokale Fixture.');
  }

  console.log(failures ? `\n${failures} Test(s) fehlgeschlagen.` : '\nAlle ausgeführten Tests bestanden. 🎉');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ Testlauf abgebrochen:', err.message);
  process.exit(1);
});
