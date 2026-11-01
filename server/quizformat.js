/* Import-/Exportformat für Quizze ("zackboing-quiz", Version 1).
 *
 * Export: liefert das gespeicherte Quiz in einem stabilen JSON-Format.
 * Import: nimmt dasselbe Format an, ist aber bewusst tolerant, damit auch von
 * Chatbots erzeugte Dateien funktionieren (Typ-Aliasse, Standardwerte, Antworttext
 * statt Index, "Wahr"/true statt 0 …). Das Ergebnis wird anschließend von der
 * normalen Validierung (normalizeQuestion in index.js) geprüft.
 * Die vollständige Beschreibung steht in docs/import-format.md.
 */
const fs = require('fs');
const path = require('path');

const FORMAT = 'zackboing-quiz';
const VERSION = 1;
const TIMES = [5, 10, 20, 30, 60, 90, 120];

// Schlüssel: Kleinbuchstaben ohne Sonderzeichen (siehe normalizeTypeKey)
const TYPE_ALIASES = {
  choice: 'choice', quiz: 'choice', multiplechoice: 'choice', mc: 'choice', auswahl: 'choice', singlechoice: 'choice',
  truefalse: 'truefalse', boolean: 'truefalse', wahrfalsch: 'truefalse', wahroderfalsch: 'truefalse', richtigfalsch: 'truefalse',
  freetext: 'freetext', text: 'freetext', open: 'freetext', freitext: 'freetext',
  slider: 'slider', estimate: 'slider', estimation: 'slider', number: 'slider', schaetzfrage: 'slider', schätzfrage: 'slider', schätzen: 'slider',
  order: 'order', puzzle: 'order', sort: 'order', sorting: 'order', reihenfolge: 'order', sortieren: 'order',
  poll: 'poll', survey: 'poll', umfrage: 'poll', abstimmung: 'poll',
  scale: 'scale', skala: 'scale', rating: 'scale', likert: 'scale',
  wordcloud: 'wordcloud', wortwolke: 'wordcloud',
  brainstorm: 'brainstorm', brainstorming: 'brainstorm', ideas: 'brainstorm', ideen: 'brainstorm',
};

const normalizeTypeKey = (t) => String(t).toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

const MEDIA_KIND_BY_EXT = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image',
  mp3: 'audio', ogg: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
};

function exportQuiz(row) {
  const base = { format: FORMAT, version: VERSION, title: row.title, subject: row.subject || '' };
  if (row.mode === 'mental') return { ...base, mode: 'mental', mental: JSON.parse(row.mental) };
  return { ...base, questions: JSON.parse(row.questions) };
}

// Kopfrechenrunde: Rechenarten tolerant einlesen ("+", "plus", "Addition" …)
const OP_ALIASES = {
  add: 'add', '+': 'add', plus: 'add', addition: 'add', addieren: 'add',
  sub: 'sub', '-': 'sub', '−': 'sub', minus: 'sub', subtraktion: 'sub', subtrahieren: 'sub',
  mul: 'mul', '*': 'mul', '·': 'mul', x: 'mul', '×': 'mul', mal: 'mul', multiplikation: 'mul', multiplizieren: 'mul',
  div: 'div', '/': 'div', ':': 'div', '÷': 'div', geteilt: 'div', division: 'div', dividieren: 'div',
};

function importMental(raw, mental) {
  const cfg = raw.mental && typeof raw.mental === 'object' ? raw.mental : {};
  const ops = asList(cfg.ops ?? cfg.operations ?? cfg.rechenarten).map((o) => {
    const key = String(o).trim().toLowerCase();
    if (!OP_ALIASES[key]) throw `Unbekannte Rechenart „${String(o).slice(0, 20)}“ (erlaubt: add, sub, mul, div).`;
    return OP_ALIASES[key];
  });
  return mental.normalizeConfig({
    count: cfg.count ?? cfg.aufgaben,
    range: cfg.range ?? cfg.zahlenraum,
    ops: ops.length ? ops : undefined,
    time: cfg.time,
  });
}

