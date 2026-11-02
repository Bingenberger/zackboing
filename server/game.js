// Spiel-Engine: verwaltet laufende Spiele, Timing und Punktevergabe.
// Der Server treibt den kompletten Ablauf (Vorbereitung → Frage → Ergebnis),
// damit alle Geräte synchron bleiben und niemand clientseitig schummeln kann.

const crypto = require('crypto');

const PREPARE_MS = 5000;      // "Mach dich bereit"-Phase vor jeder Frage
const ARITH_PREPARE_MS = 3000; // Kopfrechnen: kürzer, die Aufgabe wird vorab nicht gezeigt
const ARITH_AUTO_NEXT_MS = 6000; // Kopfrechnen: so lange steht die Auflösung, dann geht es allein weiter
const RESULT_DELAY_MS = 400;  // kleine Pause, bevor Ergebnisse rausgehen
const HOST_GRACE_MS = 90000;  // so lange darf das Lehrergerät offline sein, bevor das Spiel abbricht
const LOBBY_DROP_MS = 60000;  // so lange bleibt ein getrennter Spieler in der Lobby reserviert

// Wissensfragen werden bewertet, Meinungsfragen nicht.
// "arith" (Kopfrechnen) erzeugt nur der Server – es ist kein Fragetyp im Editor.
const EDITABLE_SCORED_TYPES = ['choice', 'truefalse', 'freetext', 'slider', 'order'];
const SCORED_TYPES = [...EDITABLE_SCORED_TYPES, 'arith'];
const OPINION_TYPES = ['poll', 'scale', 'wordcloud', 'brainstorm'];
const ALL_TYPES = [...EDITABLE_SCORED_TYPES, ...OPINION_TYPES];

const AVATARS = ['🦊', '🐸', '🐼', '🦁', '🐙', '🦄', '🐧', '🐨', '🦖', '🐝', '🐢', '🦜', '🐬', '🦔', '🐿️', '🦩', '🐳', '🦉', '🐞', '🦕', '🐲', '🦥', '🦦', '🐹'];

const games = new Map(); // pin → game

function generatePin() {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (games.has(pin));
  return pin;
}

function createGame(hostSocketId, quiz) {
  const pin = generatePin();
  const game = {
    pin,
    hostSocketId,
    hostToken: crypto.randomBytes(16).toString('hex'), // für Wiedereinstieg des Lehrergeräts
    hostConnected: true,
    hostGraceTimer: null,
    quizTitle: quiz.title,
    questions: quiz.questions,
    mode: quiz.mode || 'quiz', // quiz | mental
    mental: quiz.mental || null, // Einstellungen der Kopfrechenrunde
    autoNextAt: 0,             // Kopfrechnen: Zeitpunkt des automatischen Weiter
    players: new Map(), // socketId → player
    state: 'lobby',     // lobby | prepare | question | results | podium
    qIndex: -1,
    qStartedAt: 0,
    qShuffle: null,     // Puzzle: Reihenfolge, in der die Teile angezeigt werden
    timer: null,
    usedAvatars: 0,
    snapshot: {},       // zuletzt gesendete Host-Payloads, für Re-Sync nach Reconnect
  };
  games.set(pin, game);
  return game;
}

function getGame(pin) {
  return games.get(String(pin));
}

function gameOfHost(socketId) {
  for (const game of games.values()) {
    if (game.hostSocketId === socketId) return game;
  }
  return null;
}

function gameOfPlayer(socketId) {
  for (const game of games.values()) {
    if (game.players.has(socketId)) return game;
  }
  return null;
}

function addPlayer(game, socketId, name) {
  const avatar = AVATARS[game.usedAvatars++ % AVATARS.length];
  const player = {
    socketId,
    token: crypto.randomBytes(16).toString('hex'), // für Wiedereinstieg nach WLAN-Abbruch
    name,
    avatar,
    score: 0,
    streak: 0,
    bestStreak: 0,
    correctCount: 0,
    connected: true,
    dropTimer: null,   // Lobby: räumt Getrennte nach einer Weile weg
    lastPrivate: null, // zuletzt privat gesendetes Ergebnis (player:result/podium)
    answer: null,      // typabhängig, s. registerAnswer()
    entries: [],       // Brainstorming: mehrere Beiträge
  };
  game.players.set(socketId, player);
  return player;
}

