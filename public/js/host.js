/* Host-Client: läuft auf dem Lehrergerät und wird auf den Beamer gespiegelt.
 * Steuert Lobby, Fragenanzeige, Ergebnisse und Podium; Musik läuft hier. */
(() => {
  const socket = io();
  const SHAPES = ['▲', '◆', '●', '■'];
  // Wahr/Falsch: gleiche Farben und Symbole wie auf dem Schülergerät (Wahr blau, Falsch rot)
  const TF_COLORS = ['c1', 'c0'];
  const TF_SHAPES = ['✔', '✖'];
  const TYPE_LABELS = {
    choice: '🎯 Quiz', truefalse: '⚖️ Wahr oder Falsch', freetext: '⌨️ Freitext',
    slider: '🎚️ Schätzfrage', order: '🧩 Puzzle', poll: '📊 Umfrage',
    scale: '📏 Skala', wordcloud: '☁️ Wortwolke', brainstorm: '💡 Brainstorming',
    arith: '🧮 Kopfrechnen',
  };
  const unitLabel = (type) => (type === 'arith' ? 'Aufgabe' : 'Frage');
  const CLOUD_COLORS = ['#ffd23e', '#ff8ac2', '#7fd8ff', '#8effb9', '#ffb37a', '#c9a6ff', '#ffffff'];
  const $ = (id) => document.getElementById(id);

  const quizId = new URLSearchParams(location.search).get('quiz');
  let pin = null;
  let hostToken = null;       // für Wiedereinstieg nach Verbindungsabbruch/Neuladen
  let lobbyOpened = false;    // wurde WebAudio schon per Klick freigeschaltet?
  let questionTimer = null;
  let prepTimer = null;
  let currentQuestion = null; // letztes game:question-Payload (inkl. view)
  let gameMode = 'quiz';      // quiz | mental
  let autoNextTimer = null;   // Kopfrechnen: Countdown bis zum automatischen Weiter

  let hostSession = null;
  try { hostSession = JSON.parse(sessionStorage.getItem('zackboing_host')); } catch { /* egal */ }
  function saveHostSession() {
    try { sessionStorage.setItem('zackboing_host', JSON.stringify({ pin, token: hostToken, quizId })); } catch { /* egal */ }
  }
  function clearHostSession() {
    hostSession = null;
    try { sessionStorage.removeItem('zackboing_host'); } catch { /* egal */ }
  }

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fail(msg) {
    Sound.stopMusic();
    $('error-text').textContent = msg;
    show('screen-error');
  }

  function renderMedia(container, media, { autoplay = false } = {}) {
    container.innerHTML = '';
    if (!media) return;
    if (media.kind === 'image') {
      const img = el('img');
      img.src = media.url;
      img.alt = '';
      container.appendChild(img);
    } else if (media.kind === 'audio') {
      const audio = el('audio');
      audio.src = media.url;
      audio.controls = true;
      if (autoplay) audio.autoplay = true;
      container.appendChild(audio);
    } else if (media.kind === 'video') {
      const video = el('video');
      video.src = media.url;
      video.controls = true;
      if (autoplay) video.autoplay = true;
      container.appendChild(video);
    }
  }

  Sound.mountToggle();

  // ---------------- Spiel eröffnen / wiederaufnehmen ----------------
  function fillGameInfo(res) {
    gameMode = res.mode || 'quiz';
    const unit = gameMode === 'mental' ? 'Aufgaben' : 'Fragen';
    $('gate-info').textContent = `„${res.title}“ · ${res.questionCount} ${unit}`;
    $('lobby-quiz-title').textContent = res.title;
    if (gameMode === 'mental') {
      const cfg = res.mental;
      const slider = $('lobby-count');
      slider.min = cfg.minCount;
      slider.max = cfg.maxCount;
      // Regler nicht zurücksetzen, wenn nur die Verbindung kurz weg war
      if (!slider.dataset.touched) slider.value = cfg.count;
      $('lobby-count-value').textContent = slider.value;
      $('lobby-mental-info').textContent = `Zahlenraum ${cfg.info} · ${cfg.time} s pro Aufgabe`;
      $('lobby-mental').style.display = '';
    }
    $('pin-display').textContent = pin;
    $('qr-img').src = `/qr/${pin}.png`;
    const joinUrl = `${location.origin}/?pin=${pin}`;
    $('join-url').textContent = joinUrl.replace(/^https?:\/\//, '');
    $('join-url-inline').textContent = location.origin.replace(/^https?:\/\//, '');
    $('btn-open-lobby').disabled = false;
  }

  function createGame() {
    socket.emit('host:create', { quizId }, (res) => {
      if (res.error) return fail(res.error);
      pin = res.pin;
      hostToken = res.hostToken;
      saveHostSession();
      fillGameInfo(res);
    });
  }

  function rejoinGame(sessPin, sessToken, { fallbackToCreate = false } = {}) {
    socket.emit('host:rejoin', { pin: sessPin, token: sessToken }, (res) => {
      if (res.error) {
        clearHostSession();
        if (fallbackToCreate) return createGame(); // altes Spiel vorbei → neues eröffnen
        return fail(res.error);
      }
      hideOffline();
      pin = res.pin;
      hostToken = sessToken;
      saveHostSession();
      fillGameInfo(res);
      renderLobbyPlayers(res.players);
      if (res.state === 'lobby') {
        // Nach Neuladen erst wieder per Klick starten (schaltet WebAudio frei)
        show(lobbyOpened ? 'screen-lobby' : 'screen-gate');
      }
      // Alle anderen Zustände stellt der Server per Re-Sync-Events wieder her.
    });
  }

  socket.on('connect', () => {
    if (pin && hostToken) return rejoinGame(pin, hostToken); // Reconnect im laufenden Spiel
    if (hostSession && hostSession.quizId === quizId) {
      // Seite wurde neu geladen, während ein Spiel lief
      return rejoinGame(hostSession.pin, hostSession.token, { fallbackToCreate: true });
    }
    createGame();
  });

  // Erster Klick: schaltet WebAudio frei und startet die Lobby-Musik
  $('btn-open-lobby').addEventListener('click', () => {
    lobbyOpened = true;
    Sound.ensure();
    Sound.startMusic('lobby');
    show('screen-lobby');
  });

  // ---------------- Lobby ----------------
  function renderLobbyPlayers(players) {
    $('player-count').textContent = players.length;
    const wrap = $('lobby-players');
    wrap.innerHTML = '';
    for (const p of players) {
      const chip = el('div', 'lobby-chip');
      if (p.connected === false) chip.classList.add('offline'); // kurz getrennt, Platz bleibt reserviert
      chip.title = 'Klicken zum Entfernen';
      chip.append(el('span', 'avatar', p.avatar), el('span', '', p.name));
      chip.addEventListener('click', () => socket.emit('host:kick', { name: p.name }));
      wrap.appendChild(chip);
    }
  }

  socket.on('lobby:update', ({ players, joined }) => {
    renderLobbyPlayers(players);
    if (joined) Sound.sfx.join();
  });

  $('lobby-count').addEventListener('input', () => {
    $('lobby-count').dataset.touched = '1';
    $('lobby-count-value').textContent = $('lobby-count').value;
  });

  $('btn-start').addEventListener('click', () => {
    Sound.sfx.click();
    socket.emit('host:start', gameMode === 'mental' ? { count: Number($('lobby-count').value) } : undefined);
  });

  socket.on('host:error', ({ error }) => {
    alert(error);
  });

  // ---------------- Vorbereitung ----------------
  socket.on('game:prepare', (q) => {
    clearInterval(prepTimer);
    clearInterval(questionTimer);
    Sound.stopMusic();
    stopAutoNext();
    $('prep-counter').textContent = `${unitLabel(q.type)} ${q.number} von ${q.total}`;
    $('prep-type').textContent = TYPE_LABELS[q.type] || '';
    $('prep-points').textContent = !q.scored ? '🗳️ Eure Meinung zählt!'
      : q.points === 'double' ? '💎 Doppelte Punkte!'
      : q.points === 'none' ? 'Übungsfrage – keine Punkte'
      : '⚡ Schnelligkeit zählt!';
    $('prep-text').textContent = q.type === 'arith' ? 'Achtung, fertig …' : q.text;
    show('screen-prepare');

    let remaining = Math.round(q.prepareMs / 1000);
    $('prep-count').textContent = remaining;
    Sound.sfx.countTick();
    prepTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) return clearInterval(prepTimer);
      const cnt = $('prep-count');
      cnt.textContent = remaining;
      cnt.style.animation = 'none';
      void cnt.offsetWidth;
      cnt.style.animation = '';
      if (remaining <= 3) Sound.sfx.countTick();
    }, 1000);
  });

  // ---------------- Frage: typabhängige Bühne ----------------
  function answerGrid(answers, { markCorrect = null, dimOthers = false, trueFalse = false } = {}) {
    const grid = el('div', 'answers-grid');
    grid.style.flex = 'unset';
    grid.style.padding = '12px 24px';
    answers.forEach((answer, i) => {
      const div = el('div', `answer-btn ${trueFalse ? TF_COLORS[i] : `c${i}`}`);
      if (markCorrect !== null) div.classList.add(i === markCorrect ? 'reveal-correct' : (dimOthers ? 'dimmed' : 'x'));
      div.style.cursor = 'default';
      div.appendChild(el('span', 'shape', trueFalse ? TF_SHAPES[i] : SHAPES[i]));
      if (answer.media) {
        const img = el('img', 'answer-media');
        img.src = answer.media.url;
        div.appendChild(img);
      }
      div.appendChild(el('span', '', answer.text || ''));
      if (markCorrect === i) div.appendChild(el('span', 'checkmark', '✔'));
      grid.appendChild(div);
    });
    return grid;
  }

  function buildQuestionStage(q) {
    const stage = $('host-stage');
    stage.innerHTML = '';

    switch (q.type) {
      case 'choice':
      case 'poll':
        stage.appendChild(answerGrid(q.view.answers));
        break;
      case 'truefalse':
        stage.appendChild(answerGrid(q.view.answers, { trueFalse: true }));
        break;
      case 'order': {
        const list = el('div', 'order-list');
        q.view.items.forEach((text, i) => {
          const row = el('div', 'order-item');
          row.append(el('span', 'pos', '?'), el('span', 'txt', text));
          list.appendChild(row);
        });
        stage.appendChild(el('p', 'waiting-hint', 'Sortiert die Teile auf eurem Gerät in die richtige Reihenfolge!'));
        stage.appendChild(list);
        break;
      }
      case 'slider': {
        const wrap = el('div', 'number-line-wrap');
        const line = el('div', 'number-line');
        line.appendChild(el('div', 'axis'));
        const ends = el('div', 'ends');
        ends.append(el('span', '', String(q.view.min)), el('span', '', String(q.view.max)));
        wrap.append(line, ends);
        stage.appendChild(el('p', 'waiting-hint', 'Schätzt auf eurem Gerät mit dem Regler!'));
        stage.appendChild(wrap);
        break;
      }
      case 'scale': {
        const labels = el('div', 'scale-labels');
        labels.style.margin = '10px auto';
        labels.append(
          el('span', '', `${q.view.min} = ${q.view.minLabel || q.view.min}`),
          el('span', '', `${q.view.max} = ${q.view.maxLabel || q.view.max}`),
        );
        stage.appendChild(el('p', 'waiting-hint', 'Gebt eure Einschätzung auf eurem Gerät ab!'));
        stage.appendChild(labels);
        break;
      }
      case 'freetext':
        stage.appendChild(el('p', 'waiting-hint', '⌨️ Tippt die Antwort auf eurem Gerät ein!'));
        break;
      case 'arith':
        stage.appendChild(el('p', 'waiting-hint', '🧮 Rechnet im Kopf und tippt das Ergebnis ein!'));
        break;
      case 'wordcloud':
        stage.appendChild(el('p', 'waiting-hint', '☁️ Schickt eure Wörter ab – gleich entsteht daraus eine Wolke!'));
        break;
      case 'brainstorm': {
        stage.appendChild(el('p', 'waiting-hint', '💡 Eure Ideen erscheinen hier live!'));
        const chips = el('div', 'idea-chips');
        chips.id = 'live-ideas';
        chips.style.padding = '10px 24px';
        stage.appendChild(chips);
        break;
      }
    }
  }

  socket.on('game:question', (q) => {
    clearInterval(prepTimer);
    currentQuestion = q;
    // silent: nur als Kontext für eine gleich folgende Ergebnisanzeige (Re-Sync)
    if (q.silent) return;
    if (!q.resync) {
      Sound.sfx.countGo();
      Sound.startMusic('question');
    }

    $('q-counter').textContent = `${unitLabel(q.type)} ${q.number} von ${q.total}`;
    $('q-type').textContent = TYPE_LABELS[q.type] || '';
    $('q-text').textContent = q.type === 'arith' ? `${q.text} = ?` : q.text;
    $('q-text').classList.toggle('arith-task', q.type === 'arith');
    $('btn-skip').textContent = `${unitLabel(q.type)} beenden ⏭`;
    $('answered-num').textContent = '0';
    renderMedia($('q-media'), q.media, { autoplay: !q.resync });
    buildQuestionStage(q);

    const total = q.time * 1000;
    const startedAt = Date.now() - (q.elapsedMs || 0); // Re-Sync: Restzeit stimmt wieder
    $('timer-circle').classList.remove('hurry');
    clearInterval(questionTimer);
    questionTimer = setInterval(() => {
      const left = Math.max(0, total - (Date.now() - startedAt));
      $('timer-circle').textContent = Math.ceil(left / 1000);
      $('timer-bar').style.width = `${(left / total) * 100}%`;
      if (left <= 5000 && left > 0) {
        $('timer-circle').classList.add('hurry');
        Sound.sfx.hurry();
      }
      if (left <= 0) clearInterval(questionTimer);
    }, 200);
    $('timer-circle').textContent = Math.ceil((total - (q.elapsedMs || 0)) / 1000);

    show('screen-question');
  });

  socket.on('game:answerCount', ({ answered, total }) => {
    $('answered-num').textContent = `${answered}/${total}`;
    Sound.sfx.click();
  });

  // Brainstorming: Ideen tröpfeln live rein
  socket.on('game:liveEntry', ({ text, avatar }) => {
    const chips = $('live-ideas');
    if (!chips) return;
    const chip = el('span', 'idea-chip');
    chip.append(el('span', 'avatar', avatar), el('span', '', text));
    chips.appendChild(chip);
    Sound.sfx.join();
  });

  $('btn-skip').addEventListener('click', () => socket.emit('host:skip'));

  // ---------------- Ergebnisse: typabhängige Auswertung ----------------
  function barChart(distribution, correct, labels, colors) {
    const chart = el('div', 'chart');
    const max = Math.max(1, ...distribution);
    distribution.forEach((count, i) => {
      const col = el('div', 'bar-col' + (correct === null || i === correct ? '' : ' wrong'));
      col.appendChild(el('div', 'count', String(count)));
      const bar = el('div', `bar ${colors ? colors[i] : `c${i}`}`);
      bar.style.height = '6px';
      col.appendChild(bar);
      col.appendChild(el('div', 'shape-lbl', labels ? labels[i] : SHAPES[i]));
      col.appendChild(el('div', 'tick', correct !== null && i === correct ? '✔️' : ''));
      chart.appendChild(col);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        bar.style.height = `${8 + (count / max) * 160}px`;
      }));
    });
    return chart;
  }

  function buildResultStage(r) {
    const stage = $('result-stage');
    stage.innerHTML = '';
    const q = currentQuestion;

    switch (r.type) {
      case 'choice':
        stage.appendChild(barChart(r.summary.distribution, r.summary.correct));
        stage.appendChild(answerGrid(q.view.answers, { markCorrect: r.summary.correct, dimOthers: true }));
        break;

      case 'truefalse':
        stage.appendChild(barChart(r.summary.distribution, r.summary.correct, TF_SHAPES, TF_COLORS));
        stage.appendChild(answerGrid(q.view.answers, { markCorrect: r.summary.correct, dimOthers: true, trueFalse: true }));
        break;

      case 'poll': {
        stage.appendChild(el('h2', 'big-average', 'So habt ihr abgestimmt:'));
        stage.appendChild(barChart(r.summary.distribution, null));
        stage.appendChild(answerGrid(q.view.answers));
        break;
      }

      case 'freetext': {
        stage.appendChild(el('h2', 'big-average', `Richtig war: „${r.summary.accepted[0]}“`));
        const chips = el('div', 'freetext-results');
        if (!r.summary.given.length) chips.appendChild(el('p', 'waiting-hint', 'Keine Antworten abgegeben.'));
        r.summary.given.forEach((g, i) => {
          const chip = el('span', 'freetext-chip' + (g.correct ? ' right' : ''));
          chip.style.animationDelay = `${i * 0.08}s`;
          chip.append(el('span', '', (g.correct ? '✔ ' : '') + g.text), el('span', 'cnt', `×${g.count}`));
          chips.appendChild(chip);
        });
        stage.appendChild(chips);
        break;
      }

      case 'arith': {
        const { task, correct, rightCount, given } = r.summary;
        const sol = el('div', 'arith-solution');
        sol.append(`${task} = `, el('span', 'res', String(correct)));
        stage.appendChild(sol);
        stage.appendChild(el('h2', 'big-average', `${rightCount} von ${r.totalPlayers} richtig${rightCount === r.totalPlayers && rightCount > 0 ? ' – alle! 🎉' : ''}`));
        const chips = el('div', 'freetext-results');
        given.forEach((g, i) => {
          const chip = el('span', 'freetext-chip' + (g.correct ? ' right' : ''));
          chip.style.animationDelay = `${i * 0.06}s`;
          chip.append(el('span', '', (g.correct ? '✔ ' : '') + g.value), el('span', 'cnt', `×${g.count}`));
          chips.appendChild(chip);
        });
        stage.appendChild(chips);
        break;
      }

      case 'slider': {
        const { values, average, correct, tolerance, min, max } = r.summary;
        const head = el('h2', 'big-average');
        head.innerHTML = `Richtige Antwort: <span class="num"></span>`;
        head.querySelector('.num').textContent = String(correct);
        if (average !== null) head.append(` · Euer Durchschnitt: ${average}`);
        stage.appendChild(head);

        const wrap = el('div', 'number-line-wrap');
        const line = el('div', 'number-line');
        line.appendChild(el('div', 'axis'));
        const pct = (v) => ((v - min) / (max - min)) * 100;
        if (tolerance > 0) {
          const tol = el('div', 'tol');
          tol.style.left = `${Math.max(0, pct(correct - tolerance))}%`;
          tol.style.width = `${Math.min(100, pct(correct + tolerance)) - Math.max(0, pct(correct - tolerance))}%`;
          line.appendChild(tol);
        }
        values.forEach((v, i) => {
          const dot = el('div', 'dot');
          dot.style.left = `${pct(v)}%`;
          dot.style.animationDelay = `${i * 0.05}s`;
          line.appendChild(dot);
        });
        const marker = el('div', 'marker');
        marker.style.left = `${pct(correct)}%`;
        marker.append(el('div', 'flag', '🎯'), el('div', '', String(correct)));
        line.appendChild(marker);
        const ends = el('div', 'ends');
        ends.append(el('span', '', String(min)), el('span', '', String(max)));
        wrap.append(line, ends);
        stage.appendChild(wrap);
        break;
      }

      case 'order': {
        stage.appendChild(el('h2', 'big-average', `${r.summary.perfectCount} von ${r.answeredCount} hatten die perfekte Reihenfolge!`));
        const list = el('div', 'order-list');
        r.summary.correctOrder.forEach((text, i) => {
          const row = el('div', 'order-item correct-pos');
          row.style.animation = `slideIn 0.5s ${i * 0.25}s backwards`;
          row.append(el('span', 'pos', String(i + 1)), el('span', 'txt', text));
          list.appendChild(row);
        });
        stage.appendChild(list);
        break;
      }

      case 'scale': {
        const { distribution, average, min, max, minLabel, maxLabel } = r.summary;
        if (average !== null) {
          const head = el('h2', 'big-average');
          head.append('Durchschnitt: ');
          const num = el('span', 'num', String(average));
          head.appendChild(num);
          stage.appendChild(head);
        }
        const box = el('div', 'scale-result');
        const counts = Object.values(distribution);
        const maxCount = Math.max(1, ...counts);
        for (let v = min; v <= max; v++) {
          const row = el('div', 'scale-row');
          row.appendChild(el('span', 'val', String(v)));
          const track = el('div', 'track');
          const fill = el('div', 'fill');
          fill.style.width = '0%';
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el('span', 'cnt', String(distribution[v])));
          box.appendChild(row);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            fill.style.width = `${(distribution[v] / maxCount) * 100}%`;
          }));
        }
        stage.appendChild(box);
        const labels = el('div', 'scale-labels');
        labels.style.margin = '6px auto';
        labels.append(el('span', '', minLabel || ''), el('span', '', maxLabel || ''));
        stage.appendChild(labels);
        break;
      }

      case 'wordcloud': {
        const cloud = el('div', 'wordcloud');
        if (!r.summary.words.length) cloud.appendChild(el('p', 'waiting-hint', 'Keine Wörter abgegeben.'));
        const maxCount = Math.max(1, ...r.summary.words.map((w) => w.count));
        // größtes Wort in die Mitte: Reihenfolge mischen, Größe nach Häufigkeit
        const shuffled = [...r.summary.words].sort(() => Math.random() - 0.5);
        shuffled.forEach((w, i) => {
          const span = el('span', '', w.word);
          const scale = 0.9 + (w.count / maxCount) * 2.6;
          span.style.fontSize = `${scale}rem`;
          span.style.color = CLOUD_COLORS[i % CLOUD_COLORS.length];
          span.style.animationDelay = `${i * 0.07}s`;
          span.title = `×${w.count}`;
          cloud.appendChild(span);
        });
        stage.appendChild(cloud);
        break;
      }

      case 'brainstorm': {
        stage.appendChild(el('h2', 'big-average', `${r.summary.ideas.length} Ideen gesammelt! 💡`));
        const chips = el('div', 'freetext-results');
        r.summary.ideas.forEach((idea, i) => {
          const chip = el('span', 'freetext-chip');
          chip.style.animationDelay = `${i * 0.06}s`;
          chip.append(el('span', '', `${idea.avatar} `), el('span', '', idea.text));
          chips.appendChild(chip);
        });
        stage.appendChild(chips);
        break;
      }
    }
  }

  socket.on('game:results', (r) => {
    clearInterval(questionTimer);
    Sound.stopMusic();
    if (!r.resync) {
      Sound.sfx.timeUp();
      setTimeout(() => Sound.sfx.reveal(), 500);
      setTimeout(() => Sound.startMusic('results'), 900);
    }

    $('r-counter').textContent = currentQuestion ? `${unitLabel(r.type)} ${currentQuestion.number} von ${currentQuestion.total}` : '';
    $('r-type').textContent = TYPE_LABELS[r.type] || '';
    $('btn-next').dataset.label = r.isLast ? 'Zum Podium 🏆' : 'Weiter ▶';
    $('btn-next').textContent = $('btn-next').dataset.label;
    startAutoNext(r.autoNextMs);

    buildResultStage(r);

    // Zwischenstand nur bei Wissensfragen
    const lb = $('leaderboard');
    lb.innerHTML = '';
    if (r.scored) {
      for (const entry of r.leaderboard) {
        const row = el('div', 'lb-row');
        row.appendChild(el('span', 'rank', ['🥇', '🥈', '🥉'][entry.rank - 1] || entry.rank + '.'));
        row.appendChild(el('span', 'avatar', entry.avatar));
        row.appendChild(el('span', 'nm', entry.name));
        if (entry.streak >= 3) row.appendChild(el('span', 'streak-flame', `🔥${entry.streak}`));
        row.appendChild(el('span', 'score', String(entry.score)));
        lb.appendChild(row);
      }
    }

    show('screen-results');
  });

  $('btn-next').addEventListener('click', () => {
    Sound.sfx.click();
    stopAutoNext();
    socket.emit('host:next');
  });

  // Kopfrechnen: Server geht nach der Auflösung allein weiter; hier nur Countdown + Anhalten
  function startAutoNext(ms) {
    stopAutoNext();
    if (!ms) return;
    const endAt = Date.now() + ms;
    const btn = $('btn-next');
    const tick = () => {
      const left = Math.ceil((endAt - Date.now()) / 1000);
      btn.textContent = `${btn.dataset.label} (${Math.max(0, left)})`;
    };
    tick();
    autoNextTimer = setInterval(tick, 250);
    $('btn-hold').style.display = '';
  }

  function stopAutoNext() {
    clearInterval(autoNextTimer);
    autoNextTimer = null;
    $('btn-hold').style.display = 'none';
    if ($('btn-next').dataset.label) $('btn-next').textContent = $('btn-next').dataset.label;
  }

  $('btn-hold').addEventListener('click', () => {
    Sound.sfx.click();
    socket.emit('host:holdAuto');
  });
  socket.on('game:autoHeld', stopAutoNext);

  // ---------------- Podium ----------------
  socket.on('game:podium', ({ title, board, resync }) => {
    Sound.stopMusic();
    stopAutoNext();
    clearHostSession(); // Neuladen nach der Siegerehrung soll ein frisches Spiel eröffnen
    $('podium-title').textContent = `${title} – Siegerehrung!`;

    const wrap = $('podium');
    wrap.innerHTML = '';
    // Reihenfolge auf dem Podium: 2. links, 1. Mitte, 3. rechts
    const order = [board[1], board[0], board[2]].filter(Boolean);
    const cls = { 1: 'p1', 2: 'p2', 3: 'p3' };
    for (const entry of order) {
      const col = el('div', `podium-col ${cls[entry.rank]}`);
      col.appendChild(el('div', 'avatar', entry.avatar));
      col.appendChild(el('div', 'pname', entry.name));
      col.appendChild(el('div', 'pscore', `${entry.score} Punkte`));
      col.appendChild(el('div', 'podium-block', ['🥇', '🥈', '🥉'][entry.rank - 1]));
      wrap.appendChild(col);
    }

    const list = $('final-list');
    list.innerHTML = '';
    for (const entry of board.slice(3)) {
      const row = el('div', 'lb-row');
      row.append(
        el('span', 'rank', `${entry.rank}.`),
        el('span', 'avatar', entry.avatar),
        el('span', 'nm', entry.name),
        el('span', 'score', String(entry.score)),
      );
      list.appendChild(row);
    }

    if (!resync) {
      Sound.sfx.drumroll(1.6);
      setTimeout(() => {
        Sound.sfx.fanfare();
        Confetti.rain(7);
      }, 1650);
    }

    show('screen-podium');
  });

  // ---------------- Verbindungsabbrüche ----------------
  function showOffline() { $('offline-banner').style.display = ''; }
  function hideOffline() { $('offline-banner').style.display = 'none'; }

  socket.on('disconnect', () => {
    // Socket.IO verbindet automatisch neu; das Spiel läuft serverseitig weiter.
    if (pin) showOffline();
  });
})();
