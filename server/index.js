const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const db = require('./db');
const auth = require('./auth');
const engine = require('./game');
const quizformat = require('./quizformat');
const mental = require('./mental');

const config = require('./config');
const bootstrap = require('./bootstrap');
const PORT = process.env.PORT || 3000;

const app = express();
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
// Hinter einem lokalen Reverse-Proxy (nginx/Caddy auf demselben Rechner) stimmen so
// req.protocol und req.get('host') – wichtig für die QR-Code-URL. Im Schul-WLAN ohne Proxy
// ändert sich nichts.
app.set('trust proxy', config.proxyAddresses || 'loopback');
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  allowRequest: (request, callback) => {
    let ready = false;
    try { ready = db.pragma("user_version", { simple: true }) === 1; } catch { /* unavailable */ }
    callback(null, ready && config.originAllowed(request));
  },
  // Abbrüche im Schul-WLAN schnell erkennen, damit der Client zügig neu verbindet
  pingInterval: 10000,
  pingTimeout: 15000,
});

let draining = false;
function localControl(req, res, next) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
    return res.status(403).json({ error: 'Local management only.' });
  }
  next();
}
app.post('/_platform/prepare-stop', localControl, (req, res) => {
  draining = true;
  res.json({ draining, activeGames: engine.activeGameCount() });
});
app.post('/_platform/cancel-stop', localControl, (req, res) => {
  draining = false;
  res.json({ draining });
});