// Lobby: Spieler tippt auf seinen Avatar und bekommt zufällig einen anderen.
function shuffleAvatar(player) {
  const others = AVATARS.filter((a) => a !== player.avatar);
  player.avatar = others[Math.floor(Math.random() * others.length)];
  return player.avatar;
}

// Wiedereinstieg nach Verbindungsabbruch: Spieler behält Name, Avatar und Punkte.
function resumePlayer(game, token, newSocketId) {
  for (const [sid, p] of game.players) {
    if (p.token !== token) continue;
    clearTimeout(p.dropTimer);
    p.dropTimer = null;
    p.connected = true;
    if (sid !== newSocketId) {
      game.players.delete(sid);
      p.socketId = newSocketId;
      game.players.set(newSocketId, p);
    }
    return p;
  }
  return null;
}

function nameTaken(game, name) {
  const lower = name.toLowerCase();
  for (const p of game.players.values()) {
    if (p.name.toLowerCase() === lower) return true;
  }
  return false;
}

function currentQuestion(game) {
  return game.questions[game.qIndex] || null;
}

// Fisher-Yates; für Puzzle-Fragen wird einmal pro Frage gemischt (für alle gleich).
function shuffledIndices(n) {
  const arr = [...Array(n).keys()];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const normalizeText = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Nimmt die Antwort eines Spielers entgegen und validiert sie typabhängig.
// Rückgabe: null bei Erfolg, sonst Fehlertext.
function registerAnswer(game, player, question, payload) {
  const elapsed = Date.now() - game.qStartedAt;

  switch (question.type) {
    case 'choice':
    case 'truefalse':
    case 'poll': {
      if (player.answer !== null) return 'Du hast schon geantwortet.';
      const max = question.type === 'truefalse' ? 2 : question.answers.length;
      if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index >= max) return 'Ungültige Antwort.';
      player.answer = { index: payload.index, ms: elapsed };
      return null;
    }
    case 'freetext':
    case 'wordcloud': {
      if (player.answer !== null) return 'Du hast schon geantwortet.';
      const text = String(payload.text || '').trim().slice(0, question.type === 'wordcloud' ? 30 : 80);
      if (!text) return 'Bitte etwas eingeben.';
      player.answer = { text, ms: elapsed };
      return null;
    }
    case 'slider':
    case 'scale': {
      if (player.answer !== null) return 'Du hast schon geantwortet.';
      const value = Number(payload.value);
      if (!Number.isFinite(value) || value < question.min || value > question.max) return 'Ungültiger Wert.';
      player.answer = { value, ms: elapsed };
      return null;
    }
    case 'arith': {
      if (player.answer !== null) return 'Du hast schon geantwortet.';
      const value = Number(payload.value);
      if (!Number.isInteger(value) || value < 0 || value > 9999999) return 'Bitte eine Zahl eingeben.';
      player.answer = { value, ms: elapsed };
      return null;
    }
    case 'order': {
      if (player.answer !== null) return 'Du hast schon geantwortet.';
      const n = question.answers.length;
      const order = Array.isArray(payload.order) ? payload.order.map(Number) : [];
      const valid = order.length === n && [...order].sort((a, b) => a - b).every((v, i) => v === i);
      if (!valid) return 'Ungültige Reihenfolge.';
      player.answer = { order, ms: elapsed };
      return null;
    }
    case 'brainstorm': {
      const text = String(payload.text || '').trim().slice(0, 100);
      if (!text) return 'Bitte etwas eingeben.';
      if (player.entries.length >= 3) return 'Maximal 3 Ideen pro Person.';
      if (player.entries.some((e) => normalizeText(e) === normalizeText(text))) return 'Diese Idee hast du schon eingereicht.';
      player.entries.push(text);
      if (player.answer === null) player.answer = { ms: elapsed };
      return null;
    }
    default:
      return 'Unbekannter Fragetyp.';
  }
}

