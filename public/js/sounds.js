/* Zackboing Sound-Engine
 * Alle Musik und Soundeffekte werden live mit der WebAudio-API synthetisiert –
 * keine Audiodateien nötig, funktioniert komplett offline im Schulnetz.
 * Browser erlauben Audio erst nach einer Nutzeraktion, deshalb wird der
 * AudioContext lazy beim ersten Klick erzeugt.
 */
const Sound = (() => {
  let ctx = null;
  let master, musicGain, sfxGain;
  let muted = localStorage.getItem('zackboing_muted') === '1';
  let loop = null; // laufende Musikschleife { timer, name }

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.5;
      musicGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.9;
      sfxGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // Einzelner Ton mit Hüllkurve (optional mit Tonhöhen-Glide)
  function tone({ f, t = 0, d = 0.15, type = 'square', v = 0.2, music = false, slide = null }) {
    ensure();
    const start = ctx.currentTime + t;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, start);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, start + d);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(v, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + d);
    osc.connect(g).connect(music ? musicGain : sfxGain);
    osc.start(start);
    osc.stop(start + d + 0.05);
  }

  // Rauschimpuls für Hi-Hats / Snare / Drumroll
  function noiseHit({ t = 0, d = 0.06, v = 0.12, music = false, hp = 6000 }) {
    ensure();
    const start = ctx.currentTime + t;
    const len = Math.max(1, Math.floor(ctx.sampleRate * d));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.value = v;
    src.connect(filter).connect(g).connect(music ? musicGain : sfxGain);
    src.start(start);
  }

  /* ---------------- Musikschleifen (16tel-Sequencer) ----------------
   * Pattern: { bpm, steps, bass[], lead[], hat[] } – MIDI-Nummern oder null.
   */
  const PATTERNS = {
    // Fröhliche Lobby-Musik: hüpfender Bass + Dur-Melodie
    lobby: {
      bpm: 116, steps: 32,
      bass: [45,null,45,null,52,null,45,null, 50,null,50,null,57,null,50,null,
             43,null,43,null,50,null,43,null, 45,null,47,null,48,null,50,null],
      lead: [69,null,72,null,76,null,72,null, 74,null,77,null,74,null,69,null,
             67,null,71,null,74,null,71,null, 69,null,72,76,79,null,76,72],
      hat:  [1,0,1,0,1,0,1,1, 1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,1, 1,0,1,0,1,1,1,1],
      bassType: 'triangle', leadType: 'square', leadV: 0.07, bassV: 0.16,
    },
    // Spannungs-Loop während einer Frage: treibender Moll-Puls
    question: {
      bpm: 132, steps: 16,
      bass: [40,null,40,40,null,40,null,43, 40,null,40,40,null,38,null,46],
      lead: [null,64,null,null,67,null,64,null, null,63,null,null,67,null,70,67],
      hat:  [1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,1],
      bassType: 'sawtooth', leadType: 'triangle', leadV: 0.06, bassV: 0.13,
    },
    // Ruhiger Ergebnis-Teppich
    results: {
      bpm: 92, steps: 16,
      bass: [45,null,null,null,50,null,null,null, 43,null,null,null,48,null,null,null],
      lead: [69,null,72,null,74,null,null,null, 71,null,74,null,76,null,null,null],
      hat:  [0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0],
      bassType: 'sine', leadType: 'sine', leadV: 0.06, bassV: 0.14,
    },
  };

  function startMusic(name) {
    if (loop && loop.name === name) return;
    stopMusic();
    const p = PATTERNS[name];
    if (!p) return;
    ensure();
    const stepDur = 60 / p.bpm / 4; // 16tel
    let step = 0;
    let nextTime = ctx.currentTime + 0.06;

    const timer = setInterval(() => {
      // ~200 ms Vorausplanung, robust gegen Timer-Jitter
      while (nextTime < ctx.currentTime + 0.2) {
        const i = step % p.steps;
        const t = nextTime - ctx.currentTime;
        if (p.bass[i] != null) tone({ f: midi(p.bass[i]), t, d: stepDur * 1.7, type: p.bassType, v: p.bassV, music: true });
        if (p.lead[i] != null) tone({ f: midi(p.lead[i]), t, d: stepDur * 1.4, type: p.leadType, v: p.leadV, music: true });
        if (p.hat[i]) noiseHit({ t, d: 0.04, v: 0.05, music: true });
        nextTime += stepDur;
        step++;
      }
    }, 90);
    loop = { timer, name };
  }

  function stopMusic() {
    if (loop) { clearInterval(loop.timer); loop = null; }
  }

  /* ---------------- Soundeffekte ---------------- */
  const sfx = {
    // Spieler tritt der Lobby bei: kurzes "Plopp" nach oben
    join() { tone({ f: 520, d: 0.09, type: 'sine', v: 0.25, slide: 880 }); },
    click() { tone({ f: 700, d: 0.05, type: 'square', v: 0.12 }); },
    // Countdown: 3 Piepser + hoher Startton
    countTick() { tone({ f: 660, d: 0.12, type: 'square', v: 0.22 }); },
    countGo() { tone({ f: 880, d: 0.35, type: 'square', v: 0.25 }); tone({ f: 1320, t: 0.02, d: 0.3, type: 'square', v: 0.12 }); },
    // Antwort abgeschickt
    submit() { tone({ f: 440, d: 0.07, type: 'sine', v: 0.2, slide: 660 }); noiseHit({ d: 0.03, v: 0.06 }); },
    // letzte Sekunden: Tick-Tack
    hurry() { tone({ f: 990, d: 0.05, type: 'square', v: 0.16 }); },
    // richtig: aufsteigendes Dur-Arpeggio
    correct() {
      [72, 76, 79, 84].forEach((n, i) => tone({ f: midi(n), t: i * 0.09, d: 0.22, type: 'square', v: 0.18 }));
      noiseHit({ t: 0.28, d: 0.15, v: 0.1, hp: 8000 });
    },
    // falsch: absteigender Brummton
    wrong() {
      tone({ f: 220, d: 0.4, type: 'sawtooth', v: 0.2, slide: 110 });
      tone({ f: 233, t: 0.03, d: 0.4, type: 'sawtooth', v: 0.14, slide: 117 });
    },
    // Zeit abgelaufen: Gong
    timeUp() { tone({ f: 392, d: 0.7, type: 'triangle', v: 0.3, slide: 196 }); },
    // Ergebnis-Einblendung
    reveal() { [67, 71, 74].forEach((n, i) => tone({ f: midi(n), t: i * 0.06, d: 0.18, type: 'triangle', v: 0.16 })); },
    streak() { [76, 79, 83, 88].forEach((n, i) => tone({ f: midi(n), t: i * 0.05, d: 0.12, type: 'square', v: 0.13 })); },
    drumroll(seconds = 1.6) {
      for (let t = 0; t < seconds; t += 0.045) noiseHit({ t, d: 0.035, v: 0.09, hp: 2500 });
    },
    // Sieger-Fanfare
    fanfare() {
      const seq = [[72, 0], [72, 0.14], [72, 0.28], [76, 0.42], [79, 0.7], [76, 0.9], [79, 1.05]];
      for (const [n, t] of seq) {
        tone({ f: midi(n), t, d: 0.3, type: 'square', v: 0.2 });
        tone({ f: midi(n - 12), t, d: 0.3, type: 'triangle', v: 0.16 });
      }
      noiseHit({ t: 1.05, d: 0.4, v: 0.14, hp: 7000 });
    },
  };

  function toggleMute() {
    muted = !muted;
    localStorage.setItem('zackboing_muted', muted ? '1' : '0');
    if (ctx) master.gain.value = muted ? 0 : 1;
    return muted;
  }

  // Sound-Schalter unten rechts einbauen
  function mountToggle() {
    const btn = document.createElement('button');
    btn.className = 'sound-toggle';
    btn.title = 'Ton an/aus';
    btn.textContent = muted ? '🔇' : '🔊';
    btn.addEventListener('click', () => { btn.textContent = toggleMute() ? '🔇' : '🔊'; });
    document.body.appendChild(btn);
  }

  return { ensure, startMusic, stopMusic, sfx, toggleMute, mountToggle, get muted() { return muted; } };
})();