app.get('/health/live', (req, res) => res.json({ status: 'alive' }));
app.get('/health/ready', (req, res) => {
  try {
    if (db.pragma('user_version', { simple: true }) !== 1) throw new Error('migration required');
    db.prepare('SELECT id FROM users LIMIT 1').get();
    res.json({ status: 'ready' });
  } catch { res.status(503).json({ status: 'not-ready' }); }
});
app.use('/api', (req, res, next) => {
  if (db.pragma('user_version', { simple: true }) !== 1) {
    return res.status(503).json({ error: 'Eine explizite Datenbankmigration ist erforderlich.' });
  }
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(auth.attachUser);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/media', express.static(db.UPLOAD_DIR, { maxAge: '30d', immutable: true }));

// ---------------------------------------------------------------- Konten

app.post('/api/register', (req, res) => {
  try {
    const result = bootstrap.register(req.body);
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
  } catch (err) {
    if (err instanceof bootstrap.RegistrationError) return res.status(err.status).json({ error: err.message });
    if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits registriert.' });
    throw err;
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim());
  if (!row || !auth.verifyPassword(password || '', row.pass_hash)) {
    return res.status(401).json({ error: 'E-Mail oder Passwort ist falsch.' });
  }
  const token = auth.createSession(row.id);
  setSessionCookie(res, token);
  res.json({ user: { id: row.id, email: row.email, name: row.name, role: row.role } });
});

app.post('/api/logout', (req, res) => {
  if (req.sessionToken) auth.destroySession(req.sessionToken);
  res.setHeader('Set-Cookie', 'zackboing_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `zackboing_session=${token}; Path=/; Max-Age=${60 * 60 * 24 * 90}; HttpOnly; SameSite=Lax${config.publicOrigin.startsWith('https:') ? '; Secure' : ''}`);
}

// ---------------------------------------------------------------- Medien

const MEDIA_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'video/mp4': 'mp4', 'video/webm': 'webm',
};

app.post('/api/media', auth.requireUser, express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  const mime = (req.headers['content-type'] || '').split(';')[0].trim();
  const ext = MEDIA_EXT[mime];
  if (!ext) return res.status(400).json({ error: 'Dateityp nicht unterstützt (Bilder, Audio: mp3/ogg/wav, Video: mp4/webm).' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'Leere Datei.' });

  const filename = `${crypto.randomBytes(9).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(db.UPLOAD_DIR, filename), req.body);
  db.prepare('INSERT INTO media (user_id, filename, original_name, mime, size, source) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, filename, String(req.query.name || '').slice(0, 120), mime, req.body.length, 'upload');
  res.json({ url: `/media/${filename}`, kind: mime.split('/')[0] });
});

// Bildarchiv (pix.foerster.rocks o. Ä.) durchsuchen – Proxy wegen CORS.
app.get('/api/gallery', auth.requireUser, async (req, res) => {
  const base = db.getSetting('gallery_url').replace(/\/+$/, '');
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const url = `${base}/?${q ? `search=${encodeURIComponent(q)}&` : ''}page=${page}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const seen = new Set();
    const items = [];
    for (const match of html.matchAll(/\/static\/thumbnails\/([\w%.-]+)\.webp/g)) {
      const file = match[1];
      if (seen.has(file)) continue;
      seen.add(file);
      items.push({
        file,
        title: decodeURIComponent(file).replace(/_[0-9a-f]{6,}$/i, '').replace(/_/g, ' '),
        thumb: `${base}/static/thumbnails/${file}.webp`,
      });
    }
    res.json({ items, page, hasMore: items.length >= 24 });
  } catch (err) {
    res.status(502).json({ error: `Bildarchiv nicht erreichbar (${err.message}).` });
  }
});

// Bild aus dem Archiv lokal importieren, damit das Quiz offline funktioniert.
app.post('/api/gallery/import', auth.requireUser, async (req, res) => {
  const file = String((req.body || {}).file || '');
  if (!/^[\w%.-]{1,150}$/.test(file)) return res.status(400).json({ error: 'Ungültiger Dateiname.' });
  const base = db.getSetting('gallery_url').replace(/\/+$/, '');
  try {
    const response = await fetch(`${base}/static/display/${file}.webp`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > 15e6) throw new Error('Datei zu groß');
    const filename = `${crypto.randomBytes(9).toString('hex')}.webp`;
    fs.writeFileSync(path.join(db.UPLOAD_DIR, filename), buf);
    db.prepare('INSERT INTO media (user_id, filename, original_name, mime, size, source) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, filename, file.slice(0, 120), 'image/webp', buf.length, 'gallery');
    res.json({ url: `/media/${filename}`, kind: 'image' });
  } catch (err) {
    res.status(502).json({ error: `Import fehlgeschlagen (${err.message}).` });
  }
});

// ---------------------------------------------------------------- Quizze

const TIMES = [5, 10, 20, 30, 60, 90, 120];

function validMedia(media) {
  if (media == null) return true;
  if (typeof media !== 'object' || typeof media.url !== 'string') return false;
  if (!['image', 'audio', 'video'].includes(media.kind)) return false;
  return media.url.startsWith('/media/') || /^https?:\/\//.test(media.url);
}

// Normalisiert und prüft eine Frage; wirft bei Fehlern einen String.
function normalizeQuestion(q, nr) {
  const fail = (msg) => { throw `Frage ${nr}: ${msg}`; };
  if (typeof q !== 'object' || q === null) fail('ungültiges Format.');

  const type = q.type || 'choice';
  if (!engine.ALL_TYPES.includes(type)) fail('unbekannter Fragetyp.');
  if (!q.text || !String(q.text).trim()) fail('der Fragetext fehlt.');
  if (!TIMES.includes(q.time)) fail('ungültiges Zeitlimit.');
  if (!validMedia(q.media)) fail('ungültige Medienangabe.');

  const opinion = engine.OPINION_TYPES.includes(type);
  const points = opinion ? 'none' : (q.points || 'normal');
  if (!['normal', 'double', 'none'].includes(points)) fail('ungültige Punkteeinstellung.');

  const out = {
    type,
    text: String(q.text).trim().slice(0, 200),
    time: q.time,
    points,
    media: q.media ? { url: q.media.url, kind: q.media.kind } : null,
  };

  // Antwortlisten normalisieren (Altbestand: reine Strings)
  const answers = (q.answers || []).map((a) => (typeof a === 'string' ? { text: a } : a || {}))
    .map((a) => ({
      text: String(a.text || '').trim().slice(0, 90),
      media: validMedia(a.media) && a.media ? { url: a.media.url, kind: 'image' } : null,
    }));

  switch (type) {
    case 'choice':
    case 'poll': {
      if (answers.length < 2 || answers.length > 4) fail('2 bis 4 Antworten nötig.');
      if (answers.some((a) => !a.text && !a.media)) fail('jede Antwort braucht Text oder ein Bild.');
      out.answers = answers;
      if (type === 'choice') {
        if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= answers.length) fail('keine richtige Antwort markiert.');
        out.correct = q.correct;
      }
      break;
    }
    case 'truefalse': {
      if (![0, 1].includes(q.correct)) fail('bitte Wahr oder Falsch als richtig markieren.');
      out.correct = q.correct;
      out.answers = [{ text: 'Wahr' }, { text: 'Falsch' }];
      break;
    }
    case 'freetext': {
      const accepted = (q.accepted || []).map((s) => String(s).trim().slice(0, 80)).filter(Boolean);
      if (!accepted.length) fail('mindestens eine richtige Antwort angeben.');
      if (accepted.length > 10) fail('höchstens 10 richtige Antworten.');
      out.accepted = accepted;
      break;
    }
    case 'slider': {
      const min = Number(q.min), max = Number(q.max), step = Number(q.step) || 1;
      const correct = Number(q.correct), tolerance = Math.max(0, Number(q.tolerance) || 0);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) fail('ungültiger Zahlenbereich.');
      if (!Number.isFinite(step) || step <= 0 || (max - min) / step > 2000) fail('ungültige Schrittweite.');
      if (!Number.isFinite(correct) || correct < min || correct > max) fail('die richtige Zahl muss im Bereich liegen.');
      Object.assign(out, { min, max, step, correct, tolerance });
      break;
    }
    case 'order': {
      if (answers.length < 2 || answers.length > 6) fail('2 bis 6 Schritte nötig.');
      if (answers.some((a) => !a.text)) fail('jeder Schritt braucht einen Text.');
      out.answers = answers.map((a) => ({ text: a.text }));
      break;
    }
    case 'scale': {
      const min = Number.isInteger(q.min) ? q.min : 1;
      const max = Number.isInteger(q.max) ? q.max : 5;
      if (min < 0 || min > 1 || max < min + 1 || max > 10) fail('Skala: min 0/1, max bis 10.');
      out.min = min;
      out.max = max;
      out.minLabel = String(q.minLabel || '').trim().slice(0, 40);
      out.maxLabel = String(q.maxLabel || '').trim().slice(0, 40);
      break;
    }
    case 'wordcloud':
    case 'brainstorm':
      break;
  }
  return out;
}