// Brainstorming endet nie automatisch (Timer/Host), alles andere sobald alle geantwortet haben.
function everyoneDone(game, question) {
  if (question.type === 'brainstorm') return false;
  const active = [...game.players.values()].filter((p) => p.connected);
  return active.length > 0 && active.every((p) => p.answer !== null);
}

// Kahoot-Formel: volle Punkte bei Sofortantwort, min. 50 % bei Antwort in letzter Sekunde.
function speedPoints(question, elapsedMs) {
  const base = question.points === 'double' ? 2000 : question.points === 'none' ? 0 : 1000;
  const limitMs = question.time * 1000;
  return base * (1 - Math.min(elapsedMs / limitMs, 1) / 2);
}

// Bewertet die Antwort eines Spielers: { correct, factor 0..1 }
function judge(question, answer) {
  switch (question.type) {
    case 'choice':
    case 'truefalse':
      return { correct: answer.index === question.correct, factor: 1 };
    case 'freetext': {
      const given = normalizeText(answer.text);
      const hit = question.accepted.some((a) => normalizeText(a) === given);
      return { correct: hit, factor: 1 };
    }
    case 'slider': {
      const dist = Math.abs(answer.value - question.correct);
      if (dist <= question.tolerance) return { correct: true, factor: 1 };
      // außerhalb der Toleranz: linear abfallend bis 0 bei 25 % der Spannweite
      const range = question.max - question.min;
      const factor = Math.max(0, 1 - (dist - question.tolerance) / (range * 0.25));
      return { correct: false, factor };
    }
    case 'arith':
      return { correct: answer.value === question.correct, factor: answer.value === question.correct ? 1 : 0 };
    case 'order': {
      const perfect = answer.order.every((v, i) => v === i);
      return { correct: perfect, factor: perfect ? 1 : 0 };
    }
    default:
      return { correct: false, factor: 0 };
  }
}

function leaderboard(game) {
  return [...game.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      streak: p.streak,
    }));
}

