/* Lehrer-Client: Konto, Quiz-Liste, Quiz-Editor mit Fragetypen und Medien. */
(() => {
  const $ = (id) => document.getElementById(id);
  const SHAPES = ['▲', '◆', '●', '■'];

  const TYPES = {
    choice:     { icon: '🎯', label: 'Quiz', sub: '2–4 Antworten, eine richtig' },
    truefalse:  { icon: '⚖️', label: 'Wahr oder Falsch', sub: 'Behauptung prüfen' },
    freetext:   { icon: '⌨️', label: 'Freitext', sub: 'Antwort eintippen' },
    slider:     { icon: '🎚️', label: 'Schätzfrage', sub: 'Zahl mit Regler schätzen' },
    order:      { icon: '🧩', label: 'Puzzle', sub: 'In Reihenfolge bringen' },
    poll:       { icon: '📊', label: 'Umfrage', sub: 'Meinung, keine Punkte' },
    scale:      { icon: '📏', label: 'Skala', sub: 'Einschätzung 1–5, keine Punkte' },
    wordcloud:  { icon: '☁️', label: 'Wortwolke', sub: 'Begriffe sammeln, keine Punkte' },
    brainstorm: { icon: '💡', label: 'Brainstorming', sub: 'Ideen sammeln, keine Punkte' },
  };
  const OPINION = ['poll', 'scale', 'wordcloud', 'brainstorm'];

  let editingQuizId = null;   // null = neues Quiz
  let questions = [];

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  function flashError(elId, msg) {
    const el = $(elId);
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler.');
    return data;
  }

  // "10 Fragen" bzw. bei Kopfrechenrunden "10 Aufgaben · bis 20 · + −"
  function countLabel(quiz) {
    const n = quiz.questionCount;
    if (quiz.mode === 'mental') return `${n} Aufgabe${n === 1 ? '' : 'n'} · ${quiz.mentalInfo}`;
    return `${n} Frage${n === 1 ? '' : 'n'}`;
  }

  // ---------------- Login / Registrierung ----------------
  $('show-register').addEventListener('click', () => {
    $('login-form').style.display = 'none';
    $('register-form').style.display = '';
  });
  $('show-login').addEventListener('click', () => {
    $('register-form').style.display = 'none';
    $('login-form').style.display = '';
  });

  $('btn-login').addEventListener('click', async () => {
    try {
      const data = await api('/api/login', { method: 'POST', body: { email: $('login-email').value, password: $('login-password').value } });
      enterDashboard(data.user);
    } catch (e) { flashError('auth-error', e.message); }
  });
  $('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-login').click(); });

  $('btn-register').addEventListener('click', async () => {
    try {
      const data = await api('/api/register', {
        method: 'POST',
        body: { name: $('reg-name').value, email: $('reg-email').value, password: $('reg-password').value, bootstrapToken: $('reg-bootstrap').value },
      });
      enterDashboard(data.user);
    } catch (e) { flashError('auth-error', e.message); }
  });

  $('btn-logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.reload();
  });

  // ---------------- Dashboard ----------------
  let subjects = [];

  async function loadSubjects() {
    subjects = (await api('/api/subjects')).subjects;
    const selects = [$('quiz-subject'), $('lib-subject'), $('mental-subject')];
    for (const sel of selects) {
      sel.length = 1;
      for (const s of subjects) sel.appendChild(new Option(s, s));
    }
  }

  async function enterDashboard(user) {
    $('user-name').textContent = user.name;
    $('link-admin').style.display = user.role === 'admin' ? '' : 'none';
    show('screen-dashboard');
    await Promise.all([loadQuizzes(), loadSubjects()]);
  }

  // Tabs: Meine Quizze / Bibliothek
  function switchTab(library) {
    $('tab-mine').classList.toggle('active', !library);
    $('tab-library').classList.toggle('active', library);
    $('panel-mine').style.display = library ? 'none' : '';
    $('panel-library').style.display = library ? '' : 'none';
    if (library) loadLibrary();
  }
  $('tab-mine').addEventListener('click', () => switchTab(false));
  $('tab-library').addEventListener('click', () => switchTab(true));

  async function loadLibrary() {
    const params = new URLSearchParams({
      subject: $('lib-subject').value,
      q: $('lib-search').value.trim(),
    });
    const { quizzes } = await api(`/api/library?${params}`);
    const list = $('library-list');
    list.innerHTML = '';
    $('library-empty').style.display = quizzes.length ? 'none' : '';

    let lastSubject = null;
    for (const quiz of quizzes) {
      const subject = quiz.subject || 'Ohne Fach';
      if (subject !== lastSubject) {
        lastSubject = subject;
        const header = document.createElement('div');
        header.className = 'lib-subject-header';
        header.append(Object.assign(document.createElement('span'), { textContent: `📖 ${subject}` }));
        header.appendChild(Object.assign(document.createElement('span'), { className: 'line' }));
        list.appendChild(header);
      }
      const item = document.createElement('div');
      item.className = 'quiz-item';
      item.innerHTML = `
        <div class="meta">
          <h3></h3>
          <div class="sub"></div>
        </div>
        <div class="actions">
          <button class="btn green" data-act="host">▶ Starten</button>
          <button class="btn small" data-act="copy">📋 In meine Quizze kopieren</button>
          <button class="btn small" data-act="export" title="Als JSON-Datei herunterladen">⬇️ Export</button>
        </div>`;
      item.querySelector('h3').textContent = quiz.title;
      const sub = item.querySelector('.sub');
      if (quiz.mode === 'mental') sub.appendChild(Object.assign(document.createElement('span'), { className: 'mental-badge', textContent: '🧮 Kopfrechnen' }));
      sub.append(`${quiz.mine ? 'dein Quiz' : `von ${quiz.owner}`} · ${countLabel(quiz)}`);
      item.querySelector('[data-act="host"]').addEventListener('click', () => {
        window.open(`/host.html?quiz=${quiz.id}`, '_blank');
      });
      item.querySelector('[data-act="export"]').addEventListener('click', () => downloadExport(`/api/quizzes/${quiz.id}/export`));
      item.querySelector('[data-act="copy"]').addEventListener('click', async (e) => {
        try {
          await api(`/api/library/${quiz.id}/copy`, { method: 'POST' });
          e.target.textContent = '✔ Kopiert!';
          e.target.disabled = true;
          loadQuizzes();
        } catch (err) { flashError('auth-error', err.message); alert(err.message); }
      });
      list.appendChild(item);
    }
  }

  let libSearchTimer = null;
  $('lib-search').addEventListener('input', () => {
    clearTimeout(libSearchTimer);
    libSearchTimer = setTimeout(loadLibrary, 300);
  });
  $('lib-subject').addEventListener('change', loadLibrary);

  async function loadQuizzes() {
    const { quizzes } = await api('/api/quizzes');
    const list = $('quiz-list');
    list.innerHTML = '';
    $('empty-state').style.display = quizzes.length ? 'none' : '';
    for (const quiz of quizzes) {
      const item = document.createElement('div');
      item.className = 'quiz-item';
      item.innerHTML = `
        <div class="meta">
          <h3></h3>
          <div class="sub" style="margin-top:6px;">
            <span class="badges"></span><span class="count"></span> · zuletzt geändert: ${new Date(quiz.updatedAt.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE')}
          </div>
        </div>
        <div class="actions">
          <button class="btn green" data-act="host">▶ Starten</button>
          <button class="btn small" data-act="edit">✏️ Bearbeiten</button>
          <button class="btn small" data-act="export" title="Als JSON-Datei herunterladen">⬇️ Export</button>
          <button class="btn small danger" data-act="delete">🗑️</button>
        </div>`;
      item.querySelector('h3').textContent = quiz.title;
      item.querySelector('.count').textContent = countLabel(quiz);
      const badges = item.querySelector('.badges');
      if (quiz.mode === 'mental') {
        badges.appendChild(Object.assign(document.createElement('span'), { className: 'mental-badge', textContent: '🧮 Kopfrechnen' }));
      }
      if (quiz.subject) {
        const b = document.createElement('span');
        b.className = 'subject-badge';
        b.textContent = quiz.subject;
        badges.appendChild(b);
      }
      if (quiz.shared) {
        const b = document.createElement('span');
        b.className = 'shared-badge';
        b.textContent = '📚 freigegeben';
        badges.appendChild(b);
        badges.append(' ');
      }
      item.querySelector('[data-act="host"]').addEventListener('click', () => {
        window.open(`/host.html?quiz=${quiz.id}`, '_blank');
      });
      item.querySelector('[data-act="edit"]').addEventListener('click', () => (quiz.mode === 'mental' ? openMentalEditor(quiz.id) : openEditor(quiz.id)));
      item.querySelector('[data-act="export"]').addEventListener('click', () => downloadExport(`/api/quizzes/${quiz.id}/export`));
      item.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!confirm(`Quiz „${quiz.title}“ wirklich löschen?`)) return;
        await api(`/api/quizzes/${quiz.id}`, { method: 'DELETE' });
        loadQuizzes();
      });
      list.appendChild(item);
    }
  }

  // ---------------- Import / Export ----------------
  function downloadExport(url) {
    // Der Server schickt Content-Disposition: attachment – ein Link genügt
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function showImportResult(kind, headline, items = []) {
    const box = $('import-result');
    box.className = `import-result ${kind}`;
    box.innerHTML = '';
    box.append(headline);
    if (items.length) {
      const ul = document.createElement('ul');
      for (const it of items) ul.appendChild(Object.assign(document.createElement('li'), { textContent: it }));
      box.appendChild(ul);
    }
    box.style.display = '';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('btn-export-all').addEventListener('click', () => downloadExport('/api/quizzes/export'));
  $('btn-import').addEventListener('click', () => $('import-input').click());
  $('import-input').addEventListener('change', async () => {
    const files = [...$('import-input').files];
    $('import-input').value = '';
    if (!files.length) return;
    const imported = [];
    const notes = [];
    for (const file of files) {
      let body;
      try {
        body = JSON.parse(await file.text());
      } catch {
        notes.push(`${file.name}: keine gültige JSON-Datei.`);
        continue;
      }
      try {
        const data = await api('/api/quizzes/import', { method: 'POST', body });
        for (const q of data.imported) {
          const unit = q.mode === 'mental' ? (q.questionCount === 1 ? 'Aufgabe' : 'Aufgaben') : (q.questionCount === 1 ? 'Frage' : 'Fragen');
          imported.push(`${q.title} (${q.questionCount} ${unit})`);
        }
        for (const w of data.warnings) notes.push(`${file.name}: ${w}`);
      } catch (err) {
        notes.push(`${file.name}: ${err.message}`);
      }
    }
    const n = imported.length;
    if (!n) showImportResult('error', 'Import fehlgeschlagen.', notes);
    else showImportResult(notes.length ? 'warn' : '', `${n} Quiz${n === 1 ? '' : 'ze'} importiert: ${imported.join(', ')}`, notes);
    loadQuizzes();
  });

  $('copy-format').addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const text = await (await fetch('/import-format.md')).text();
      await navigator.clipboard.writeText(text);
      e.target.textContent = '✔ kopiert';
      setTimeout(() => { e.target.textContent = 'in Zwischenablage kopieren'; }, 2000);
    } catch {
      window.open('/import-format.md', '_blank');
    }
  });

  // ---------------- Medien-Auswahl (Upload + Bildarchiv) ----------------
  let mediaCallback = null;
  let mediaAllowAV = false;
  let galleryPage = 1;
  let galleryQuery = '';

  function openMediaPicker({ allowAV = false, title = 'Medien auswählen' }, cb) {
    mediaCallback = cb;
    mediaAllowAV = allowAV;
    $('media-title').textContent = title;
    $('media-upload-hint').textContent = allowAV
      ? 'Bild, Audio (mp3/ogg/wav) oder Video (mp4/webm), max. 25 MB'
      : 'Bild (png/jpg/webp/gif), max. 25 MB';
    $('file-input').accept = allowAV ? 'image/*,audio/*,video/*' : 'image/*';
    $('media-overlay').style.display = '';
    galleryPage = 1;
    galleryQuery = '';
    $('gallery-q').value = '';
    loadGallery();
  }

  function closeMediaPicker() {
    $('media-overlay').style.display = 'none';
    mediaCallback = null;
  }
  $('media-close').addEventListener('click', closeMediaPicker);
  $('media-overlay').addEventListener('click', (e) => { if (e.target === $('media-overlay')) closeMediaPicker(); });

  $('media-upload-btn').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async () => {
    const file = $('file-input').files[0];
    $('file-input').value = '';
    if (!file || !mediaCallback) return;
    $('gallery-status').textContent = 'Lade hoch …';
    try {
      const res = await fetch(`/api/media?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen.');
      const cb = mediaCallback;
      closeMediaPicker();
      cb(data); // { url, kind }
    } catch (e) {
      $('gallery-status').textContent = e.message;
    }
  });

  async function loadGallery() {
    const grid = $('gallery-grid');
    grid.innerHTML = '';
    $('gallery-status').textContent = 'Bildarchiv wird geladen …';
    try {
      const data = await api(`/api/gallery?q=${encodeURIComponent(galleryQuery)}&page=${galleryPage}`);
      $('gallery-status').textContent = data.items.length
        ? `Seite ${data.page} · Klick auf ein Bild übernimmt es`
        : 'Nichts gefunden – anderes Suchwort probieren?';
      $('gallery-prev').disabled = galleryPage <= 1;
      $('gallery-next').disabled = !data.hasMore;
      for (const item of data.items) {
        const btn = document.createElement('button');
        btn.title = item.title;
        const img = document.createElement('img');
        img.src = item.thumb;
        img.loading = 'lazy';
        img.alt = item.title;
        btn.appendChild(img);
        btn.addEventListener('click', async () => {
          $('gallery-status').textContent = 'Bild wird importiert …';
          try {
            const imported = await api('/api/gallery/import', { method: 'POST', body: { file: item.file } });
            const cb = mediaCallback;
            closeMediaPicker();
            cb(imported);
          } catch (e) {
            $('gallery-status').textContent = e.message;
          }
        });
        grid.appendChild(btn);
      }
    } catch (e) {
      $('gallery-status').textContent = e.message;
    }
  }

  $('gallery-go').addEventListener('click', () => { galleryQuery = $('gallery-q').value.trim(); galleryPage = 1; loadGallery(); });
  $('gallery-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('gallery-go').click(); });
  $('gallery-prev').addEventListener('click', () => { if (galleryPage > 1) { galleryPage--; loadGallery(); } });
  $('gallery-next').addEventListener('click', () => { galleryPage++; loadGallery(); });

  // ---------------- Editor ----------------
  function blankQuestion(type) {
    const q = { type, text: '', media: null, time: 20, points: OPINION.includes(type) ? 'none' : 'normal' };
    switch (type) {
      case 'choice': Object.assign(q, { answers: emptyAnswers(4), correct: 0 }); break;
      case 'poll': Object.assign(q, { answers: emptyAnswers(4) }); break;
      case 'truefalse': q.correct = 0; break;
      case 'freetext': q.acceptedText = ''; break;
      case 'slider': Object.assign(q, { min: 0, max: 100, step: 1, correct: 50, tolerance: 5 }); break;
      case 'order': q.answers = [{ text: '' }, { text: '' }, { text: '' }]; break;
      case 'scale': Object.assign(q, { min: 1, max: 5, minLabel: 'stimme gar nicht zu', maxLabel: 'stimme voll zu' }); break;
    }
    return q;
  }
  const emptyAnswers = (n) => Array.from({ length: n }, () => ({ text: '', media: null }));

  // Gespeicherte Frage → Editor-Arbeitskopie
  function toEditable(q) {
    const copy = JSON.parse(JSON.stringify(q));
    copy.type = copy.type || 'choice';
    if (['choice', 'poll'].includes(copy.type)) {
      copy.answers = (copy.answers || []).map((a) => (typeof a === 'string' ? { text: a, media: null } : { text: a.text || '', media: a.media || null }));
      while (copy.answers.length < 4) copy.answers.push({ text: '', media: null });
    }
    if (copy.type === 'order') {
      copy.answers = (copy.answers || []).map((a) => ({ text: typeof a === 'string' ? a : a.text || '' }));
    }
    if (copy.type === 'freetext') copy.acceptedText = (copy.accepted || []).join(', ');
    return copy;
  }

  // Editor-Arbeitskopie → Speicherformat
  function cleanForSave(q) {
    const out = { type: q.type, text: (q.text || '').trim(), media: q.media, time: q.time, points: q.points };
    switch (q.type) {
      case 'choice':
      case 'poll': {
        const kept = [];
        let correct = -1;
        q.answers.forEach((a, ai) => {
          if ((a.text || '').trim() || a.media) {
            if (ai === q.correct) correct = kept.length;
            kept.push({ text: (a.text || '').trim(), media: a.media });
          }
        });
        out.answers = kept;
        if (q.type === 'choice') out.correct = correct;
        break;
      }
      case 'truefalse': out.correct = q.correct; break;
      case 'freetext': out.accepted = (q.acceptedText || '').split(',').map((s) => s.trim()).filter(Boolean); break;
      case 'slider': Object.assign(out, { min: +q.min, max: +q.max, step: +q.step || 1, correct: +q.correct, tolerance: +q.tolerance || 0 }); break;
      case 'order': out.answers = q.answers.filter((a) => (a.text || '').trim()).map((a) => ({ text: a.text.trim() })); break;
      case 'scale': Object.assign(out, { min: 1, max: +q.max || 5, minLabel: q.minLabel || '', maxLabel: q.maxLabel || '' }); break;
    }
    return out;
  }

  $('btn-new-quiz').addEventListener('click', () => {
    editingQuizId = null;
    $('quiz-title').value = '';
    $('quiz-subject').value = '';
    $('quiz-shared').checked = false;
    questions = [];
    renderQuestions();
    $('type-picker-card').style.display = '';
    show('screen-editor');
  });

  async function openEditor(id) {
    const { quiz } = await api(`/api/quizzes/${id}`);
    editingQuizId = id;
    $('quiz-title').value = quiz.title;
    // Fach ggf. nachtragen, falls es nicht (mehr) in der Fächerliste steht
    if (quiz.subject && ![...$('quiz-subject').options].some((o) => o.value === quiz.subject)) {
      $('quiz-subject').appendChild(new Option(quiz.subject, quiz.subject));
    }
    $('quiz-subject').value = quiz.subject || '';
    $('quiz-shared').checked = quiz.shared;
    questions = quiz.questions.map(toEditable);
    renderQuestions();
    $('type-picker-card').style.display = 'none';
    show('screen-editor');
  }

  $('btn-back-dashboard').addEventListener('click', () => show('screen-dashboard'));

  // Fragetyp-Auswahl
  const picker = $('type-picker');
  for (const [type, info] of Object.entries(TYPES)) {
    const btn = document.createElement('button');
    btn.className = 'type-pick-btn';
    btn.innerHTML = `<span class="icon">${info.icon}</span>${info.label}<span class="sub">${info.sub}</span>`;
    btn.addEventListener('click', () => {
      questions.push(blankQuestion(type));
      $('type-picker-card').style.display = 'none';
      renderQuestions();
      const card = document.querySelector('#question-list .question-card:last-child');
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.querySelector('input')?.focus();
    });
    picker.appendChild(btn);
  }

  $('btn-add-question').addEventListener('click', () => {
    const card = $('type-picker-card');
    card.style.display = card.style.display === 'none' ? '' : 'none';
    if (card.style.display === '') card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // --- Medien-Slot (Frage oder Antwort) -----------------------------------
  function mediaSlot(getMedia, setMedia, { allowAV }) {
    const wrap = document.createElement('div');
    wrap.className = 'media-slot';

    function redraw() {
      wrap.innerHTML = '';
      const media = getMedia();
      if (media) {
        if (media.kind === 'image') {
          const img = document.createElement('img');
          img.src = media.url;
          wrap.appendChild(img);
        } else {
          const chip = document.createElement('span');
          chip.className = 'file-chip';
          chip.textContent = media.kind === 'audio' ? '🎵 Audio-Datei' : '🎬 Video-Datei';
          wrap.appendChild(chip);
        }
        const del = document.createElement('button');
        del.className = 'btn tiny danger';
        del.textContent = '✕ entfernen';
        del.addEventListener('click', () => { setMedia(null); redraw(); });
        wrap.appendChild(del);
      } else {
        const add = document.createElement('button');
        add.className = 'btn tiny';
        add.textContent = allowAV ? '🖼️ Bild / 🎵 Audio / 🎬 Video hinzufügen' : '🖼️ Bild';
        add.addEventListener('click', () => {
          openMediaPicker({ allowAV, title: allowAV ? 'Medien für die Frage' : 'Bild für die Antwort' }, (media) => {
            setMedia(media);
            redraw();
          });
        });
        wrap.appendChild(add);
      }
    }
    redraw();
    return wrap;
  }

  // --- Typspezifische Editor-Bereiche --------------------------------------
  function buildTypeBody(card, q, qi) {
    const body = document.createElement('div');

    if (q.type === 'choice' || q.type === 'poll') {
      const label = document.createElement('label');
      label.textContent = q.type === 'choice'
        ? 'Antworten (richtige ankreuzen, mind. 2 ausfüllen – Text oder Bild)'
        : 'Antwortmöglichkeiten (mind. 2 – Text oder Bild)';
      body.appendChild(label);
      const grid = document.createElement('div');
      grid.className = 'answer-edit-grid';
      q.answers.forEach((answer, ai) => {
        const row = document.createElement('div');
        row.className = `answer-edit c${ai}`;
        row.innerHTML = `<span class="shape">${SHAPES[ai]}</span>`;
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 90;
        input.placeholder = `Antwort ${ai + 1}${ai >= 2 ? ' (optional)' : ''}`;
        input.value = answer.text || '';
        input.addEventListener('input', () => { answer.text = input.value; });
        row.appendChild(input);
        if (answer.media) {
          const img = document.createElement('img');
          img.className = 'ans-media-preview';
          img.src = answer.media.url;
          row.appendChild(img);
        }
        const mediaBtn = document.createElement('button');
        mediaBtn.className = 'btn tiny';
        mediaBtn.textContent = answer.media ? '✕' : '🖼️';
        mediaBtn.title = answer.media ? 'Bild entfernen' : 'Bild zur Antwort';
        mediaBtn.addEventListener('click', () => {
          if (answer.media) { answer.media = null; renderQuestions(); }
          else openMediaPicker({ allowAV: false, title: 'Bild für die Antwort' }, (media) => { answer.media = media; renderQuestions(); });
        });
        row.appendChild(mediaBtn);
        if (q.type === 'choice') {
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `correct-${qi}`;
          radio.checked = ai === q.correct;
          radio.title = 'richtige Antwort';
          radio.addEventListener('change', () => { q.correct = ai; });
          row.appendChild(radio);
        }
        grid.appendChild(row);
      });
      body.appendChild(grid);
    }

    if (q.type === 'truefalse') {
      const label = document.createElement('label');
      label.textContent = 'Was ist richtig?';
      body.appendChild(label);
      const grid = document.createElement('div');
      grid.className = 'answer-edit-grid';
      [['✔ Wahr', 'c1'], ['✖ Falsch', 'c0']].forEach(([text, cls], i) => {
        const row = document.createElement('div');
        row.className = `answer-edit ${cls}`;
        row.style.cursor = 'pointer';
        const span = document.createElement('span');
        span.style.cssText = 'flex:1; font-weight:800; font-size:1.1rem;';
        span.textContent = text;
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `tf-${qi}`;
        radio.checked = q.correct === i;
        radio.addEventListener('change', () => { q.correct = i; });
        row.append(span, radio);
        row.addEventListener('click', (e) => { if (e.target !== radio) { radio.checked = true; q.correct = i; } });
        grid.appendChild(row);
      });
      body.appendChild(grid);
    }

    if (q.type === 'freetext') {
      const label = document.createElement('label');
      label.textContent = 'Richtige Antworten (mehrere mit Komma trennen, Groß-/Kleinschreibung egal)';
      body.appendChild(label);
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'z. B. Paris, Paris (Frankreich)';
      input.value = q.acceptedText || '';
      input.addEventListener('input', () => { q.acceptedText = input.value; });
      body.appendChild(input);
    }

    if (q.type === 'slider') {
      const row = document.createElement('div');
      row.className = 'q-settings';
      const fields = [
        ['min', 'Von'], ['max', 'Bis'], ['step', 'Schritt'],
        ['correct', 'Richtige Zahl'], ['tolerance', 'Toleranz (± volle Punkte)'],
      ];
      for (const [key, label] of fields) {
        const box = document.createElement('div');
        const lab = document.createElement('label');
        lab.textContent = label;
        const input = document.createElement('input');
        input.type = 'number';
        input.value = q[key];
        input.addEventListener('input', () => { q[key] = input.value === '' ? '' : Number(input.value); });
        box.append(lab, input);
        row.appendChild(box);
      }
      body.appendChild(row);
    }

    if (q.type === 'order') {
      const label = document.createElement('label');
      label.textContent = 'Schritte in der RICHTIGEN Reihenfolge eintragen (im Spiel wird gemischt)';
      body.appendChild(label);
      q.answers.forEach((answer, ai) => {
        const row = document.createElement('div');
        row.className = 'order-edit-row';
        const pos = document.createElement('span');
        pos.className = 'pos';
        pos.textContent = `${ai + 1}.`;
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 90;
        input.placeholder = `Schritt ${ai + 1}`;
        input.value = answer.text || '';
        input.addEventListener('input', () => { answer.text = input.value; });
        row.append(pos, input);
        if (q.answers.length > 2) {
          const del = document.createElement('button');
          del.className = 'btn tiny danger';
          del.textContent = '✕';
          del.addEventListener('click', () => { q.answers.splice(ai, 1); renderQuestions(); });
          row.appendChild(del);
        }
        body.appendChild(row);
      });
      if (q.answers.length < 6) {
        const add = document.createElement('button');
        add.className = 'btn tiny';
        add.textContent = '+ Schritt';
        add.addEventListener('click', () => { q.answers.push({ text: '' }); renderQuestions(); });
        body.appendChild(add);
      }
    }

    if (q.type === 'scale') {
      const row = document.createElement('div');
      row.className = 'q-settings';
      const maxBox = document.createElement('div');
      maxBox.innerHTML = '<label>Skala bis</label>';
      const maxSel = document.createElement('select');
      for (let v = 3; v <= 10; v++) maxSel.appendChild(new Option(`1 bis ${v}`, v));
      maxSel.value = q.max || 5;
      maxSel.addEventListener('change', () => { q.max = +maxSel.value; });
      maxBox.appendChild(maxSel);
      const minLab = document.createElement('div');
      minLab.innerHTML = '<label>Beschriftung links (1)</label>';
      const minInput = document.createElement('input');
      minInput.type = 'text'; minInput.maxLength = 40; minInput.value = q.minLabel || '';
      minInput.addEventListener('input', () => { q.minLabel = minInput.value; });
      minLab.appendChild(minInput);
      const maxLab = document.createElement('div');
      maxLab.innerHTML = '<label>Beschriftung rechts</label>';
      const maxInput = document.createElement('input');
      maxInput.type = 'text'; maxInput.maxLength = 40; maxInput.value = q.maxLabel || '';
      maxInput.addEventListener('input', () => { q.maxLabel = maxInput.value; });
      maxLab.appendChild(maxInput);
      row.append(maxBox, minLab, maxLab);
      body.appendChild(row);
    }

    if (q.type === 'wordcloud') {
      const note = document.createElement('p');
      note.className = 'muted-note';
      note.textContent = '☁️ Jede Person schickt einen Begriff – daraus entsteht live eine Wortwolke auf dem Beamer.';
      body.appendChild(note);
    }
    if (q.type === 'brainstorm') {
      const note = document.createElement('p');
      note.className = 'muted-note';
      note.textContent = '💡 Jede Person kann bis zu 3 Ideen einwerfen – sie erscheinen live auf dem Beamer. Beende die Runde mit „Frage beenden“.';
      body.appendChild(note);
    }

    card.appendChild(body);
  }

  function renderQuestions() {
    const list = $('question-list');
    list.innerHTML = '';
    questions.forEach((q, qi) => {
      const info = TYPES[q.type] || TYPES.choice;
      const card = document.createElement('div');
      card.className = 'editor-card question-card';

      const num = document.createElement('div');
      num.className = 'q-num';
      num.textContent = `Frage ${qi + 1}`;
      const typeChip = document.createElement('div');
      typeChip.className = 'q-type-chip';
      typeChip.textContent = `${info.icon} ${info.label}`;
      card.append(num, typeChip);

      const textLabel = document.createElement('label');
      textLabel.textContent = 'Fragetext';
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.maxLength = 200;
      textInput.placeholder = 'Wie lautet die Frage?';
      textInput.value = q.text;
      textInput.addEventListener('input', () => { q.text = textInput.value; });
      card.append(textLabel, textInput);

      const mediaLabel = document.createElement('label');
      mediaLabel.textContent = 'Medien zur Frage (optional, erscheint auf dem Beamer)';
      card.appendChild(mediaLabel);
      card.appendChild(mediaSlot(() => q.media, (m) => { q.media = m; }, { allowAV: true }));

      buildTypeBody(card, q, qi);

      // Zeit + Punkte
      const settings = document.createElement('div');
      settings.className = 'q-settings';
      const timeBox = document.createElement('div');
      timeBox.innerHTML = '<label>Zeitlimit</label>';
      const timeSel = document.createElement('select');
      for (const t of [5, 10, 20, 30, 60, 90, 120]) timeSel.appendChild(new Option(`${t} Sekunden`, t));
      timeSel.value = q.time;
      timeSel.addEventListener('change', () => { q.time = +timeSel.value; });
      timeBox.appendChild(timeSel);
      settings.appendChild(timeBox);

      if (!OPINION.includes(q.type)) {
        const pointsBox = document.createElement('div');
        pointsBox.innerHTML = '<label>Punkte</label>';
        const pointsSel = document.createElement('select');
        pointsSel.append(new Option('Normal (bis 1000)', 'normal'), new Option('Doppelt (bis 2000)', 'double'), new Option('Keine Punkte', 'none'));
        pointsSel.value = q.points;
        pointsSel.addEventListener('change', () => { q.points = pointsSel.value; });
        pointsBox.appendChild(pointsSel);
        settings.appendChild(pointsBox);
      }
      card.appendChild(settings);

      // Werkzeugleiste
      const toolbar = document.createElement('div');
      toolbar.className = 'q-toolbar';
      const mkBtn = (cls, text, title, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', fn);
        return b;
      };
      toolbar.append(
        mkBtn('btn ghost small', '↑', 'nach oben', () => { if (qi > 0) { [questions[qi - 1], questions[qi]] = [questions[qi], questions[qi - 1]]; renderQuestions(); } }),
        mkBtn('btn ghost small', '↓', 'nach unten', () => { if (qi < questions.length - 1) { [questions[qi + 1], questions[qi]] = [questions[qi], questions[qi + 1]]; renderQuestions(); } }),
        mkBtn('btn small', 'Duplizieren', '', () => { questions.splice(qi + 1, 0, JSON.parse(JSON.stringify(q))); renderQuestions(); }),
        mkBtn('btn small danger', 'Löschen', '', () => { questions.splice(qi, 1); renderQuestions(); }),
      );
      toolbar.querySelectorAll('.btn.ghost').forEach((b) => { b.style.color = 'var(--ink)'; b.style.borderColor = '#d8d2e8'; });
      card.appendChild(toolbar);

      list.appendChild(card);
    });
  }

  $('btn-save-quiz').addEventListener('click', async () => {
    const cleaned = questions.map(cleanForSave);
    for (const [i, q] of cleaned.entries()) {
      if (q.type === 'choice' && q.correct === -1 && q.answers.length >= 2) {
        return flashError('editor-error', `Frage ${i + 1}: Die als richtig markierte Antwort ist leer.`);
      }
    }
    if (!cleaned.length) return flashError('editor-error', 'Füge mindestens eine Frage hinzu.');

    try {
      const body = {
        title: $('quiz-title').value,
        subject: $('quiz-subject').value,
        shared: $('quiz-shared').checked,
        questions: cleaned,
      };
      if (editingQuizId) await api(`/api/quizzes/${editingQuizId}`, { method: 'PUT', body });
      else await api('/api/quizzes', { method: 'POST', body });
      show('screen-dashboard');
      loadQuizzes();
    } catch (e) {
      flashError('editor-error', e.message);
    }
  });

  // ---------------- Kopfrechenrunde ----------------
  const MENTAL_SYMBOLS = { add: '+', sub: '−', mul: '·', div: ':' };
  let editingMentalId = null;
  let previewTimer = null;

  function setSubject(sel, subject) {
    if (subject && ![...sel.options].some((o) => o.value === subject)) sel.appendChild(new Option(subject, subject));
    sel.value = subject || '';
  }

  function readMentalConfig() {
    const range = document.querySelector('#mental-range .chip-toggle.on');
    return {
      count: Number($('mental-count').value),
      range: range ? Number(range.dataset.value) : 20,
      ops: [...document.querySelectorAll('#mental-ops .chip-toggle.on')].map((b) => b.dataset.value),
      time: Number($('mental-time').value),
    };
  }

  function fillMentalForm(cfg) {
    $('mental-count').value = cfg.count;
    $('mental-count-value').textContent = cfg.count;
    document.querySelectorAll('#mental-range .chip-toggle').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) === cfg.range));
    document.querySelectorAll('#mental-ops .chip-toggle').forEach((b) => b.classList.toggle('on', cfg.ops.includes(b.dataset.value)));
    $('mental-time').value = String(cfg.time);
  }

  async function refreshMentalPreview() {
    const box = $('mental-examples');
    const cfg = readMentalConfig();
    if (!cfg.ops.length) {
      box.innerHTML = '';
      box.appendChild(Object.assign(document.createElement('p'), { className: 'muted-note', textContent: 'Bitte mindestens eine Rechenart wählen.' }));
      return;
    }
    try {
      const { examples } = await api('/api/mental/preview', { method: 'POST', body: cfg });
      box.innerHTML = '';
      for (const ex of examples) box.appendChild(Object.assign(document.createElement('span'), { textContent: ex }));
    } catch (e) {
      box.textContent = e.message;
    }
  }
  const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(refreshMentalPreview, 150); };

  function autoMentalTitle(cfg) {
    return `Kopfrechnen bis ${cfg.range} (${cfg.ops.map((o) => MENTAL_SYMBOLS[o]).join(' ')})`;
  }

  function showMentalEditor() {
    $('mental-error').classList.remove('show');
    show('screen-mental-editor');
    refreshMentalPreview();
    window.scrollTo({ top: 0 });
  }

  $('btn-new-mental').addEventListener('click', () => {
    editingMentalId = null;
    $('mental-title').value = '';
    setSubject($('mental-subject'), subjects.includes('Mathematik') ? 'Mathematik' : '');
    $('mental-shared').checked = false;
    fillMentalForm({ count: 10, range: 20, ops: ['add', 'sub'], time: 20 });
    showMentalEditor();
  });

  async function openMentalEditor(id) {
    const { quiz } = await api(`/api/quizzes/${id}`);
    editingMentalId = id;
    $('mental-title').value = quiz.title;
    setSubject($('mental-subject'), quiz.subject);
    $('mental-shared').checked = quiz.shared;
    fillMentalForm(quiz.mental);
    showMentalEditor();
  }

  $('mental-count').addEventListener('input', () => { $('mental-count-value').textContent = $('mental-count').value; });
  $('mental-range').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-toggle');
    if (!btn) return;
    document.querySelectorAll('#mental-range .chip-toggle').forEach((b) => b.classList.toggle('on', b === btn));
    schedulePreview();
  });
  $('mental-ops').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-toggle');
    if (!btn) return;
    btn.classList.toggle('on');
    schedulePreview();
  });
  $('mental-reroll').addEventListener('click', refreshMentalPreview);
  $('btn-mental-back').addEventListener('click', () => show('screen-dashboard'));

  $('btn-save-mental').addEventListener('click', async () => {
    const cfg = readMentalConfig();
    if (!cfg.ops.length) return flashError('mental-error', 'Bitte mindestens eine Rechenart auswählen.');
    const body = {
      mode: 'mental',
      title: $('mental-title').value.trim() || autoMentalTitle(cfg),
      subject: $('mental-subject').value,
      shared: $('mental-shared').checked,
      mental: cfg,
    };
    try {
      if (editingMentalId) await api(`/api/quizzes/${editingMentalId}`, { method: 'PUT', body });
      else await api('/api/quizzes', { method: 'POST', body });
      show('screen-dashboard');
      loadQuizzes();
    } catch (e) {
      flashError('mental-error', e.message);
    }
  });

  // ---------------- Start: eingeloggt? ----------------
  (async () => {
    const { user } = await api('/api/me');
    if (user) enterDashboard(user);
    else show('screen-auth');
  })();
})();