function validateAndNormalize(questions) {
  if (!Array.isArray(questions)) throw 'Ungültiges Fragenformat.';
  return questions.map((q, i) => normalizeQuestion(q, i + 1));
}

function subjectsList() {
  return db.getSetting('subjects').split(',').map((s) => s.trim()).filter(Boolean);
}

function cleanSubject(subject) {
  return String(subject || '').trim().slice(0, 40);
}

// Quiz-Inhalt aus dem Request prüfen: normales Quiz (Fragen) oder Kopfrechenrunde (Einstellungen).
// Liefert die Spaltenwerte { mode, questions, mental }; wirft bei Fehlern einen String.
function quizContentFromBody(body) {
  if (body.mode === 'mental') {
    return { mode: 'mental', questions: '[]', mental: JSON.stringify(mental.normalizeConfig(body.mental)) };
  }
  return { mode: 'quiz', questions: JSON.stringify(validateAndNormalize(body.questions || [])), mental: null };
}

// Kennzahlen für Listen: Anzahl Fragen bzw. Aufgaben + Kurzbeschreibung der Runde
function quizListInfo(row) {
  if (row.mode === 'mental') {
    const cfg = JSON.parse(row.mental);
    return { mode: 'mental', questionCount: cfg.count, mentalInfo: mental.describe(cfg) };
  }
  return { mode: 'quiz', questionCount: JSON.parse(row.questions).length };
}

app.get('/api/subjects', auth.requireUser, (req, res) => {
  res.json({ subjects: subjectsList() });
});

app.get('/api/quizzes', auth.requireUser, (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, subject, shared, questions, mode, mental, updated_at FROM quizzes
    WHERE user_id = ? ORDER BY updated_at DESC
  `).all(req.user.id);
  res.json({
    quizzes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      subject: r.subject,
      shared: !!r.shared,
      ...quizListInfo(r),
      updatedAt: r.updated_at,
    })),
  });
});

app.post('/api/quizzes', auth.requireUser, (req, res) => {
  const body = req.body || {};
  const { title, subject, shared } = body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Bitte einen Titel angeben.' });
  try {
    const content = quizContentFromBody(body);
    const info = db.prepare('INSERT INTO quizzes (user_id, title, subject, shared, questions, mode, mental) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, title.trim(), cleanSubject(subject), shared ? 1 : 0, content.questions, content.mode, content.mental);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    if (typeof e === 'string') return res.status(400).json({ error: e });
    throw e;
  }
});

// Kopfrechenrunde: Beispielaufgaben für die Vorschau im Editor
app.post('/api/mental/preview', auth.requireUser, (req, res) => {
  try {
    const cfg = mental.normalizeConfig({ ...(req.body || {}), count: mental.DEFAULTS.count });
    res.json({ examples: mental.generateQuestions(cfg, 8).map((q) => `${q.text} = ${q.correct}`) });
  } catch (e) {
    if (typeof e === 'string') return res.status(400).json({ error: e });
    throw e;
  }
});

// ------------------------- Import / Export (Format: docs/import-format.md)

function sendExport(res, filename, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
}

// Alle eigenen Quizze als Sammeldatei (Sicherung)
app.get('/api/quizzes/export', auth.requireUser, (req, res) => {
  const rows = db.prepare('SELECT * FROM quizzes WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
  const stamp = new Date().toISOString().slice(0, 10);
  sendExport(res, `zackboing-alle-quizze-${stamp}.json`, {
    format: quizformat.FORMAT,
    version: quizformat.VERSION,
    quizzes: rows.map(quizformat.exportQuiz),
  });
});

app.get('/api/quizzes/:id/export', auth.requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM quizzes WHERE id = ? AND (user_id = ? OR shared = 1)').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Quiz nicht gefunden.' });
  sendExport(res, quizformat.exportFilename(row.title), quizformat.exportQuiz(row));
});

// Import: ein Quiz, eine Liste oder { quizzes: [...] }. Antwort: angelegte Quizze + Hinweise.
app.post('/api/quizzes/import', auth.requireUser, (req, res) => {
  let items;
  try { items = quizformat.unpackImport(req.body); } catch (e) {
    if (typeof e === 'string') return res.status(400).json({ error: e });
    throw e;
  }
  if (!items.length) return res.status(400).json({ error: 'Die Datei enthält kein Quiz.' });
  if (items.length > 50) return res.status(400).json({ error: 'Höchstens 50 Quizze pro Import.' });

  const imported = [];
  const warnings = [];
  const insert = db.prepare('INSERT INTO quizzes (user_id, title, subject, shared, questions, mode, mental) VALUES (?, ?, ?, 0, ?, ?, ?)');
  try {
    db.transaction(() => {
      items.forEach((raw, i) => {
        const label = items.length > 1 ? `Quiz ${i + 1}: ` : '';
        let quiz;
        try {
          quiz = quizformat.importQuiz(raw, { uploadDir: db.UPLOAD_DIR, validate: validateAndNormalize, subjects: subjectsList(), mental });
        } catch (e) {
          if (typeof e === 'string') throw label + e;
          throw e;
        }
        const info = insert.run(req.user.id, quiz.title, cleanSubject(quiz.subject), JSON.stringify(quiz.questions),
          quiz.mode, quiz.mental ? JSON.stringify(quiz.mental) : null);
        imported.push({
          id: info.lastInsertRowid,
          title: quiz.title,
          mode: quiz.mode,
          questionCount: quiz.mental ? quiz.mental.count : quiz.questions.length,
        });
        for (const w of quiz.warnings) warnings.push(`${label}${w}`);
      });
    })();
  } catch (e) {
    if (typeof e === 'string') return res.status(400).json({ error: e });
    throw e;
  }
  res.json({ imported, warnings });
});

// Beschreibung des Importformats – als Text, damit sie im Browser lesbar ist und
// sich direkt als Anleitung für einen Chatbot kopieren lässt.
app.get('/import-format.md', (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.sendFile(path.join(__dirname, '..', 'docs', 'import-format.md'));
});

app.get('/api/quizzes/:id', auth.requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM quizzes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Quiz nicht gefunden.' });
  res.json({
    quiz: {
      id: row.id,
      title: row.title,
      subject: row.subject,
      shared: !!row.shared,
      mode: row.mode,
      mental: row.mental ? JSON.parse(row.mental) : null,
      questions: JSON.parse(row.questions),
    },
  });
});

app.put('/api/quizzes/:id', auth.requireUser, (req, res) => {
  const body = req.body || {};
  const { title, subject, shared } = body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Bitte einen Titel angeben.' });
  try {
    const content = quizContentFromBody(body);
    const info = db.prepare(`
      UPDATE quizzes SET title = ?, subject = ?, shared = ?, questions = ?, mode = ?, mental = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(title.trim(), cleanSubject(subject), shared ? 1 : 0, content.questions, content.mode, content.mental, req.params.id, req.user.id);
    if (!info.changes) return res.status(404).json({ error: 'Quiz nicht gefunden.' });
    res.json({ ok: true });
  } catch (e) {
    if (typeof e === 'string') return res.status(400).json({ error: e });
    throw e;
  }
});

