/* Kopfrechenrunden für die Grundschule.
 *
 * Eine Kopfrechenrunde speichert keine Fragen, sondern nur Einstellungen
 * (Aufgabenzahl, Zahlenraum, Rechenarten, Zeit). Die Aufgaben erzeugt der Server
 * bei jedem Spielstart neu, damit sich niemand Lösungen merken kann.
 *
 * Regeln, damit die Aufgaben grundschulgerecht bleiben:
 * - Plus/Minus: alle Zahlen und Ergebnisse im Zahlenraum, keine negativen Ergebnisse.
 * - Mal: bis 20 Produkte im Zahlenraum, bis 100 das kleine Einmaleins,
 *   bis 1000 zusätzlich Zehnerzahlen (z. B. 7 · 80).
 * - Geteilt: Umkehraufgaben dazu, immer ohne Rest.
 */

const RANGES = [10, 20, 100, 1000];
const OPERATIONS = ['add', 'sub', 'mul', 'div'];
const SYMBOLS = { add: '+', sub: '−', mul: '·', div: ':' };
const TIMES = [5, 10, 20, 30, 60];
const MIN_COUNT = 3;
const MAX_COUNT = 50;

const DEFAULTS = { count: 10, range: 20, ops: ['add', 'sub'], time: 20 };

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// Prüft Einstellungen und ergänzt Standardwerte; wirft bei Fehlern einen String.
function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const count = cfg.count == null ? DEFAULTS.count : Number(cfg.count);
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw `Die Aufgabenzahl muss zwischen ${MIN_COUNT} und ${MAX_COUNT} liegen.`;
  }
  const range = cfg.range == null ? DEFAULTS.range : Number(cfg.range);
  if (!RANGES.includes(range)) throw `Zahlenraum muss ${RANGES.join(', ')} sein.`;
  const ops = [...new Set(Array.isArray(cfg.ops) ? cfg.ops : DEFAULTS.ops)].filter((o) => OPERATIONS.includes(o));
  if (!ops.length) throw 'Bitte mindestens eine Rechenart auswählen.';
  const time = cfg.time == null ? DEFAULTS.time : Number(cfg.time);
  if (!TIMES.includes(time)) throw `Zeit pro Aufgabe muss ${TIMES.join(', ')} Sekunden sein.`;
  return { count, range, ops: OPERATIONS.filter((o) => ops.includes(o)), time };
}

// Zwei Faktoren ≥ 2 passend zum Zahlenraum
function factors(max) {
  const a = randInt(2, Math.min(10, Math.floor(max / 2)));
  let b = randInt(2, Math.min(10, Math.floor(max / a)));
  if (max >= 1000 && Math.random() < 0.5) b *= 10; // 7 · 80
  return Math.random() < 0.5 ? [a, b] : [b, a];
}

// Plus/Minus: Ergebnis bzw. Minuend liegt im oberen Teil des Zahlenraums, und keine
// Zahl ist winzig – sonst wären „bis 100“-Runden voller Aufgaben wie 4 + 1.
const PLUS_MINUS = {
  10: { low: 2, minOperand: 1 },
  20: { low: 6, minOperand: 2 },
  100: { low: 21, minOperand: 3 },
  1000: { low: 101, minOperand: 10 },
};

function makeTask(op, max) {
  const { low, minOperand } = PLUS_MINUS[max];
  switch (op) {
    case 'add': {
      const sum = randInt(Math.max(low, 2 * minOperand), max);
      const a = randInt(minOperand, sum - minOperand);
      return { a, b: sum - a, result: sum };
    }
    case 'sub': {
      const a = randInt(Math.max(low, minOperand + 1), max);
      const b = randInt(minOperand, a - 1);
      return { a, b, result: a - b };
    }
    case 'mul': {
      const [a, b] = factors(max);
      return { a, b, result: a * b };
    }
    case 'div': {
      const [a, b] = factors(max);
      return { a: a * b, b, result: a };
    }
    default:
      throw new Error(`unbekannte Rechenart ${op}`);
  }
}

// Erzeugt `count` Aufgaben als Spielfragen (Typ "arith"). Wiederholungen werden
// vermieden, solange der Zahlenraum genug verschiedene Aufgaben hergibt.
function generateQuestions(config, count = config.count) {
  const questions = [];
  const seen = new Set();
  // Rechenarten gleichmäßig verteilen (reihum), danach die Reihenfolge mischen
  const opPlan = Array.from({ length: count }, (_, i) => config.ops[i % config.ops.length]);
  for (let i = opPlan.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [opPlan[i], opPlan[j]] = [opPlan[j], opPlan[i]];
  }
  for (const op of opPlan) {
    let task;
    for (let attempt = 0; attempt < 30; attempt++) {
      task = makeTask(op, config.range);
      const key = `${task.a}${op}${task.b}`;
      if (!seen.has(key)) { seen.add(key); break; }
    }
    questions.push({
      type: 'arith',
      text: `${task.a} ${SYMBOLS[op]} ${task.b}`,
      correct: task.result,
      time: config.time,
      points: 'normal',
      media: null,
    });
  }
  return questions;
}

function describe(config) {
  return `bis ${config.range} · ${config.ops.map((o) => SYMBOLS[o]).join(' ')}`;
}

module.exports = {
  RANGES, OPERATIONS, SYMBOLS, TIMES, MIN_COUNT, MAX_COUNT, DEFAULTS,
  normalizeConfig, generateQuestions, describe,
};
