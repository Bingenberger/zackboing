/* Spieler-Client: Beitritt, typabhängige Antworten, Ergebnisse. */
(() => {
  const socket = io();
  const SHAPES = ['▲', '◆', '●', '■'];
  const $ = (id) => document.getElementById(id);

  let me = { name: '', avatar: '', score: 0 };
  let prepTimer = null;
  let arithInput = null; // Kopfrechnen: { add(digit), del(), send() } solange eine Aufgabe offen ist
  let gameOver = false; // nach Podium/Rauswurf nicht mehr automatisch wieder einsteigen

  // Sitzung fürs Wiedereinsteigen merken (übersteht WLAN-Abbrüche UND Seiten-Neuladen)
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem('zackboing_player')); } catch { /* egal */ }
  function saveSession(data) {
    session = data;
    try { sessionStorage.setItem('zackboing_player', JSON.stringify(data)); } catch { /* egal */ }
  }
  function clearSession() {
    session = null;
    try { sessionStorage.removeItem('zackboing_player'); } catch { /* egal */ }
  }

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  function showError(msg) {
    const el = $('join-error');
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth; // Animation neu starten
    el.classList.add('show');
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // PIN aus QR-Code-Link übernehmen (?pin=123456)
  const urlPin = new URLSearchParams(location.search).get('pin');
  if (urlPin) $('pin').value = urlPin.replace(/\D/g, '').slice(0, 6);
  $(urlPin ? 'nickname' : 'pin').focus();

  Sound.mountToggle();

  // ---------------- Beitritt ----------------
  function join() {
    Sound.ensure();
    const pin = $('pin').value.trim();
    const name = $('nickname').value.trim();
    if (pin.length !== 6) return showError('Die Spiel-PIN hat 6 Ziffern.');
    if (name.length < 2) return showError('Dein Name braucht mindestens 2 Zeichen.');

    socket.emit('player:join', { pin, name }, (res) => {
      if (res.error) return showError(res.error);
      me = { name: res.name, avatar: res.avatar, score: 0 };
      saveSession({ pin: res.pin, token: res.token });
      setIdentity();
      Sound.sfx.join();
      show('screen-lobby');
    });
  }

  // Lobby: Avatar antippen → Server würfelt einen anderen (Host-Bildschirm zieht mit)
  let avatarBusy = false;
  $('lobby-avatar').addEventListener('click', () => {
    if (avatarBusy) return;
    avatarBusy = true;
    // Mit Timeout, damit ein ausbleibendes Ack (z. B. alter Server) den Button nicht dauerhaft sperrt
    socket.timeout(3000).emit('player:shuffleAvatar', {}, (err, res) => {
      avatarBusy = false;
      if (err || !res || res.error || !res.avatar) return;
      me.avatar = res.avatar;
      setIdentity();
      Sound.sfx.click();
      const btn = $('lobby-avatar');
      btn.classList.remove('spin');
      void btn.offsetWidth;
      btn.classList.add('spin');
    });
  });

  function setIdentity() {
    $('lobby-avatar').textContent = me.avatar;
    $('lobby-name').textContent = me.name;
    $('q-avatar').textContent = me.avatar;
    $('q-name').textContent = me.name;
  }

  function showWaiting(title, hint) {
    $('waiting-title').textContent = title || 'Antwort ist raus!';
    $('waiting-hint').textContent = hint || 'Warst du schnell genug? Gleich siehst du es …';
    show('screen-waiting');
  }
  $('btn-join').addEventListener('click', join);
  $('nickname').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('nickname').focus(); });

  // ---------------- Fragen-Ablauf ----------------
  socket.on('game:prepare', ({ number, total, text, prepareMs, type }) => {
    clearInterval(prepTimer);
    arithInput = null;
    const arith = type === 'arith';
    $('prep-counter').textContent = `${arith ? 'Aufgabe' : 'Frage'} ${number} von ${total}`;
    $('prep-text').textContent = arith ? '🧮 Kopfrechnen – gleich kommt die Aufgabe!' : text;
    show('screen-prepare');

    let remaining = Math.round(prepareMs / 1000);
    $('prep-count').textContent = remaining;
    Sound.sfx.countTick();
    prepTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) { clearInterval(prepTimer); return; }
      const elCount = $('prep-count');
      elCount.textContent = remaining;
      elCount.style.animation = 'none';
      void elCount.offsetWidth;
      elCount.style.animation = '';
      if (remaining <= 3) Sound.sfx.countTick();
    }, 1000);
  });

  function submitAnswer(payload, onOk) {
    socket.emit('player:answer', payload, (res) => {
      if (res.error) return;
      Sound.sfx.submit();
      vibrate(40);
      if (onOk) onOk(res);
      else showWaiting();
    });
  }

  // --- Renderer pro Fragetyp ---------------------------------------------

  function renderChoice(area, q) {
    const grid = el('div', 'answers-grid');
    for (let i = 0; i < q.view.answerCount; i++) {
      const btn = el('button', `answer-btn c${i}`);
      btn.style.justifyContent = 'center';
      btn.appendChild(el('span', 'shape', SHAPES[i]));
      btn.addEventListener('click', () => submitAnswer({ index: i }));
      grid.appendChild(btn);
    }
    area.appendChild(grid);
  }

  function renderTrueFalse(area) {
    const grid = el('div', 'answers-grid');
    [['✔ WAHR', 'c1'], ['✖ FALSCH', 'c0']].forEach(([label, cls], i) => {
      const btn = el('button', `answer-btn ${cls}`, label);
      btn.style.justifyContent = 'center';
      btn.style.fontSize = 'clamp(1.6rem, 7vw, 2.4rem)';
      btn.addEventListener('click', () => submitAnswer({ index: i }));
      grid.appendChild(btn);
    });
    area.appendChild(grid);
  }

  function renderTextInput(area, q) {
    const stage = el('div', 'input-stage');
    const isCloud = q.type === 'wordcloud';
    stage.appendChild(el('div', 'hint', isCloud ? '☁️ Ein Wort (oder zwei), das dir dazu einfällt:' : '⌨️ Tippe deine Antwort:'));
    const input = el('input');
    input.type = 'text';
    input.maxLength = isCloud ? 30 : 80;
    input.placeholder = isCloud ? 'Dein Wort …' : 'Deine Antwort …';
    input.autocomplete = 'off';
    const btn = el('button', 'btn pink big', 'Abschicken 🚀');
    btn.style.maxWidth = '340px';
    const send = () => { if (input.value.trim()) submitAnswer({ text: input.value }); };
    btn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    stage.append(input, btn);
    area.appendChild(stage);
    setTimeout(() => input.focus(), 100);
  }

  function renderSlider(area, q) {
    const { min, max, step } = q.view;
    const stage = el('div', 'input-stage slider-stage');
    stage.appendChild(el('div', 'hint', '🎯 Schätze und schiebe den Regler:'));
    // Zufällige Startposition: die Mitte des Bereichs wäre bei symmetrisch gewählten
    // Grenzen oft genau die Lösung und würde sie verraten.
    const steps = Math.floor((max - min) / step);
    const start = min + step * Math.floor(Math.random() * (steps + 1));
    const value = el('div', 'slider-value', String(start));
    const range = el('input');
    range.type = 'range';
    range.min = min; range.max = max; range.step = step;
    range.value = start;
    range.addEventListener('input', () => { value.textContent = range.value; Sound.sfx.click(); });
    const minmax = el('div', 'slider-minmax');
    minmax.append(el('span', '', String(min)), el('span', '', String(max)));
    const btn = el('button', 'btn pink big', 'Das ist meine Schätzung!');
    btn.style.maxWidth = '340px';
    btn.addEventListener('click', () => submitAnswer({ value: Number(range.value) }));
    stage.append(value, range, minmax, btn);
    area.appendChild(stage);
  }

  // Kopfrechnen: große Zahlentastatur (kein Handy-Keyboard, das die Aufgabe verdeckt)
  const ARITH_MAX_DIGITS = 7;

  function renderArith(area, q) {
    const stage = el('div', 'arith-stage');
    stage.appendChild(el('div', 'arith-task-player', `${q.text} = ?`));
    const display = el('div', 'arith-display empty', '?');
    stage.appendChild(display);

    let value = '';
    const pad = el('div', 'numpad');
    const ok = el('button', 'ok', '✔');
    ok.setAttribute('aria-label', 'Abschicken');
    ok.disabled = true;
    const redraw = () => {
      display.textContent = value || '?';
      display.classList.toggle('empty', !value);
      ok.disabled = !value;
    };
    const input = {
      add(d) {
        if (value.length >= ARITH_MAX_DIGITS) return;
        value = value === '0' ? String(d) : value + d; // keine führenden Nullen
        Sound.sfx.click();
        redraw();
      },
      del() { value = value.slice(0, -1); redraw(); },
      send() {
        if (!value) return;
        arithInput = null;
        submitAnswer({ value: Number(value) });
      },
    };
    arithInput = input;

    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const b = el('button', '', String(d));
      b.addEventListener('click', () => input.add(d));
      pad.appendChild(b);
    }
    const del = el('button', 'del', '⌫');
    del.setAttribute('aria-label', 'Löschen');
    del.addEventListener('click', () => input.del());
    const zero = el('button', '', '0');
    zero.addEventListener('click', () => input.add(0));
    ok.addEventListener('click', () => input.send());
    pad.append(del, zero, ok);
    stage.appendChild(pad);
    area.appendChild(stage);
  }

  // Tastatur am Tablet/Laptop: Ziffern, Rücktaste, Enter
  document.addEventListener('keydown', (e) => {
    if (!arithInput || !$('screen-question').classList.contains('active')) return;
    if (/^[0-9]$/.test(e.key)) arithInput.add(Number(e.key));
    else if (e.key === 'Backspace') arithInput.del();
    else if (e.key === 'Enter') arithInput.send();
    else return;
    e.preventDefault();
  });

  function renderScale(area, q) {
    const { min, max, minLabel, maxLabel } = q.view;
    const stage = el('div', 'input-stage');
    stage.appendChild(el('div', 'hint', '📏 Wie schätzt du es ein?'));
    const labels = el('div', 'scale-labels');
    labels.append(el('span', '', minLabel || String(min)), el('span', '', maxLabel || String(max)));
    stage.appendChild(labels);
    const grid = el('div', 'scale-grid');
    for (let v = min; v <= max; v++) {
      const btn = el('button', 'scale-btn', String(v));
      btn.addEventListener('click', () => submitAnswer({ value: v }));
      grid.appendChild(btn);
    }
    stage.appendChild(grid);
    area.appendChild(stage);
  }

  function renderOrder(area, q) {
    const stage = el('div', 'input-stage');
    stage.appendChild(el('div', 'hint', '🧩 Bringe alles in die richtige Reihenfolge:'));
    let items = [...q.view.items]; // {id, text}
    const list = el('div', 'order-list');

    function redraw() {
      list.innerHTML = '';
      items.forEach((item, idx) => {
        const row = el('div', 'order-item');
        row.appendChild(el('span', 'pos', String(idx + 1)));
        row.appendChild(el('span', 'txt', item.text));
        const move = el('div', 'move');
        const up = el('button', '', '▲');
        const down = el('button', '', '▼');
        up.disabled = idx === 0;
        down.disabled = idx === items.length - 1;
        up.addEventListener('click', () => { [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]]; Sound.sfx.click(); redraw(); });
        down.addEventListener('click', () => { [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]]; Sound.sfx.click(); redraw(); });
        move.append(up, down);
        row.appendChild(move);
        list.appendChild(row);
      });
    }
    redraw();
    const btn = el('button', 'btn pink big', 'Reihenfolge abschicken!');
    btn.style.maxWidth = '340px';
    btn.addEventListener('click', () => submitAnswer({ order: items.map((i) => i.id) }));
    stage.append(list, btn);
    area.appendChild(stage);
  }

  function renderBrainstorm(area, q) {
    const maxEntries = q.view.maxEntries || 3;
    const stage = el('div', 'input-stage');
    stage.appendChild(el('div', 'hint', `💡 Sammle Ideen! (bis zu ${maxEntries})`));
    const chips = el('div', 'idea-chips');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 100;
    input.placeholder = 'Deine Idee …';
    input.autocomplete = 'off';
    const btn = el('button', 'btn pink big', 'Idee einwerfen 💡');
    btn.style.maxWidth = '340px';
    let count = q.entries || 0; // nach Wiedereinstieg: schon eingereichte Ideen zählen weiter
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      submitAnswer({ text }, () => {
        count++;
        chips.appendChild(el('span', 'idea-chip', text));
        input.value = '';
        if (count >= maxEntries) {
          input.disabled = true;
          btn.disabled = true;
          stage.appendChild(el('div', 'hint', 'Alle Ideen abgegeben – stark! 🎉'));
        } else {
          input.focus();
        }
      });
    };
    if (count >= maxEntries) { input.disabled = true; btn.disabled = true; }
    btn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    stage.append(input, btn, chips);
    area.appendChild(stage);
    setTimeout(() => input.focus(), 100);
  }

  function renderQuestion(q, { silent = false } = {}) {
    clearInterval(prepTimer);
    if (!silent) Sound.sfx.countGo();
    const area = $('play-area');
    area.innerHTML = '';
    arithInput = null;
    $('q-score').textContent = me.score;

    switch (q.type) {
      case 'choice':
      case 'poll': renderChoice(area, q); break;
      case 'truefalse': renderTrueFalse(area); break;
      case 'freetext':
      case 'wordcloud': renderTextInput(area, q); break;
      case 'slider': renderSlider(area, q); break;
      case 'scale': renderScale(area, q); break;
      case 'order': renderOrder(area, q); break;
      case 'brainstorm': renderBrainstorm(area, q); break;
      case 'arith': renderArith(area, q); break;
    }
    show('screen-question');
  }

  socket.on('game:question', (q) => renderQuestion(q));

  // ---------------- Ergebnis ----------------
  socket.on('player:result', (r) => {
    arithInput = null;
    me.score = r.score;
    const box = $('result-box');
    const streakEl = $('result-streak');
    streakEl.style.display = 'none';

    if (!r.scored) {
      // Meinungsfrage: neutrales Dankeschön
      box.className = 'result-full';
      $('result-emoji').textContent = r.answered ? '🙌' : '🤔';
      $('result-title').textContent = r.answered ? 'Danke für deine Stimme!' : 'Diesmal nichts abgegeben.';
      $('result-points').textContent = 'Schau auf den großen Bildschirm!';
      $('result-rank').textContent = '';
      if (r.answered) Sound.sfx.reveal();
      show('screen-result');
      return;
    }

    box.className = 'result-full ' + (r.correct ? 'good' : 'bad-bg');
    if (r.correct) {
      $('result-emoji').textContent = ['🎉', '🤩', '🔥', '💪', '🚀'][Math.floor(Math.random() * 5)];
      $('result-title').textContent = 'Richtig!';
      $('result-points').textContent = r.solution ? `${r.solution} · +${r.gained} Punkte` : `+${r.gained} Punkte`;
      Sound.sfx.correct();
      vibrate([50, 40, 90]);
      if (r.streak >= 3) {
        Sound.sfx.streak();
        Confetti.burst(60);
      }
    } else {
      $('result-emoji').textContent = r.answered ? '😬' : '🥱';
      $('result-title').textContent = r.answered ? (r.gained > 0 ? 'Knapp daneben!' : 'Leider falsch!') : 'Zeit abgelaufen!';
      $('result-points').textContent = r.solution ? `Richtig ist: ${r.solution}`
        : r.gained > 0 ? `Immerhin +${r.gained} Punkte!` : (r.answered ? 'Beim nächsten Mal klappt es!' : 'Sei schneller beim Tippen!');
      Sound.sfx.wrong();
      vibrate(250);
    }

    if (r.streak >= 2) {
      streakEl.style.display = '';
      streakEl.textContent = `🔥 ${r.streak}er-Serie!`;
    }

    let rankText = `Platz ${r.rank} von ${r.totalPlayers} · ${r.score} Punkte`;
    if (r.behind && r.behind.gap > 0) rankText += ` · noch ${r.behind.gap} hinter ${r.behind.name}`;
    if (r.rank === 1) rankText = `👑 Du bist auf Platz 1! · ${r.score} Punkte`;
    $('result-rank').textContent = rankText;

    show('screen-result');
  });

  // ---------------- Spielende ----------------
  socket.on('player:podium', (p) => {
    gameOver = true;
    clearSession();
    const emojis = { 1: '🥇', 2: '🥈', 3: '🥉' };
    $('final-emoji').textContent = emojis[p.rank] || '🎖️';
    $('final-title').textContent =
      p.rank === 1 ? 'Du hast gewonnen!' :
      p.rank <= 3 ? `Platz ${p.rank} – stark!` :
      `Platz ${p.rank} von ${p.totalPlayers}`;
    $('final-score').textContent = `${p.score} Punkte`;
    $('final-stats').textContent = `${p.correctCount} von ${p.totalQuestions} richtig · beste Serie: ${p.bestStreak} 🔥`;
    if (p.rank === 1) { Confetti.rain(6); Sound.sfx.fanfare(); }
    else if (p.rank <= 3) { Confetti.burst(100); Sound.sfx.reveal(); }
    show('screen-final');
  });

  socket.on('player:kicked', () => {
    gameOver = true;
    clearSession();
    $('gone-title').textContent = 'Du wurdest aus dem Spiel entfernt.';
    show('screen-gone');
  });

  socket.on('game:aborted', () => {
    gameOver = true;
    clearSession();
    $('gone-title').textContent = 'Das Spiel wurde beendet.';
    show('screen-gone');
  });

  // ---------------- Verbindungsabbrüche: automatisch zurück ins Spiel ----------------
  function applyResume(res) {
    me = { name: res.name, avatar: res.avatar, score: res.score };
    setIdentity();
    switch (res.state) {
      case 'lobby':
        show('screen-lobby');
        break;
      case 'prepare':
        showWaiting('Wieder da! 🎉', 'Gleich kommt die nächste Frage …');
        break;
      case 'question':
        if (res.question.answered) showWaiting('Wieder da! 🎉', 'Deine Antwort ist schon drin – gleich kommt die Auflösung!');
        else renderQuestion(res.question, { silent: true });
        break;
      default:
        // results/podium: das verpasste Ergebnis schickt der Server gleich hinterher
        showWaiting('Wieder da! 🎉', 'Einen Moment …');
    }
  }

  socket.on('connect', () => {
    if (!session || gameOver) return;
    socket.emit('player:rejoin', { pin: session.pin, token: session.token }, (res) => {
      if (res.error) {
        clearSession();
        if (me.name) {
          $('gone-title').textContent = res.error;
          show('screen-gone');
        }
        return;
      }
      applyResume(res);
    });
  });

  socket.on('disconnect', () => {
    // Socket.IO verbindet automatisch neu; solange zeigen wir nur einen Hinweis.
    if (me.name && !gameOver) show('screen-offline');
  });
})();