// ------------------------- Bibliothek: freigegebene Quizze aller Lehrkräfte

app.get('/api/library', auth.requireUser, (req, res) => {
  const subject = cleanSubject(req.query.subject);
  const q = String(req.query.q || '').trim();
  let sql = `
    SELECT q.id, q.title, q.subject, q.questions, q.mode, q.mental, q.updated_at, u.name AS owner, q.user_id
    FROM quizzes q JOIN users u ON u.id = q.user_id
    WHERE q.shared = 1
  `;
  const params = [];
  if (subject) { sql += ' AND q.subject = ?'; params.push(subject); }
  if (q) { sql += ' AND q.title LIKE ?'; params.push(`%${q}%`); }
  sql += " ORDER BY CASE WHEN q.subject = '' THEN 1 ELSE 0 END, q.subject, q.title";
  const rows = db.prepare(sql).all(...params);
  res.json({
    quizzes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      subject: r.subject,
      owner: r.owner,
      mine: r.user_id === req.user.id,
      ...quizListInfo(r),
      updatedAt: r.updated_at,
    })),
  });
});

// Freigegebenes Quiz in die eigene Sammlung kopieren (zum Anpassen)
app.post('/api/library/:id/copy', auth.requireUser, (req, res) => {
  const row = db.prepare(`
    SELECT q.*, u.name AS owner FROM quizzes q JOIN users u ON u.id = q.user_id
    WHERE q.id = ? AND (q.shared = 1 OR q.user_id = ?)
  `).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Quiz nicht gefunden oder nicht freigegeben.' });
  const title = row.user_id === req.user.id ? `${row.title} (Kopie)` : `${row.title} (von ${row.owner})`;
  const info = db.prepare('INSERT INTO quizzes (user_id, title, subject, shared, questions, mode, mental) VALUES (?, ?, ?, 0, ?, ?, ?)')
    .run(req.user.id, title.slice(0, 80), row.subject, row.questions, row.mode, row.mental);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/quizzes/:id', auth.requireUser, (req, res) => {
  db.prepare('DELETE FROM quizzes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Admin

app.get('/api/admin/users', auth.requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.created_at,
           (SELECT COUNT(*) FROM quizzes q WHERE q.user_id = u.id) AS quiz_count
    FROM users u ORDER BY u.created_at
  `).all();
  res.json({ users });
});

app.post('/api/admin/users', auth.requireAdmin, (req, res) => {
  const { email, name, password, role } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Bitte einen Namen angeben.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Das Passwort braucht mindestens 8 Zeichen.' });
  if (!['teacher', 'admin'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle.' });
  try {
    const info = db.prepare('INSERT INTO users (email, name, pass_hash, role) VALUES (?, ?, ?, ?)')
      .run(email.trim(), name.trim(), auth.hashPassword(password), role);
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits registriert.' });
    throw err;
  }
});

app.patch('/api/admin/users/:id', auth.requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  const { name, role, password } = req.body || {};

  if (role !== undefined) {
    if (!['teacher', 'admin'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle.' });
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (target.role === 'admin' && role === 'teacher' && adminCount <= 1) {
      return res.status(400).json({ error: 'Es muss mindestens ein Admin-Konto geben.' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  }
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Der Name darf nicht leer sein.' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), target.id);
  }
  if (password !== undefined) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Das Passwort braucht mindestens 8 Zeichen.' });
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(String(password)), target.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  }
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', auth.requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: 'Du kannst dein eigenes Konto nicht löschen.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ ok: true });
});

app.get('/api/admin/settings', auth.requireAdmin, (req, res) => {
  res.json({ settings: db.allSettings() });
});

app.put('/api/admin/settings', auth.requireAdmin, (req, res) => {
  const { registration_open, gallery_url, subjects } = req.body || {};
  if (registration_open !== undefined) db.setSetting('registration_open', registration_open === '1' || registration_open === true ? '1' : '0');
  if (gallery_url !== undefined) {
    const url = String(gallery_url).trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/[\w.-]+/.test(url)) return res.status(400).json({ error: 'Ungültige Galerie-URL.' });
    db.setSetting('gallery_url', url || 'https://pix.foerster.rocks');
  }
  if (subjects !== undefined) {
    const list = String(subjects).split(',').map((s) => s.trim().slice(0, 40)).filter(Boolean);
    if (!list.length) return res.status(400).json({ error: 'Mindestens ein Fach angeben.' });
    db.setSetting('subjects', list.join(', '));
  }
  res.json({ settings: db.allSettings() });
});

// QR-Code für den Spielbeitritt (PNG). Nutzt die Adresse, über die der Host
// die Seite aufgerufen hat – so funktioniert es auch im Schul-WLAN per IP.
app.get('/qr/:pin.png', async (req, res) => {
  const url = config.joinUrl(req, req.params.pin);
  const png = await QRCode.toBuffer(url, { width: 480, margin: 1 });
  res.type('png').send(png);
});

// ---------------------------------------------------------------- Live-Spiel

function hostRoom(game) { return `game:${game.pin}:host`; }
function playerRoom(game) { return `game:${game.pin}:players`; }

function lobbyPlayers(game) {
  return [...game.players.values()].map((p) => ({ name: p.name, avatar: p.avatar, connected: p.connected }));
}

function questionMeta(game) {
  const question = engine.currentQuestion(game);
  const arith = question.type === 'arith';
  return {
    number: game.qIndex + 1,
    total: game.questions.length,
    type: question.type,
    text: question.text,
    time: question.time,
    points: question.points,
    scored: engine.SCORED_TYPES.includes(question.type),
    prepareMs: arith ? engine.ARITH_PREPARE_MS : engine.PREPARE_MS,
  };
}

// Vorbereitungsphase: Kopfrechenaufgaben erst beim Start zeigen, sonst hätten alle Bedenkzeit
function prepareMeta(game) {
  const meta = questionMeta(game);
  return meta.type === 'arith' ? { ...meta, text: '' } : meta;
}

function answerCounts(game) {
  const active = [...game.players.values()].filter((p) => p.connected);
  return { answered: active.filter((p) => p.answer !== null).length, total: active.length };
}

// Was Host bzw. Spieler zusätzlich zur Frage sehen dürfen (nie die Lösung!).
function hostView(game, question) {
  switch (question.type) {
    case 'choice':
    case 'truefalse':
    case 'poll':
      return { answers: question.answers };
    case 'order':
      return { items: game.qShuffle.map((i) => question.answers[i].text) };
    case 'slider':
      return { min: question.min, max: question.max, step: question.step };
    case 'scale':
      return { min: question.min, max: question.max, minLabel: question.minLabel, maxLabel: question.maxLabel };
    default:
      return {};
  }
}

function playerView(game, question) {
  switch (question.type) {
    case 'choice':
    case 'poll':
      return { answerCount: question.answers.length };
    case 'truefalse':
      return { answerCount: 2 };
    case 'order':
      return { items: game.qShuffle.map((i) => ({ id: i, text: question.answers[i].text })) };
    case 'slider':
      return { min: question.min, max: question.max, step: question.step };
    case 'scale':
      return { min: question.min, max: question.max, minLabel: question.minLabel, maxLabel: question.maxLabel };
    case 'brainstorm':
      return { maxEntries: 3 };
    default:
      return {};
  }
}

// Startet die nächste Frage: erst Vorbereitungsphase, dann die Frage selbst.
function advance(io, game) {
  clearTimeout(game.timer);
  clearTimeout(game.autoTimer);
  game.autoTimer = null;
  game.autoNextAt = 0;
  game.qIndex++;
  const question = engine.currentQuestion(game);
  if (!question) return showPodium(io, game);

  game.state = 'prepare';
  for (const p of game.players.values()) { p.answer = null; p.entries = []; }
  game.qShuffle = question.type === 'order' ? engine.shuffledIndices(question.answers.length) : null;

  const meta = questionMeta(game);
  const prep = prepareMeta(game);
  game.snapshot = { prepare: { ...prep, media: question.media, view: hostView(game, question) } };
  io.to(hostRoom(game)).emit('game:prepare', game.snapshot.prepare);
  io.to(playerRoom(game)).emit('game:prepare', prep);

  game.timer = setTimeout(() => {
    game.state = 'question';
    game.qStartedAt = Date.now();
    game.snapshot.question = { ...meta, media: question.media, view: hostView(game, question) };
    io.to(hostRoom(game)).emit('game:question', game.snapshot.question);
    io.to(playerRoom(game)).emit('game:question', { ...meta, view: playerView(game, question) });
    game.timer = setTimeout(() => endQuestion(io, game), question.time * 1000);
  }, meta.prepareMs);
}

function endQuestion(io, game) {
  if (game.state !== 'question') return;
  clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    const results = engine.finishQuestion(game);
    const isLast = game.qIndex === game.questions.length - 1;
    const question = engine.currentQuestion(game);
    // Kopfrechnen: nach kurzer Auflösung automatisch weiter (Lehrkraft kann anhalten)
    const autoNext = game.mode === 'mental';
    game.snapshot.results = {
      type: results.type,
      scored: results.scored,
      summary: results.summary,
      leaderboard: results.leaderboard,
      totalPlayers: results.totalPlayers,
      answeredCount: results.answeredCount,
      isLast,
    };
    if (autoNext) {
      game.autoNextAt = Date.now() + engine.ARITH_AUTO_NEXT_MS;
      game.autoTimer = setTimeout(() => {
        game.autoTimer = null;
        if (game.state === 'results') advance(io, game);
      }, engine.ARITH_AUTO_NEXT_MS);
    }
    io.to(hostRoom(game)).emit('game:results', { ...game.snapshot.results, autoNextMs: autoNext ? engine.ARITH_AUTO_NEXT_MS : null });
    for (const r of results.playerResults) {
      r.player.lastPrivate = ['player:result', {
        type: results.type,
        scored: r.scored,
        answered: r.answered,
        correct: r.correct,
        gained: r.gained,
        score: r.player.score,
        streak: r.player.streak,
        rank: r.rank,
        rankBefore: r.rankBefore,
        totalPlayers: results.totalPlayers,
        behind: r.behind,
        solution: question.type === 'arith' ? `${question.text} = ${question.correct}` : undefined,
        isLast,
      }];
      io.to(r.player.socketId).emit(...r.player.lastPrivate);
    }
  }, engine.RESULT_DELAY_MS);
}

function showPodium(io, game) {
  const data = engine.podium(game);
  game.snapshot.podium = {
    title: data.title,
    board: data.board.map(({ socketId, ...rest }) => rest),
    totalQuestions: data.totalQuestions,
  };
  io.to(hostRoom(game)).emit('game:podium', game.snapshot.podium);
  for (const entry of data.board) {
    const player = game.players.get(entry.socketId);
    const payload = {
      rank: entry.rank,
      score: entry.score,
      correctCount: entry.correctCount,
      bestStreak: entry.bestStreak,
      totalQuestions: data.totalQuestions,
      totalPlayers: data.board.length,
    };
    if (player) player.lastPrivate = ['player:podium', payload];
    io.to(entry.socketId).emit('player:podium', payload);
  }
}

// Spielinfos für das Lehrergerät (Start-Gate, Lobby)
function hostGameInfo(game) {
  const info = { title: game.quizTitle, mode: game.mode, questionCount: game.questions.length };
  if (game.mode === 'mental') {
    Object.assign(info, {
      mental: {
        ...game.mental,
        info: mental.describe(game.mental),
        minCount: mental.MIN_COUNT,
        maxCount: mental.MAX_COUNT,
      },
      // vor dem Start: eingestellte Aufgabenzahl, danach die tatsächliche
      questionCount: game.questions.length || game.mental.count,
    });
  }
  return info;
}

io.on('connection', (socket) => {
  const cookies = auth.parseCookies(socket.handshake.headers.cookie);
  const sessionToken = cookies.zackboing_session;

  // --- Lehrkraft eröffnet ein Spiel
  socket.on('host:create', ({ quizId }, cb = () => {}) => {
    if (draining) return cb({ error: 'Die App wird gewartet; neue Spiele sind vorübergehend gesperrt.' });
    const user = auth.userForToken(sessionToken);
    if (!user) return cb({ error: 'Nicht angemeldet.' });
    // Eigene Quizze immer, fremde nur wenn freigegeben
    const row = db.prepare('SELECT * FROM quizzes WHERE id = ? AND (user_id = ? OR shared = 1)').get(quizId, user.id);
    if (!row) return cb({ error: 'Quiz nicht gefunden oder nicht freigegeben.' });

    if (row.mode === 'mental') {
      // Aufgaben entstehen erst beim Start – die Aufgabenzahl kann in der Lobby noch geändert werden
      let config;
      try {
        config = mental.normalizeConfig(JSON.parse(row.mental));
      } catch (e) {
        return cb({ error: typeof e === 'string' ? e : 'Kopfrechenrunde konnte nicht geladen werden.' });
      }
      const game = engine.createGame(socket.id, { title: row.title, questions: [], mode: 'mental', mental: config });
      socket.join(hostRoom(game));
      return cb({ pin: game.pin, hostToken: game.hostToken, ...hostGameInfo(game) });
    }

    let questions;
    try {
      questions = validateAndNormalize(JSON.parse(row.questions));
    } catch (e) {
      return cb({ error: typeof e === 'string' ? e : 'Quiz konnte nicht geladen werden.' });
    }
    if (!questions.length) return cb({ error: 'Dieses Quiz hat noch keine Fragen.' });

    const game = engine.createGame(socket.id, { title: row.title, questions });
    socket.join(hostRoom(game));
    cb({ pin: game.pin, hostToken: game.hostToken, ...hostGameInfo(game) });
  });

  // --- Lehrergerät kommt nach Verbindungsabbruch (oder Seiten-Neuladen) zurück
  socket.on('host:rejoin', ({ pin, token }, cb = () => {}) => {
    const game = engine.getGame(pin);
    if (!game || game.hostToken !== token) return cb({ error: 'Dieses Spiel läuft nicht mehr.' });
    clearTimeout(game.hostGraceTimer);
    game.hostGraceTimer = null;
    game.hostConnected = true;
    game.hostSocketId = socket.id;
    socket.join(hostRoom(game));
    cb({
      ok: true,
      pin: game.pin,
      ...hostGameInfo(game),
      state: game.state,
      players: lobbyPlayers(game),
    });
    // Letzten Stand nachliefern, damit der Beamer wieder das Richtige zeigt
    const snap = game.snapshot;
    if (game.state === 'prepare' && snap.prepare) {
      socket.emit('game:prepare', { ...snap.prepare, resync: true });
    } else if (game.state === 'question' && snap.question) {
      socket.emit('game:question', { ...snap.question, resync: true, elapsedMs: Date.now() - game.qStartedAt });
      socket.emit('game:answerCount', answerCounts(game));
    } else if (game.state === 'results' && snap.results) {
      if (snap.question) socket.emit('game:question', { ...snap.question, resync: true, silent: true });
      const autoNextMs = game.autoTimer ? Math.max(0, game.autoNextAt - Date.now()) : null;
      socket.emit('game:results', { ...snap.results, autoNextMs, resync: true });
    } else if (game.state === 'podium' && snap.podium) {
      socket.emit('game:podium', { ...snap.podium, resync: true });
    }
  });

  socket.on('host:start', (payload) => {
    const game = engine.gameOfHost(socket.id);
    if (!game || game.state !== 'lobby') return;
    if (!game.players.size) return socket.emit('host:error', { error: 'Noch keine Spieler beigetreten.' });
    if (game.mode === 'mental') {
      // Aufgabenzahl aus dem Lobby-Regler übernehmen, Aufgaben frisch würfeln
      const count = payload && payload.count != null ? Number(payload.count) : game.mental.count;
      try {
        game.mental = mental.normalizeConfig({ ...game.mental, count });
      } catch (e) {
        return socket.emit('host:error', { error: typeof e === 'string' ? e : 'Ungültige Aufgabenzahl.' });
      }
      game.questions = mental.generateQuestions(game.mental);
    }
    advance(io, game);
  });

  socket.on('host:next', () => {
    const game = engine.gameOfHost(socket.id);
    if (!game || game.state !== 'results') return;
    advance(io, game);
  });

  // Kopfrechnen: automatisches Weiter anhalten (z. B. um eine Aufgabe zu besprechen)
  socket.on('host:holdAuto', () => {
    const game = engine.gameOfHost(socket.id);
    if (!game || game.state !== 'results' || !game.autoTimer) return;
    clearTimeout(game.autoTimer);
    game.autoTimer = null;
    game.autoNextAt = 0;
    socket.emit('game:autoHeld');
  });

  socket.on('host:skip', () => {
    const game = engine.gameOfHost(socket.id);
    if (!game || game.state !== 'question') return;
    endQuestion(io, game);
  });

  socket.on('host:kick', ({ name }) => {
    const game = engine.gameOfHost(socket.id);
    if (!game || game.state !== 'lobby') return;
    for (const [sid, p] of game.players) {
      if (p.name === name) {
        game.players.delete(sid);
        io.to(sid).emit('player:kicked');
        io.sockets.sockets.get(sid)?.leave(playerRoom(game));
        break;
      }
    }
    io.to(hostRoom(game)).emit('lobby:update', { players: lobbyPlayers(game) });
  });

  // --- Schüler tritt bei
  socket.on('player:join', ({ pin, name }, cb = () => {}) => {
    const game = engine.getGame(pin);
    if (!game) return cb({ error: 'Diese PIN gibt es nicht. Schau nochmal auf den Bildschirm!' });
    if (game.state !== 'lobby') return cb({ error: 'Das Spiel läuft schon. Frag nach einer neuen Runde!' });
    name = String(name || '').trim().slice(0, 20);
    if (name.length < 2) return cb({ error: 'Dein Name braucht mindestens 2 Zeichen.' });
    if (engine.nameTaken(game, name)) return cb({ error: 'Diesen Namen hat schon jemand. Nimm einen anderen!' });

    const player = engine.addPlayer(game, socket.id, name);
    socket.join(playerRoom(game));
    io.to(hostRoom(game)).emit('lobby:update', {
      players: lobbyPlayers(game),
      joined: { name: player.name, avatar: player.avatar },
    });
    cb({ ok: true, name: player.name, avatar: player.avatar, quizTitle: game.quizTitle, pin: game.pin, token: player.token });
  });

  // --- Schüler wünscht sich in der Lobby einen anderen Avatar
  socket.on('player:shuffleAvatar', (_payload, cb = () => {}) => {
    const game = engine.gameOfPlayer(socket.id);
    if (!game || game.state !== 'lobby') return cb({ error: 'Der Avatar lässt sich nur in der Lobby ändern.' });
    const player = game.players.get(socket.id);
    const now = Date.now();
    if (player.avatarChangedAt && now - player.avatarChangedAt < 250) return cb({ ok: true, avatar: player.avatar });
    player.avatarChangedAt = now;
    const avatar = engine.shuffleAvatar(player);
    io.to(hostRoom(game)).emit('lobby:update', { players: lobbyPlayers(game) });
    cb({ ok: true, avatar });
  });

  // --- Schüler kommt nach WLAN-Abbruch (oder Seiten-Neuladen) zurück
  socket.on('player:rejoin', ({ pin, token }, cb = () => {}) => {
    const game = engine.getGame(pin);
    const player = game && engine.resumePlayer(game, token, socket.id);
    if (!player) return cb({ error: 'Das Spiel läuft nicht mehr.' });
    socket.join(playerRoom(game));

    const res = {
      ok: true,
      name: player.name,
      avatar: player.avatar,
      score: player.score,
      quizTitle: game.quizTitle,
      state: game.state,
    };
    if (game.state === 'question') {
      const question = engine.currentQuestion(game);
      res.question = {
        ...questionMeta(game),
        view: playerView(game, question),
        elapsedMs: Date.now() - game.qStartedAt,
        answered: player.answer !== null,
        entries: player.entries.length,
      };
      io.to(hostRoom(game)).emit('game:answerCount', answerCounts(game));
    }
    cb(res);

    if (game.state === 'lobby') {
      io.to(hostRoom(game)).emit('lobby:update', { players: lobbyPlayers(game) });
    } else if ((game.state === 'results' || game.state === 'podium') && player.lastPrivate) {
      // verpasstes Ergebnis nachreichen
      socket.emit(...player.lastPrivate);
    }
  });

  socket.on('player:answer', (payload, cb = () => {}) => {
    const game = engine.gameOfPlayer(socket.id);
    if (!game || game.state !== 'question') return cb({ error: 'Gerade keine Frage aktiv.' });
    const player = game.players.get(socket.id);
    const question = engine.currentQuestion(game);

    const problem = engine.registerAnswer(game, player, question, payload || {});
    if (problem) return cb({ error: problem });
    cb({ ok: true, entries: question.type === 'brainstorm' ? player.entries.length : undefined });

    // Brainstorming: Ideen erscheinen live auf dem Beamer
    if (question.type === 'brainstorm') {
      io.to(hostRoom(game)).emit('game:liveEntry', {
        text: player.entries[player.entries.length - 1],
        avatar: player.avatar,
      });
    }

    io.to(hostRoom(game)).emit('game:answerCount', answerCounts(game));
    if (engine.everyoneDone(game, question)) endQuestion(io, game);
  });

  // --- Verbindungsabbrüche: nichts sofort wegwerfen, Wiedereinstieg ermöglichen
  socket.on('disconnect', () => {
    const hosted = engine.gameOfHost(socket.id);
    if (hosted) {
      hosted.hostConnected = false;
      if (hosted.state === 'podium') {
        // Siegerehrung lief schon – Spiel leise beenden, Schüler behalten ihren Endbildschirm
        engine.destroyGame(hosted);
        return;
      }
      // Gnadenfrist: kurze Beamer-Aussetzer brechen das Spiel nicht mehr ab
      hosted.hostGraceTimer = setTimeout(() => {
        if (hosted.hostConnected) return;
        io.to(playerRoom(hosted)).emit('game:aborted');
        engine.destroyGame(hosted);
      }, engine.HOST_GRACE_MS);
      return;
    }

    const game = engine.gameOfPlayer(socket.id);
    if (!game) return;
    const player = game.players.get(socket.id);
    player.connected = false;
    if (game.state === 'lobby') {
      // Platz und Name eine Weile reservieren, dann aufräumen
      player.dropTimer = setTimeout(() => {
        if (player.connected || game.players.get(player.socketId) !== player) return;
        game.players.delete(player.socketId);
        io.to(hostRoom(game)).emit('lobby:update', { players: lobbyPlayers(game) });
      }, engine.LOBBY_DROP_MS);
      io.to(hostRoom(game)).emit('lobby:update', { players: lobbyPlayers(game) });
    } else if (game.state === 'question') {
      io.to(hostRoom(game)).emit('game:answerCount', answerCounts(game));
      if (engine.everyoneDone(game, engine.currentQuestion(game))) endQuestion(io, game);
    }
  });
});

server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`Zackboing läuft auf http://localhost:${PORT}`);
  console.log('Im Schul-WLAN: die IP-Adresse dieses Rechners + Port verwenden.');
});
