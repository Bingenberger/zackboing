/* Mini-Konfetti auf <canvas id="confetti"> – ohne externe Bibliothek. */
const Confetti = (() => {
  const canvas = document.getElementById('confetti');
  if (!canvas) return { burst() {}, rain() {}, stop() {} };
  const ctx = canvas.getContext('2d');
  const COLORS = ['#ffd23e', '#ff2ea6', '#2ec9ff', '#26e07f', '#ff7a00', '#b06bff'];
  let parts = [];
  let running = false;
  let rainUntil = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function spawn(n, fromTop) {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * canvas.width,
        y: fromTop ? -20 : canvas.height * (0.25 + Math.random() * 0.2),
        vx: (Math.random() - 0.5) * (fromTop ? 3 : 14),
        vy: fromTop ? 1 + Math.random() * 3 : -(6 + Math.random() * 9),
        w: 6 + Math.random() * 7,
        h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (Date.now() < rainUntil) spawn(4, true);
    parts = parts.filter((p) => p.y < canvas.height + 30);
    for (const p of parts) {
      p.vy += 0.22;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (parts.length || Date.now() < rainUntil) requestAnimationFrame(tick);
    else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  return {
    burst(n = 120) { spawn(n, false); },
    rain(seconds = 5) { rainUntil = Date.now() + seconds * 1000; if (!running) { running = true; requestAnimationFrame(tick); } },
    stop() { rainUntil = 0; },
  };
})();
