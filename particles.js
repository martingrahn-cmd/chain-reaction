/* Chain Reaction — particle system.
 * Lightweight bursts emitted on merges and milestones. Pure canvas, no deps.
 */
(function (CR) {
  "use strict";

  function ParticleSystem() {
    this.particles = [];
    this.intensity = 1; // scaled down under prefers-reduced-motion
    this.max = 340;     // hard cap on live particles (lowered on low-end)
  }

  // Emit `count` particles outward from (x, y) in `color`.
  ParticleSystem.prototype.burst = function (x, y, color, count, power) {
    count = Math.max(1, Math.round((count || 14) * this.intensity));
    power = power || 1;
    // Never exceed the budget — the biggest moments must not drop frames.
    count = Math.min(count, this.max);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (60 + Math.random() * 180) * power;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.4,
        size: (2 + Math.random() * 3) * power,
        color: color,
      });
    }
    // Trim oldest if a flurry pushed us over budget.
    if (this.particles.length > this.max) {
      this.particles.splice(0, this.particles.length - this.max);
    }
  };

  // Big radial firework for milestones.
  ParticleSystem.prototype.firework = function (x, y, color) {
    this.burst(x, y, color, 60, 2.2);
    this.burst(x, y, "#ffffff", 24, 1.6);
  };

  ParticleSystem.prototype.clear = function () {
    this.particles.length = 0;
  };

  ParticleSystem.prototype.update = function (dt) {
    const drag = 0.92;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.vy += 120 * dt; // slight gravity
    }
  };

  ParticleSystem.prototype.draw = function (ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const t = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * t), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  CR.ParticleSystem = ParticleSystem;
})((window.CR = window.CR || {}));
