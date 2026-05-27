/* Chain Reaction — animated background grid with random light pulses.
 * A full-viewport canvas behind the app. The board canvas is opaque and sits
 * above this, so the grid + pulses only show in the surrounding space.
 * Self-initialises on load; respects prefers-reduced-motion (grid only).
 */
(function (CR) {
  "use strict";

  const GRID = 42;
  const COLORS = ["#21e6ff", "#ff2ea8", "#7c5cfc", "#06d6a0"];

  function Background(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.pulses = [];
    this.lastSpawn = 0;
    this.spawnEvery = 320;     // ms until next spawn (re-randomised each time)
    this.maxPulses = 16;
    this.reduced = false;
    try { this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

    this.resize();
    const self = this;
    window.addEventListener("resize", function () { self.resize(); });
    this.last = performance.now();
    requestAnimationFrame(function f(t) { self.frame(t); requestAnimationFrame(f); });
  }

  Background.prototype.resize = function () {
    const dpr = window.devicePixelRatio || 1;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cols = Math.ceil(this.w / GRID);
    this.rows = Math.ceil(this.h / GRID);
  };

  Background.prototype.spawn = function () {
    const color = COLORS[(Math.random() * COLORS.length) | 0];
    const speed = 220 + Math.random() * 280;     // px/s
    const len = 70 + Math.random() * 140;         // streak length
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (Math.random() < 0.5) {
      // vertical line
      const x = Math.round(Math.random() * this.cols) * GRID;
      this.pulses.push({ v: true, x: x, pos: dir > 0 ? -len : this.h + len, dir: dir, speed: speed, len: len, color: color });
    } else {
      const y = Math.round(Math.random() * this.rows) * GRID;
      this.pulses.push({ v: false, y: y, pos: dir > 0 ? -len : this.w + len, dir: dir, speed: speed, len: len, color: color });
    }
  };

  Background.prototype.frame = function (now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (!this.reduced && now - this.lastSpawn > this.spawnEvery && this.pulses.length < this.maxPulses) {
      this.lastSpawn = now;
      this.spawnEvery = 180 + Math.random() * 460; // fairly frequent, irregular
      this.spawn();
      if (Math.random() < 0.35) this.spawn(); // occasional burst of two
    }

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.pos += p.dir * p.speed * dt;
      const span = p.v ? this.h : this.w;
      if (p.pos < -p.len - 4 || p.pos > span + p.len + 4) this.pulses.splice(i, 1);
    }

    this.draw();
  };

  Background.prototype.draw = function () {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    // faint static grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(124, 92, 252, 0.06)";
    ctx.beginPath();
    for (let x = 0; x <= this.w; x += GRID) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, this.h); }
    for (let y = 0; y <= this.h; y += GRID) { ctx.moveTo(0, y + 0.5); ctx.lineTo(this.w, y + 0.5); }
    ctx.stroke();

    // glowing pulses travelling along their line
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 2;
    for (const p of this.pulses) {
      const tail = p.pos - p.dir * p.len;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      if (p.v) {
        const g = ctx.createLinearGradient(0, tail, 0, p.pos);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, p.color);
        ctx.strokeStyle = g;
        ctx.beginPath(); ctx.moveTo(p.x, tail); ctx.lineTo(p.x, p.pos); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(p.x, p.pos, 2.2, 0, Math.PI * 2); ctx.fill();
      } else {
        const g = ctx.createLinearGradient(tail, 0, p.pos, 0);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, p.color);
        ctx.strokeStyle = g;
        ctx.beginPath(); ctx.moveTo(tail, p.y); ctx.lineTo(p.pos, p.y); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(p.pos, p.y, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  };

  CR.Background = Background;

  // Self-init (script runs after #bg exists at the top of <body>).
  const el = document.getElementById("bg");
  if (el) new Background(el);
})((window.CR = window.CR || {}));