// Dateiname für den Download: nur harmlose Zeichen, Umlaute vereinfacht
function exportFilename(title) {
  const base = String(title || 'quiz')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'quiz'}.zackboing.json`;
}

// Nimmt ein einzelnes Quiz-Objekt, eine Liste von Quizzen oder { quizzes: [...] } an.
function unpackImport(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    if (Array.isArray(body.quizzes)) return body.quizzes;
    return [body];
  }
  throw 'Ungültige Datei: es wird ein JSON-Objekt mit "title" und "questions" erwartet.';
}

function nearestTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 20;
  return TIMES.reduce((best, t) => (Math.abs(t - n) < Math.abs(best - n) ? t : best), TIMES[0]);
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') return value.split(/[,;|]/);
  return [value];
}

function importMedia(raw, uploadDir, warn) {
  if (raw == null || raw === '') return null;
  let url, kind;
  if (typeof raw === 'string') url = raw.trim();
  else if (typeof raw === 'object') { url = String(raw.url || '').trim(); kind = raw.kind; }
  if (!url) return null;
  if (!kind) {
    const ext = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1];
    kind = MEDIA_KIND_BY_EXT[(ext || '').toLowerCase()] || 'image';
  }
  if (url.startsWith('/media/')) {
    const file = path.join(uploadDir, path.basename(url));
    if (!fs.existsSync(file)) { warn(`Medien-Datei ${url} gibt es auf diesem Server nicht – wurde weggelassen.`); return null; }
  } else if (!/^https?:\/\//.test(url)) {
    warn(`Medienangabe „${url.slice(0, 60)}“ ist keine gültige URL – wurde weggelassen.`);
    return null;
  }
  return { url, kind };
}

function importAnswer(raw, uploadDir, warn) {
  if (raw == null) return { text: '', media: null };
  if (typeof raw !== 'object') return { text: String(raw), media: null };
  const media = importMedia(raw.media || raw.image, uploadDir, warn);
  return { text: String(raw.text ?? raw.answer ?? raw.label ?? ''), media: media ? { url: media.url, kind: 'image' } : null };
}

// Findet den Index der richtigen Antwort: Zahl (0-basiert) oder Antworttext
function resolveCorrect(raw, answers, nr) {
  if (Number.isInteger(raw)) return raw;
  if (typeof raw === 'number' && Number.isInteger(Number(raw))) return Number(raw);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (/^\d+$/.test(s)) return Number(s);
    const idx = answers.findIndex((a) => a.text.trim().toLowerCase() === s.toLowerCase());
    if (idx >= 0) return idx;
    // Buchstabe A–D
    if (/^[a-d]$/i.test(s)) return s.toLowerCase().charCodeAt(0) - 97;
    throw `Frage ${nr}: die richtige Antwort „${s.slice(0, 40)}“ steht nicht in der Antwortliste.`;
  }
  if (Array.isArray(raw) && raw.length === 1) return resolveCorrect(raw[0], answers, nr);
  return -1;
}

function importQuestion(raw, nr, uploadDir, warn) {
  if (typeof raw !== 'object' || raw === null) throw `Frage ${nr}: ungültiges Format.`;
  const type = TYPE_ALIASES[normalizeTypeKey(raw.type || 'choice')];
  if (!type) throw `Frage ${nr}: unbekannter Fragetyp „${String(raw.type).slice(0, 30)}“.`;

  const text = String(raw.text ?? raw.question ?? raw.title ?? '').trim();
  const time = raw.time == null ? 20 : nearestTime(raw.time);
  if (raw.time != null && time !== Number(raw.time)) warn(`Frage ${nr}: Zeitlimit ${raw.time} s auf ${time} s gerundet.`);

  let points = raw.points == null ? 'normal' : String(raw.points).toLowerCase();
  if (points === 'double' || points === 'doppelt' || points === '2' || raw.points === 2) points = 'double';
  else if (points === 'none' || points === 'keine' || points === '0' || raw.points === 0 || raw.points === false) points = 'none';
  else points = 'normal';

  const q = { type, text, time, points, media: importMedia(raw.media ?? raw.image, uploadDir, warn) };
  const answers = asList(raw.answers ?? raw.options ?? raw.items ?? raw.steps).map((a) => importAnswer(a, uploadDir, warn));

  switch (type) {
    case 'choice':
      q.answers = answers;
      q.correct = resolveCorrect(raw.correct ?? raw.answer ?? raw.correctAnswer ?? raw.solution, answers, nr);
      break;
    case 'poll':
      q.answers = answers;
      break;
    case 'truefalse': {
      const c = raw.correct ?? raw.answer ?? raw.solution;
      const s = typeof c === 'string' ? c.trim().toLowerCase() : c;
      if (c === true || s === 'true' || s === 'wahr' || s === 'richtig' || s === 'ja' || s === 0 || s === '0') q.correct = 0;
      else if (c === false || s === 'false' || s === 'falsch' || s === 'nein' || s === 1 || s === '1') q.correct = 1;
      else q.correct = null;
      break;
    }
    case 'freetext':
      q.accepted = asList(raw.accepted ?? raw.answers ?? raw.answer ?? raw.correct ?? raw.solution).map((s) => String(s).trim()).filter(Boolean);
      break;
    case 'slider': {
      const min = Number(raw.min ?? 0), max = Number(raw.max ?? 100);
      Object.assign(q, {
        min, max,
        step: Number(raw.step ?? 1),
        correct: Number(raw.correct ?? raw.answer ?? raw.solution),
        tolerance: Number(raw.tolerance ?? 0),
      });
      break;
    }
    case 'order':
      q.answers = answers.map((a) => ({ text: a.text }));
      break;
    case 'scale':
      Object.assign(q, {
        min: raw.min == null ? 1 : Number(raw.min),
        max: raw.max == null ? 5 : Number(raw.max),
        minLabel: String(raw.minLabel ?? raw.min_label ?? ''),
        maxLabel: String(raw.maxLabel ?? raw.max_label ?? ''),
      });
      break;
    default:
      break;
  }
  return q;
}

// Wandelt ein Quiz aus der Importdatei in das interne Format um. `validate` ist
// validateAndNormalize aus index.js. Gibt { title, subject, questions, warnings } zurück.
function importQuiz(raw, { uploadDir, validate, subjects, mental }) {
  if (typeof raw !== 'object' || raw === null) throw 'Ungültige Datei: Quiz muss ein JSON-Objekt sein.';
  if (raw.format && raw.format !== FORMAT) throw `Unbekanntes Format „${String(raw.format).slice(0, 40)}“ (erwartet: ${FORMAT}).`;
  if (raw.version && Number(raw.version) > VERSION) throw `Dateiversion ${raw.version} ist neuer als diese Zackboing-Version (kennt bis ${VERSION}).`;
  const warnings = [];
  const warn = (m) => warnings.push(m);

  const title = String(raw.title ?? raw.name ?? '').trim().slice(0, 80);
  if (!title) throw 'Der Quiz-Titel ("title") fehlt.';

  let subject = String(raw.subject ?? raw.fach ?? '').trim();
  if (subject) {
    const match = subjects.find((s) => s.toLowerCase() === subject.toLowerCase());
    if (match) subject = match;
    else warn(`Fach „${subject}“ steht nicht in der Fächerliste – wurde trotzdem übernommen.`);
  }

  const mode = String(raw.mode || 'quiz').trim().toLowerCase();
  if (['mental', 'kopfrechnen'].includes(mode)) {
    return { title, subject, mode: 'mental', mental: importMental(raw, mental), questions: [], warnings };
  }
  if (mode !== 'quiz') throw `Unbekannter Modus „${mode.slice(0, 20)}“ (erlaubt: quiz, mental).`;

  const rawQuestions = raw.questions ?? raw.fragen;
  if (!Array.isArray(rawQuestions) || !rawQuestions.length) throw 'Es sind keine Fragen ("questions") enthalten.';
  if (rawQuestions.length > 100) throw 'Höchstens 100 Fragen pro Quiz.';

  const questions = validate(rawQuestions.map((q, i) => importQuestion(q, i + 1, uploadDir, warn)));
  return { title, subject, mode: 'quiz', mental: null, questions, warnings };
}

module.exports = { FORMAT, VERSION, exportQuiz, exportFilename, unpackImport, importQuiz };