// Typspezifische Zusammenfassung für die Beamer-Anzeige.
function hostSummary(game, question) {
  const answers = [...game.players.values()].filter((p) => p.answer !== null);

  switch (question.type) {
    case 'choice':
    case 'truefalse':
    case 'poll': {
      const n = question.type === 'truefalse' ? 2 : question.answers.length;
      const distribution = Array(n).fill(0);
      for (const p of answers) distribution[p.answer.index]++;
      return { distribution, correct: question.type === 'poll' ? null : question.correct };
    }
    case 'freetext': {
      const counts = new Map();
      for (const p of answers) {
        const key = normalizeText(p.answer.text);
        const entry = counts.get(key) || { text: p.answer.text, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
      const list = [...counts.values()]
        .map((e) => ({ ...e, correct: question.accepted.some((a) => normalizeText(a) === normalizeText(e.text)) }))
        .sort((a, b) => b.correct - a.correct || b.count - a.count)
        .slice(0, 12);
      return { given: list, accepted: question.accepted };
    }
    case 'slider': {
      const values = answers.map((p) => p.answer.value);
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      return {
        values,
        average: avg === null ? null : Math.round(avg * 100) / 100,
        correct: question.correct,
        tolerance: question.tolerance,
        min: question.min,
        max: question.max,
      };
    }
    case 'arith': {
      // häufigste Antworten – so sieht die Lehrkraft typische Rechenfehler
      const counts = new Map();
      for (const p of answers) counts.set(p.answer.value, (counts.get(p.answer.value) || 0) + 1);
      const given = [...counts.entries()]
        .map(([value, count]) => ({ value, count, correct: value === question.correct }))
        .sort((a, b) => b.correct - a.correct || b.count - a.count)
        .slice(0, 10);
      return {
        task: question.text,
        correct: question.correct,
        rightCount: answers.filter((p) => p.answer.value === question.correct).length,
        given,
      };
    }
    case 'order': {
      const perfectCount = answers.filter((p) => p.answer.order.every((v, i) => v === i)).length;
      return { correctOrder: question.answers.map((a) => a.text), perfectCount };
    }
    case 'scale': {
      const distribution = {};
      for (let v = question.min; v <= question.max; v++) distribution[v] = 0;
      let sum = 0;
      for (const p of answers) { distribution[p.answer.value]++; sum += p.answer.value; }
      return {
        distribution,
        average: answers.length ? Math.round((sum / answers.length) * 10) / 10 : null,
        min: question.min,
        max: question.max,
        minLabel: question.minLabel,
        maxLabel: question.maxLabel,
      };
    }
    case 'wordcloud': {
      const counts = new Map();
      for (const p of answers) {
        const key = normalizeText(p.answer.text);
        const entry = counts.get(key) || { word: p.answer.text, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
      return { words: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 60) };
    }
    case 'brainstorm': {
      const ideas = [];
      for (const p of game.players.values()) {
        for (const text of p.entries) ideas.push({ text, name: p.name, avatar: p.avatar });
      }
      return { ideas };
    }
    default:
      return {};
  }
}

// Wertet die laufende Frage aus. Gibt Daten für Host und pro Spieler zurück.
function finishQuestion(game) {
  const question = currentQuestion(game);
  const scored = SCORED_TYPES.includes(question.type);
  const board = leaderboard(game);
  const rankOf = new Map(board.map((e) => [e.name, e.rank]));

  const playerResults = [];
  for (const player of game.players.values()) {
    const answered = player.answer !== null;
    let correct = false;
    let gained = 0;

    if (scored) {
      if (answered) {
        const verdict = judge(question, player.answer);
        correct = verdict.correct;
        gained = Math.round(speedPoints(question, player.answer.ms) * verdict.factor);
        if (verdict.factor > 0 && question.points !== 'none') {
          gained += Math.min(player.streak, 6) * 100 * (correct ? 1 : 0);
        }
      }
      if (correct) {
        player.streak++;
        player.bestStreak = Math.max(player.bestStreak, player.streak);
        player.correctCount++;
      } else {
        player.streak = 0;
      }
      player.score += gained;
    }
    playerResults.push({ player, answered, correct, gained, scored });
  }

  const newBoard = leaderboard(game);
  const newRankOf = new Map(newBoard.map((e) => [e.name, e]));
  for (const result of playerResults) {
    const entry = newRankOf.get(result.player.name);
    result.rank = entry.rank;
    result.rankBefore = rankOf.get(result.player.name) || entry.rank;
    const ahead = newBoard[entry.rank - 2];
    result.behind = ahead ? { name: ahead.name, gap: ahead.score - entry.score } : null;
  }

  // Puzzle-Auflösung fürs eigene Gerät: eigene Reihenfolge vs. richtige
  game.state = 'results';
  return {
    type: question.type,
    scored,
    summary: hostSummary(game, question),
    leaderboard: newBoard.slice(0, 5),
    totalPlayers: game.players.size,
    answeredCount: playerResults.filter((r) => r.answered).length,
    playerResults,
  };
}

function podium(game) {
  game.state = 'podium';
  const board = [...game.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      correctCount: p.correctCount,
      bestStreak: p.bestStreak,
      socketId: p.socketId,
    }));
  const scoredCount = game.questions.filter((q) => SCORED_TYPES.includes(q.type)).length;
  return { title: game.quizTitle, board, totalQuestions: scoredCount };
}

function destroyGame(game) {
  if (game.timer) clearTimeout(game.timer);
  if (game.autoTimer) clearTimeout(game.autoTimer);
  if (game.hostGraceTimer) clearTimeout(game.hostGraceTimer);
  for (const p of game.players.values()) {
    if (p.dropTimer) clearTimeout(p.dropTimer);
  }
  games.delete(game.pin);
}

module.exports = {
  PREPARE_MS, ARITH_PREPARE_MS, ARITH_AUTO_NEXT_MS, RESULT_DELAY_MS, HOST_GRACE_MS, LOBBY_DROP_MS,
  SCORED_TYPES, OPINION_TYPES, ALL_TYPES,
  createGame, getGame, gameOfHost, gameOfPlayer,
  addPlayer, shuffleAvatar, resumePlayer, nameTaken, currentQuestion, shuffledIndices,
  registerAnswer, everyoneDone, finishQuestion, podium, leaderboard, destroyGame,
};

module.exports.activeGameCount = () => [...games.values()].filter(game => game.state !== 'podium').length;
