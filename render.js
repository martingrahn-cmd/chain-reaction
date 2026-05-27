/* Chain Reaction — canvas rendering + animation.
 *
 * The renderer keeps its own map of sprites (id -> {value,row,col,born,anim})
 * that mirrors the game board at rest. play(plan) drives a state machine that
 * animates each cascade phase in turn (slide -> merge pop -> short pause),
 * then the final spawn, then fires onComplete.
 */
(function (CR) {
  "use strict";

  // Timing (ms) — see GDD §4.2.
  const SLIDE_MS = 170;         // player's own slide — stays responsive
  const CASCADE_SLIDE_MS = 120; // auto-cascade slides are snappier
  const SETTLE_MS = 170;        // merge pop + reading pause (player phase)
  const CASCADE_SETTLE_MS = 150;// hold between auto-cascade steps
  const SETTLE_SHIFT_MS = 60;   // shorter when a phase only shifted (no merge)
  const SPAWN_MS = 130;
  const COMBO_MS = 800;
  const MILESTONE_MS = 1600;
  const MILESTONE_FREEZE = 650; // GDD §4.4: freeze before slow-mo resume
  const FLASH_MS = 260;
  const MERGE_MS = 230;         // smacky merge impact frame
  const ANTICIPATE_MS = 95;     // telegraph before an auto-cascade
  const SPAWN_LOCATE_MS = 120;  // locator glow before a tile pops in
  const FREEZE_MS = 450;        // milestone gameplay freeze (GDD §4.4)
  const NUDGE_MS = 180;         // invalid-move board nudge
  const INVALID_MS = 320;       // red edge pulse on invalid move
  const RESOLVE_MS = 460;       // end-of-chain "combo resolved" payoff pulse
  const GAMEOVER_DIM_MS = 750;  // "system failure" dim before the modal
  const JACKPOT_COLOR = "#ffd23f";
  const DIRVEC = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

  const MILESTONE_VALUES = { 256: 1, 512: 1, 1024: 1, 2048: 1 };

  // Value -> neon colour ramp (GDD §4.1).
  const COLORS = {
    2: "#21e6ff", 4: "#2a7bff", 8: "#27e07a", 16: "#8de01f",
    32: "#f4e21f", 64: "#ff9b2a", 128: "#ff5a2a", 256: "#ff2ea8",
    512: "#a14bff", 1024: "#ff3fae", 2048: "#ffffff",
    // Endless / prestige tiers beyond the 2048 goal.
    4096: "#ffd23f", 8192: "#ff7b54", 16384: "#c46bff",
    32768: "#5cf2c0", 65536: "#7ad7ff",
  };
  function tileColor(value) {
    return COLORS[value] || "#ffffff";
  }
  CR.tileColor = tileColor;

  // --- easing ---
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Mobile haptics — no-op where unsupported (e.g. iOS Safari, desktop).
  function vibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
    }
  }

  // Later cascade steps run a little faster, so long chains build momentum.
  function cascadeAccel(index) {
    return Math.max(0.62, 1 - 0.12 * (index - 1)); // index is 1-based cascade depth
  }

  // Escalating praise word for a chain of the given length.
  function praiseWord(combo) {
    if (combo >= 6) return "UNSTOPPABLE!";
    if (combo === 5) return "INSANE!";
    if (combo === 4) return "BLAZING!";
    if (combo === 3) return "SWEET!";
    return "NICE!";
  }

  function Renderer(canvas, particles, audio, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = particles;
    this.audio = audio;
    this.cb = callbacks || {};

    this.sprites = new Map(); // id -> { value, row, col, born, anim }
    this.size = 0;            // logical (CSS) px, square
    this.cell = 0;
    this.pad = 0;
    this.gap = 0;

    // animation state
    this.mode = "idle";       // idle | sliding | settle | spawning | done
    this.plan = null;
    this.phaseIndex = 0;
    this.phaseStart = 0;
    this.slideMap = null;     // id -> {from,to} for current phase
    this.slideDur = SLIDE_MS; // per-phase slide duration
    this.settleDur = SETTLE_MS;
    this.anticDur = ANTICIPATE_MS;
    this._finished = true;
    this._fxGen = 0;          // bumped on reset to cancel stale scheduled fx

    // fx
    this.shake = 0;
    this.combo = null;        // { combo, born }
    this.milestone = null;    // { value, born }
    this.flash = 0;           // alpha 0..1, decays
    this.bgPulse = 0;         // 0..1 intensity that ramps during cascades
    this.floaters = [];       // rising "+score" popups
    this.rings = [];          // shockwave rings on merges
    this.anticipate = null;   // { ids:Set, born } — tiles charging before a cascade
    this.heat = 0;            // 0..1 combo/heat meter, fills on chains, drains after
    this.freeze = null;       // { born } — milestone freeze overlay
    this.locator = null;      // { r, c, born } — spawn locator glow
    this.nudge = null;        // { dir, born } — invalid-move board nudge
    this.invalid = 0;         // timestamp of last invalid move (red pulse)
    this.gameOverFx = null;   // { born, fired, onModal } — system-failure dim
    this._glowMul = 1;        // global tile-glow multiplier (drops on game over)
    this.resolve = null;      // { combo, born } — end-of-chain payoff pulse

    this.motionScale = 1;     // dialled down when the user prefers reduced motion
    this._lastFrame = performance.now();
    this._initMotionPref();
    this._initPerf();
    this.resize();
    const self = this;
    requestAnimationFrame(function f(now) { self._frame(now); requestAnimationFrame(f); });
  }

  // Respect prefers-reduced-motion: scale down shake/flash/nudge/drift and
  // thin out particles. Updates live if the OS setting changes.
  Renderer.prototype._initMotionPref = function () {
    const self = this;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const apply = function () {
        self.motionScale = mq.matches ? 0.2 : 1;
        self.particles.intensity = mq.matches ? 0.3 : 1;
      };
      apply();
      if (mq.addEventListener) mq.addEventListener("change", apply);
      else if (mq.addListener) mq.addListener(apply);
    } catch (e) {
      this.motionScale = 1;
    }
  };

  // Particle budget: lower the cap on low-end devices up front, and degrade
  // once more if sustained FPS is poor, so big moments never tank the frame.
  Renderer.prototype._initPerf = function () {
    var lowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
                 (navigator.deviceMemory && navigator.deviceMemory <= 4);
    this.particles.max = lowEnd ? 160 : 340;
    this._fpsEMA = 60;
    this._frames = 0;
    this._degraded = false;
  };

  Renderer.prototype.resize = function () {
    const rect = this.canvas.getBoundingClientRect();
    const css = Math.max(120, Math.min(rect.width, rect.height) || rect.width);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = css;
    this.pad = css * 0.035;
    this.gap = css * 0.025;
    this.cell = (css - 2 * this.pad - 3 * this.gap) / 4;
  };

  // Cell -> pixel (top-left of the cell at row r, col c; r/c may be fractional).
  Renderer.prototype._cellX = function (c) { return this.pad + c * (this.cell + this.gap); };
  Renderer.prototype._cellY = function (r) { return this.pad + r * (this.cell + this.gap); };

  // Hard reset sprites to mirror a board (init, new game, undo).
  Renderer.prototype.setBoard = function (board) {
    const now = performance.now();
    this.sprites.clear();
    for (let i = 0; i < 16; i++) {
      const t = board[i];
      if (t) this.sprites.set(t.id, { value: t.value, row: t.row, col: t.col, born: now, anim: t.isNew ? "spawn" : "idle" });
    }
    this.mode = "idle";
    this.plan = null;
    this.combo = null;
    this.milestone = null;
    this.bgPulse = 0;
    this.floaters.length = 0;
    this.rings.length = 0;
    this.anticipate = null;
    this.heat = 0;
    this.freeze = null;
    this.locator = null;
    this.nudge = null;
    this.invalid = 0;
    this.gameOverFx = null;
    this._glowMul = 1;
    this.resolve = null;
    // Cancel any in-flight celebration so it can't bleed into the new board.
    this._fxGen++;
    if (this.particles.clear) this.particles.clear();
    if (this.audio && this.audio.cancelPending) this.audio.cancelPending();
  };

  // Feedback for a swipe that changed nothing: directional nudge + red pulse.
  Renderer.prototype.invalidMove = function (dir) {
    const now = performance.now();
    this.nudge = { dir: dir, born: now };
    this.invalid = now;
    vibrate(20);
  };

  // Begin the "system failure" dim. onModal fires once the board has dimmed.
  Renderer.prototype.startGameOver = function (onModal) {
    this.gameOverFx = { born: performance.now(), fired: false, onModal: onModal };
  };

  Renderer.prototype.isAnimating = function () {
    return this.mode !== "idle" && this.mode !== "done";
  };

  // Begin playing a move plan produced by Game.move().
  Renderer.prototype.play = function (plan) {
    this.plan = plan;
    this.phaseIndex = 0;
    this._finished = false;
    this.bgPulse = 0;
    if (plan.phases.length > 0) {
      this._startPhase(0, performance.now());
    } else {
      this._startLocate(performance.now());
    }
  };

  // Brief locator glow on the cell where the next tile will appear.
  Renderer.prototype._startLocate = function (now) {
    const spawn = this.plan && this.plan.spawn;
    if (spawn) {
      this.locator = { r: spawn.row, c: spawn.col, born: now };
      this.mode = "locating";
      this.phaseStart = now;
    } else {
      this._finish();
    }
  };

  Renderer.prototype._startPhase = function (index, now) {
    const phase = this.plan.phases[index];
    this.slideMap = new Map();
    for (const s of phase.slides) {
      this.slideMap.set(s.id, { from: s.from, to: s.to });
    }
    if (index === 0) {
      // The player's own move stays responsive at full duration.
      this.slideDur = SLIDE_MS;
      this.settleDur = phase.merges.length > 0 ? SETTLE_MS : SETTLE_SHIFT_MS;
    } else {
      const f = cascadeAccel(index);
      this.slideDur = CASCADE_SLIDE_MS * f;
      this.settleDur = (phase.merges.length > 0 ? CASCADE_SETTLE_MS : SETTLE_SHIFT_MS) * f;
    }
    this.mode = "sliding";
    this.phaseStart = now;
    this.audio.whoosh(index === 0 ? 1 : 0.6); // player slide louder than cascades
  };

  // Charge-up before a cascade: pulse the tiles that are about to merge.
  Renderer.prototype._startAnticipate = function (index, now) {
    const phase = this.plan.phases[index];
    if (!phase.merges.length) { this._startPhase(index, now); return; }
    const ids = new Set();
    for (const m of phase.merges) {
      ids.add(m.sourceIds[0]);
      ids.add(m.sourceIds[1]);
    }
    this.anticipate = { ids: ids, born: now };
    this.anticDur = ANTICIPATE_MS * cascadeAccel(index);
    this.mode = "anticipate";
    this.phaseStart = now;
  };

  Renderer.prototype._applyPhase = function (phase, now) {
    // 1) Survivors land on their target cell.
    for (const s of phase.slides) {
      const sp = this.sprites.get(s.id);
      if (sp) { sp.row = s.to.r; sp.col = s.to.c; }
    }
    // 2) Resolve merges: remove sources, add merged tile with pop.
    let maxValue = 0;
    let milestoneHit = false;
    for (const m of phase.merges) {
      this.sprites.delete(m.sourceIds[0]);
      this.sprites.delete(m.sourceIds[1]);
      this.sprites.set(m.newId, { value: m.value, row: m.at.r, col: m.at.c, born: now, anim: "merge" });
      if (m.value > maxValue) maxValue = m.value;

      const cx = this._cellX(m.at.c) + this.cell / 2;
      const cy = this._cellY(m.at.r) + this.cell / 2;
      const col = tileColor(m.value);
      const power = Math.min(2.2, 0.6 + Math.log2(m.value) * 0.18);
      this.particles.burst(cx, cy, col, 10 + Math.round(Math.log2(m.value) * 3), power);
      // Hit spark — bright white pop on every merge, even 4/8/16.
      this.particles.burst(cx, cy, "#ffffff", 6, 1.6);

      // Local "you did good" feedback: floating score + shockwave on every merge.
      this._addFloater(m.value, phase.combo, cx, cy, col);
      this._addRing(cx, cy, col, m.value);

      if (MILESTONE_VALUES[m.value]) { this._triggerMilestone(m.value, cx, cy, now); milestoneHit = true; }
    }

    // A milestone holds the action for a beat before the cascade resumes.
    if (milestoneHit) this.settleDur += MILESTONE_FREEZE;

    // 3) Feedback for the phase.
    if (phase.merges.length > 0) {
      this.audio.merge(maxValue);
      this.shake = Math.min(14, Math.log2(maxValue) * 0.8 + phase.combo * 0.6);
      this.bgPulse = Math.min(1, this.bgPulse + 0.25);
    }
    if (phase.combo >= 1) {
      this.audio.chain(phase.combo);
      this.heat = Math.max(this.heat, Math.min(1, phase.combo / 6 + 0.18));
      if (phase.combo >= 2) this.combo = { combo: phase.combo, born: now };
      // Chain 3+ feels like a jackpot: flash + gold sparkle shower.
      if (phase.combo >= 3) {
        this.flash = Math.max(this.flash, phase.combo >= 4 ? 0.6 : 0.42);
        this.particles.burst(this.size / 2, this.size * 0.4, JACKPOT_COLOR, 16, 1.7);
      }
    }
    if (phase.phaseScore && this.cb.onScore) this.cb.onScore(phase.phaseScore);

    // Haptics — milestone wins over chain wins over a plain merge.
    if (milestoneHit) vibrate([40, 50, 80]);
    else if (phase.merges.length) vibrate(phase.combo >= 3 ? [20, 30, 20] : 10);
  };

  Renderer.prototype._triggerMilestone = function (value, cx, cy, now) {
    this.milestone = { value: value, born: now };
    this.freeze = { born: now };
    this.flash = 1.0;
    this.heat = 1;
    this.shake = Math.max(this.shake, 16);
    this.audio.boom();      // heavy stinger
    this.audio.duckAmbient(800); // pull the bed down so it lands
    this.audio.milestone(); // arpeggio over the top

    const col = tileColor(value);
    const s = this.size;
    // big white shockwave from the tile
    this.rings.push({ x: cx, y: cy, life: 0, maxLife: 0.7, color: "#ffffff", maxR: s * 0.7 });
    this.rings.push({ x: cx, y: cy, life: 0, maxLife: 0.85, color: col, maxR: s * 0.95 });
    // staggered fireworks across the board
    this.particles.firework(cx, cy, col);
    const self = this;
    const gen = this._fxGen; // cancel token — bail if the board was reset
    const isWin = value >= 2048;
    if (isWin) this.milestone.win = true;
    const waves = isWin ? 10 : 5;
    for (let i = 0; i < waves; i++) {
      setTimeout(function () {
        if (self._fxGen !== gen) return;
        self.particles.firework(s * (0.12 + Math.random() * 0.76), s * (0.12 + Math.random() * 0.6), isWin ? "#ffffff" : (Math.random() < 0.5 ? col : "#ffffff"));
        self.flash = Math.max(self.flash, isWin ? 0.7 : 0.35);
      }, 120 + i * (isWin ? 110 : 130));
    }
  };

  // End-of-chain payoff: a board-wide pulse + soft ring so the chain has a
  // clear resolution beat, scaled by how long the chain was.
  Renderer.prototype._triggerResolve = function (combo, now) {
    this.resolve = { combo: combo, born: now };
    this.bgPulse = Math.min(1, this.bgPulse + 0.3);
    const col = this._resolveColor(combo);
    this.rings.push({ x: this.size / 2, y: this.size / 2, life: 0, maxLife: 0.5, color: col, maxR: this.size * 0.62 });
    this.audio.resolve(combo);
  };

  Renderer.prototype._resolveColor = function (combo) {
    return combo >= 4 ? JACKPOT_COLOR : combo >= 3 ? "#ff2ea8" : "#21e6ff";
  };

  // Dev/feel helpers — trigger effects in isolation, no gameplay needed.
  Renderer.prototype.debugCombo = function (combo) {
    const now = performance.now();
    this.combo = { combo: combo, born: now };
    this.heat = Math.min(1, combo / 6 + 0.18);
    this.audio.chain(combo);
    if (combo >= 3) {
      this.flash = combo >= 4 ? 0.6 : 0.42;
      this.particles.burst(this.size / 2, this.size * 0.4, JACKPOT_COLOR, 16, 1.7);
    }
  };
  Renderer.prototype.debugResolve = function (combo) { this._triggerResolve(combo || 3, performance.now()); };
  Renderer.prototype.debugMilestone = function (value) { this._triggerMilestone(value || 2048, this.size / 2, this.size * 0.45, performance.now()); };

  Renderer.prototype._startSpawn = function (now) {
    const spawn = this.plan && this.plan.spawn;
    if (spawn) {
      this.sprites.set(spawn.id, { value: spawn.value, row: spawn.row, col: spawn.col, born: now, anim: "spawn" });
      this.mode = "spawning";
      this.phaseStart = now;
      this.audio.pop();
    } else {
      this._finish();
    }
  };

  Renderer.prototype._finish = function () {
    this.mode = "idle";
    if (!this._finished) {
      this._finished = true;
      if (this.cb.onComplete) this.cb.onComplete();
    }
  };

  Renderer.prototype._update = function (now, dt) {
    // decay fx
    this.shake *= Math.pow(0.001, dt);     // fast decay
    this.flash = Math.max(0, this.flash - dt / (FLASH_MS / 1000));
    this.bgPulse = Math.max(0, this.bgPulse - dt * 0.4);
    this.heat = Math.max(0, this.heat - dt * 0.7); // drains after the chain
    if (this.freeze && now - this.freeze.born > FREEZE_MS) this.freeze = null;
    if (this.nudge && now - this.nudge.born > NUDGE_MS) this.nudge = null;
    if (this.resolve && now - this.resolve.born > RESOLVE_MS) this.resolve = null;
    if (this.gameOverFx && !this.gameOverFx.fired && now - this.gameOverFx.born >= GAMEOVER_DIM_MS) {
      this.gameOverFx.fired = true;
      if (this.gameOverFx.onModal) this.gameOverFx.onModal();
    }
    if (this.combo && now - this.combo.born > COMBO_MS) this.combo = null;
    if (this.milestone && now - this.milestone.born > MILESTONE_MS) this.milestone = null;

    // floaters rise and fade
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life += dt;
      if (f.life >= f.maxLife) { this.floaters.splice(i, 1); continue; }
      f.y += f.vy * dt;
      f.vy *= Math.pow(0.04, dt); // ease the rise to a stop
    }
    // rings expand and fade
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.life += dt;
      if (rg.life >= rg.maxLife) this.rings.splice(i, 1);
    }

    switch (this.mode) {
      case "sliding":
        if (now - this.phaseStart >= this.slideDur) {
          this._applyPhase(this.plan.phases[this.phaseIndex], now);
          this.mode = "settle";
          this.phaseStart = now;
        }
        break;
      case "settle":
        if (now - this.phaseStart >= this.settleDur) {
          this.phaseIndex += 1;
          if (this.phaseIndex < this.plan.phases.length) {
            // Telegraph the upcoming auto-cascade: charge its tiles first.
            this._startAnticipate(this.phaseIndex, now);
          } else {
            // Chain finished — pay off a 2+ combo before the next tile spawns.
            if (this.plan.chainLength >= 2) this._triggerResolve(this.plan.chainLength, now);
            this._startLocate(now);
          }
        }
        break;
      case "anticipate":
        if (now - this.phaseStart >= this.anticDur) {
          this.anticipate = null;
          this._startPhase(this.phaseIndex, now);
        }
        break;
      case "locating":
        if (now - this.phaseStart >= SPAWN_LOCATE_MS) {
          this.locator = null;
          this._startSpawn(now);
        }
        break;
      case "spawning":
        if (now - this.phaseStart >= SPAWN_MS) this._finish();
        break;
    }
  };

  Renderer.prototype._frame = function (now) {
    const rawDt = (now - this._lastFrame) / 1000;
    const dt = Math.min(0.05, rawDt);
    this._lastFrame = now;

    // Sustained-FPS watchdog: degrade the particle budget once if struggling.
    this._frames++;
    const fps = rawDt > 0 ? 1 / rawDt : 60;
    this._fpsEMA = this._fpsEMA * 0.9 + fps * 0.1;
    if (!this._degraded && this._frames > 180 && this._fpsEMA < 42) {
      this._degraded = true;
      this.particles.max = 110;
      this.particles.intensity = Math.min(this.particles.intensity, 0.5);
    }

    this.particles.update(dt);
    this._update(now, dt);
    this._draw(now);
  };

  // --- drawing ------------------------------------------------------------
  Renderer.prototype._draw = function (now) {
    const ctx = this.ctx;
    const s = this.size;
    ctx.clearRect(0, 0, s, s);

    // game-over dim drives the global tile-glow multiplier
    if (this.gameOverFx) {
      const gt = clamp01((now - this.gameOverFx.born) / GAMEOVER_DIM_MS);
      this._glowMul = 1 - gt * 0.92;
    } else {
      this._glowMul = 1;
    }

    let ox = 0, oy = 0;
    if (this.shake > 0.2) {
      const sh = this.shake * this.motionScale;
      ox += (Math.random() - 0.5) * sh;
      oy += (Math.random() - 0.5) * sh;
    }
    if (this.nudge) {
      const nt = clamp01((now - this.nudge.born) / NUDGE_MS);
      const amp = Math.sin(nt * Math.PI) * this.cell * 0.13 * this.motionScale; // out and back
      const v = DIRVEC[this.nudge.dir] || { x: 0, y: 0 };
      ox += v.x * amp;
      oy += v.y * amp;
    }

    ctx.save();
    ctx.translate(ox, oy);

    this._drawBackground(ctx, now);
    this._drawGridCells(ctx);
    this._drawHeatMeter(ctx, now);
    this._drawLocator(ctx, now);

    // sliding interpolation
    const sliding = this.mode === "sliding";
    const slideT = sliding ? easeOutCubic(clamp01((now - this.phaseStart) / this.slideDur)) : 0;

    const anticIds = this.anticipate ? this.anticipate.ids : null;
    const anticAge = this.anticipate ? now - this.anticipate.born : 0;
    this.sprites.forEach((sp, id) => {
      let r = sp.row, c = sp.col;
      if (sliding && this.slideMap.has(id)) {
        const mv = this.slideMap.get(id);
        r = lerp(mv.from.r, mv.to.r, slideT);
        c = lerp(mv.from.c, mv.to.c, slideT);
      }
      const fx = this._spriteFx(sp, now);
      fx.antic = 0;
      if (anticIds && anticIds.has(id)) {
        // fast blink/pulse so the player can read the incoming cascade
        const pulse = 0.5 + 0.5 * Math.sin(anticAge / 22);
        fx.sx *= 1 + pulse * 0.08;
        fx.sy *= 1 + pulse * 0.08;
        fx.antic = pulse;
      }
      this._drawTile(ctx, r, c, sp.value, fx, now);
    });

    this._drawFreeze(ctx, now); // dim the board behind the celebration
    this._drawRings(ctx);
    this.particles.draw(ctx);
    this._drawGameOverDim(ctx, now);
    ctx.restore();

    // overlays (not shaken)
    this._drawInvalid(ctx, now);
    this._drawResolve(ctx, now);
    this._drawEdgeGlow(ctx, now);
    this._drawFloaters(ctx);
    if (this.flash > 0.001) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255," + (this.flash * 0.5 * this.motionScale) + ")";
      ctx.fillRect(0, 0, s, s);
      ctx.restore();
    }
    if (this.combo) this._drawCombo(ctx, now);
    if (this.milestone) this._drawMilestone(ctx, now);
  };

  // Returns { sx, sy, flash } — non-uniform scale (squash/stretch) plus a
  // white impact flash amount (0..1) for the smacky merge frame.
  Renderer.prototype._spriteFx = function (sp, now) {
    const age = (now - sp.born) / 1000;
    if (sp.anim === "spawn") {
      const t = clamp01(age / (SPAWN_MS / 1000));
      const s = t >= 1 ? 1 : easeOutBack(t);
      return { sx: s, sy: s, flash: 0 };
    }
    if (sp.anim === "merge") {
      const t = clamp01(age / (MERGE_MS / 1000));
      if (t >= 1) { sp.anim = "idle"; return { sx: 1, sy: 1, flash: 0 }; }
      // overall punch 1 -> 1.32 -> 1
      const pop = t < 0.5 ? lerp(1, 1.32, t * 2) : lerp(1.32, 1, (t - 0.5) * 2);
      // squash on impact: wide + short, decaying over the first 40%
      const squash = (1 - clamp01(t / 0.4)) * 0.24;
      // bright flash for the first ~28%
      const flash = Math.max(0, 1 - t / 0.28) * 0.85;
      return { sx: pop * (1 + squash), sy: pop * (1 - squash), flash: flash };
    }
    // idle subtle pulse
    const p = 1 + Math.sin(now / 600 + sp.value) * 0.012;
    return { sx: p, sy: p, flash: 0 };
  };

  Renderer.prototype._drawBackground = function (ctx, now) {
    const s = this.size;
    // base
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(0, 0, s, s);

    // faint perspective horizon grid with mild parallax + pulse
    const pulse = 0.05 + this.bgPulse * 0.12 + Math.sin(now / 1400) * 0.02 * this.motionScale;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(60,120,255," + pulse + ")";
    ctx.lineWidth = 1;
    const horizon = s * 0.5;
    const drift = this.motionScale < 0.5 ? 0 : (now / 60) % (s / 8);
    // vertical perspective lines converging to centre horizon
    for (let i = -4; i <= 12; i++) {
      const x = (i / 8) * s;
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(s / 2 + (x - s / 2) * 0.12, horizon);
      ctx.stroke();
    }
    // horizontal receding lines
    for (let j = 0; j < 8; j++) {
      const y = horizon + ((j * s) / 16 + drift) % (s / 2);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    ctx.restore();

    // vignette — darkens edges for a "chamber" feel
    const vg = ctx.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, s, s);
  };

  // Combo/heat meter — a thin energy bar around the board that fills (top-left,
  // clockwise) as the chain builds and drains afterwards. Colour rises with heat.
  Renderer.prototype._drawHeatMeter = function (ctx, now) {
    const s = this.size;
    const inset = this.pad * 0.45;
    const x = inset, y = inset, w = s - 2 * inset, h = s - 2 * inset, r = 18;
    const perim = 2 * (w + h) - 8 * r + 2 * Math.PI * r;

    ctx.save();
    // faint track
    this._roundRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = "rgba(120,160,255,0.10)";
    ctx.lineWidth = 3;
    ctx.stroke();

    if (this.heat > 0.01) {
      const col = this.heat > 0.75 ? JACKPOT_COLOR : this.heat > 0.4 ? "#ff2ea8" : "#21e6ff";
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 + 10 * this.heat;
      ctx.lineWidth = 4;
      ctx.setLineDash([perim * this.heat, perim]);
      this._roundRect(ctx, x, y, w, h, r);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  };

  // Locator glow on the cell where the next tile is about to spawn.
  Renderer.prototype._drawLocator = function (ctx, now) {
    if (!this.locator) return;
    const t = clamp01((now - this.locator.born) / SPAWN_LOCATE_MS);
    const cx = this._cellX(this.locator.c) + this.cell / 2;
    const cy = this._cellY(this.locator.r) + this.cell / 2;
    const pulse = 0.5 + 0.5 * Math.sin(now / 45);
    const rad = this.cell * (0.22 + 0.28 * t);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, "rgba(33,230,255," + (0.55 * (0.6 + 0.4 * pulse)) + ")");
    g.addColorStop(1, "rgba(33,230,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255," + (0.2 + 0.5 * (1 - t)) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, this.cell * 0.32 * (0.7 + 0.3 * pulse), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  // Milestone freeze — darkens the board for a beat so the breakthrough lands.
  Renderer.prototype._drawFreeze = function (ctx, now) {
    if (!this.freeze) return;
    const t = (now - this.freeze.born) / FREEZE_MS;
    if (t >= 1) return;
    let a;
    if (t < 0.12) a = t / 0.12;      // ramp in
    else if (t > 0.7) a = (1 - t) / 0.3; // ramp out
    else a = 1;                      // hold
    ctx.save();
    ctx.fillStyle = "rgba(4,5,12," + (0.5 * a) + ")";
    ctx.fillRect(0, 0, this.size, this.size);
    ctx.restore();
  };

  // System-failure dim: darkens the whole board, deepening as it settles.
  Renderer.prototype._drawGameOverDim = function (ctx, now) {
    if (!this.gameOverFx) return;
    const t = clamp01((now - this.gameOverFx.born) / GAMEOVER_DIM_MS);
    ctx.save();
    ctx.fillStyle = "rgba(6,4,10," + (0.62 * t) + ")";
    ctx.fillRect(0, 0, this.size, this.size);
    ctx.restore();
  };

  // Red edge pulse for an invalid (no-op) move.
  Renderer.prototype._drawInvalid = function (ctx, now) {
    if (!this.invalid) return;
    const t = (now - this.invalid) / INVALID_MS;
    if (t >= 1) { this.invalid = 0; return; }
    const a = 1 - t;
    const s = this.size;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a * 0.7;
    ctx.strokeStyle = "#ff3b4e";
    ctx.shadowColor = "#ff3b4e";
    ctx.shadowBlur = 35 * a;
    ctx.lineWidth = 6;
    this._roundRect(ctx, 5, 5, s - 10, s - 10, 18);
    ctx.stroke();
    ctx.restore();
  };

  // End-of-chain payoff pulse: a soft full-board wash that blooms and clears.
  Renderer.prototype._drawResolve = function (ctx, now) {
    if (!this.resolve) return;
    const t = (now - this.resolve.born) / RESOLVE_MS;
    if (t >= 1) { this.resolve = null; return; }
    const s = this.size;
    const col = this._resolveColor(this.resolve.combo);
    const k = Math.min(1, this.resolve.combo / 5); // stronger for longer chains
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // brief wash, fading out
    ctx.globalAlpha = (1 - t) * (0.10 + 0.08 * k);
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, s, s);
    ctx.restore();
  };

  // Glowing border that intensifies on long chains and milestones.
  Renderer.prototype._drawEdgeGlow = function (ctx, now) {
    let glow = 0;
    let color = "#21e6ff";
    if (this.combo) {
      const t = (now - this.combo.born) / COMBO_MS;
      if (t < 1) {
        glow = Math.max(glow, (1 - t) * Math.min(1, this.combo.combo / 6));
        color = this.combo.combo >= 4 ? "#ff2ea8" : "#21e6ff";
      }
    }
    if (this.milestone) {
      const t = (now - this.milestone.born) / MILESTONE_MS;
      if (t < 1 && 1 - t > glow) { glow = 1 - t; color = "#ffffff"; }
    }
    if (glow <= 0.01) return;
    const s = this.size;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = glow * 0.85;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 45 * glow;
    ctx.lineWidth = 6 + 6 * glow;
    this._roundRect(ctx, 5, 5, s - 10, s - 10, 18);
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype._drawGridCells = function (ctx) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const x = this._cellX(c), y = this._cellY(r);
        this._roundRect(ctx, x, y, this.cell, this.cell, this.cell * 0.16);
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fill();
        ctx.strokeStyle = "rgba(120,160,255,0.10)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  };

  Renderer.prototype._drawTile = function (ctx, r, c, value, fx, now) {
    const w = this.cell * fx.sx;
    const h = this.cell * fx.sy;
    const x = this._cellX(c) + (this.cell - w) / 2;
    const y = this._cellY(r) + (this.cell - h) / 2;
    const color = tileColor(value);
    const radius = Math.min(w, h) * 0.16;
    let glow = Math.min(40, 6 + Math.log2(value) * 3.2);
    if (fx.antic) glow += 30 * fx.antic; // brighten while charging
    glow *= this._glowMul;               // tiles lose glow on game over

    ctx.save();

    // 1) body + outer glow — 3-stop gradient gives the surface depth
    ctx.shadowColor = fx.antic ? "#ffffff" : color;
    ctx.shadowBlur = glow * (value >= 2048 ? 1.4 : 1);
    this._roundRect(ctx, x, y, w, h, radius);
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, this._lighten(color, fx.antic ? 0.42 : 0.32));
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, this._darken(color, 0.28));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowBlur = 0;

    // clip the material layers to the tile shape
    this._roundRect(ctx, x, y, w, h, radius);
    ctx.save();
    ctx.clip();

    // 2) emissive core for 512+ (additive, gentle pulse)
    if (value >= 512) {
      const pulse = 0.8 + 0.2 * Math.sin(now / 380 + value);
      const er = Math.min(w, h) * 0.55;
      const a = Math.min(0.7, 0.28 + Math.log2(value) * 0.03) * pulse * this._glowMul;
      const eg = ctx.createRadialGradient(x + w / 2, y + h * 0.52, 0, x + w / 2, y + h * 0.52, er);
      eg.addColorStop(0, this._rgba(value >= 2048 ? "#ffffff" : this._lighten(color, 0.5), a));
      eg.addColorStop(1, this._rgba(color, 0));
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = eg;
      ctx.fillRect(x, y, w, h);
      ctx.globalCompositeOperation = "source-over";
    }

    // 3) inner highlight — glossy top sheen
    const hl = ctx.createLinearGradient(x, y, x, y + h * 0.55);
    hl.addColorStop(0, "rgba(255,255,255,0.26)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fillRect(x, y, w, h * 0.55);

    // 4) subtle CRT scanlines
    this._ensureScanPattern();
    if (this._scanPattern) {
      ctx.fillStyle = this._scanPattern;
      ctx.fillRect(x, y, w, h);
    }

    ctx.restore(); // drop clip

    // 5) rim light — bright top edge, dark bottom edge (bevel)
    const rim = ctx.createLinearGradient(x, y, x, y + h);
    rim.addColorStop(0, "rgba(255,255,255,0.55)");
    rim.addColorStop(0.5, "rgba(255,255,255,0.05)");
    rim.addColorStop(1, "rgba(0,0,0,0.35)");
    this._roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, radius);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rim;
    ctx.stroke();

    // 6) hot white core for the top tiles
    if (value >= 1024) {
      ctx.fillStyle = "rgba(255,255,255," + (value >= 2048 ? 0.85 : 0.4) + ")";
      this._roundRect(ctx, x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.4, radius * 0.6);
      ctx.fill();
    }

    // 7) value text
    ctx.fillStyle = this._textColor(value);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const str = String(value);
    const ref = Math.min(w, h);
    const fontSize = ref * (str.length >= 5 ? 0.24 : str.length >= 4 ? 0.3 : str.length === 3 ? 0.36 : 0.44);
    ctx.font = "700 " + fontSize + "px 'Trebuchet MS', system-ui, sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 2;
    ctx.fillText(str, x + w / 2, y + h / 2 + h * 0.02);
    ctx.shadowBlur = 0;

    // 8) smacky impact flash
    if (fx.flash > 0.001) {
      this._roundRect(ctx, x, y, w, h, radius);
      ctx.fillStyle = "rgba(255,255,255," + fx.flash + ")";
      ctx.fill();
    }
    ctx.restore();
  };

  Renderer.prototype._drawCombo = function (ctx, now) {
    const age = (now - this.combo.born) / COMBO_MS;
    const t = clamp01(age);
    const s = this.size;
    const scale = 1 + this.combo.combo * 0.12 + easeOutBack(Math.min(1, t * 3)) * 0.2;
    ctx.save();
    ctx.globalAlpha = 1 - t * t;
    ctx.translate(s / 2, s * 0.4);
    ctx.scale(scale, scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 " + s * 0.09 + "px 'Trebuchet MS', system-ui, sans-serif";
    const col = this.combo.combo >= 4 ? "#fff" : "#21e6ff";
    ctx.shadowColor = col;
    ctx.shadowBlur = 24;
    ctx.fillStyle = col;
    ctx.fillText("CHAIN x" + this.combo.combo, 0, 0);
    // praise word below
    ctx.font = "800 " + s * 0.06 + "px 'Trebuchet MS', system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(praiseWord(this.combo.combo), 0, s * 0.085);
    ctx.restore();
  };

  // --- floaters + rings ---------------------------------------------------
  // Hierarchical score popup. combo 1 -> "+8"; combo 2 -> "x2  +16";
  // combo 3+ -> gold "x3  +48" jackpot text.
  Renderer.prototype._addFloater = function (value, combo, x, y, color) {
    const gain = value * combo;
    let text, fill, glow, mult;
    if (combo >= 3) {
      text = "x" + combo + "  +" + gain;
      fill = JACKPOT_COLOR; glow = JACKPOT_COLOR; mult = 1.6 + Math.min(0.6, (combo - 3) * 0.2);
    } else if (combo === 2) {
      text = "x2  +" + gain;
      fill = "#bdf3ff"; glow = "#21e6ff"; mult = 1.3;
    } else {
      text = "+" + gain;
      fill = "#ffffff"; glow = color; mult = 1;
    }
    const base = this.cell * (0.24 + Math.min(0.18, Math.log2(value) * 0.022));
    this.floaters.push({
      text: text, x: x, y: y, vy: -this.cell * (combo >= 3 ? 1.1 : 1.4),
      life: 0, maxLife: 0.9 + combo * 0.14, size: base * mult,
      fill: fill, glow: glow, jackpot: combo >= 3,
    });
  };

  Renderer.prototype._addRing = function (x, y, color, value) {
    this.rings.push({ x: x, y: y, life: 0, maxLife: 0.5, color: color, maxR: this.cell * (0.7 + Math.log2(value) * 0.06) });
  };

  Renderer.prototype._drawRings = function (ctx) {
    if (this.rings.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const rg of this.rings) {
      const t = rg.life / rg.maxLife;
      const r = rg.maxR * easeOutCubic(t);
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.strokeStyle = rg.color;
      ctx.lineWidth = (1 - t) * 5 + 1;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype._drawFloaters = function (ctx) {
    if (this.floaters.length === 0) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.floaters) {
      const t = f.life / f.maxLife;
      const alpha = t < 0.12 ? t / 0.12 : (1 - (t - 0.12) / 0.88);
      const pop = t < 0.12 ? easeOutBack(t / 0.12) : 1;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = "800 " + f.size * pop + "px 'Trebuchet MS', system-ui, sans-serif";
      ctx.shadowColor = f.glow;
      ctx.shadowBlur = f.jackpot ? 26 : 16;
      ctx.fillStyle = f.fill;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  };

  Renderer.prototype._drawMilestone = function (ctx, now) {
    const age = (now - this.milestone.born) / MILESTONE_MS;
    const t = clamp01(age);
    const s = this.size;
    const win = this.milestone.win;
    ctx.save();
    ctx.globalAlpha = (1 - t) * (t < 0.15 ? t / 0.15 : 1);
    ctx.translate(s / 2, s * (win ? 0.5 : 0.6));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = win ? 50 : 30;
    ctx.fillStyle = "#fff";
    ctx.font = "900 " + s * (win ? 0.18 : 0.08) + "px 'Trebuchet MS', system-ui, sans-serif";
    ctx.fillText(win ? "2048" : "BREAKTHROUGH", 0, 0);
    ctx.font = "800 " + s * (win ? 0.06 : 0.05) + "px 'Trebuchet MS', system-ui, sans-serif";
    ctx.fillStyle = win ? "#ffffff" : tileColor(this.milestone.value);
    ctx.fillText(win ? "SYSTEM BREACH" : String(this.milestone.value), 0, s * (win ? 0.13 : 0.08));
    ctx.restore();
  };

  // --- small drawing helpers ---
  Renderer.prototype._roundRect = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  Renderer.prototype._lighten = function (hex, amt) {
    const c = this._parse(hex);
    return "rgb(" + Math.min(255, c.r + 255 * amt) + "," + Math.min(255, c.g + 255 * amt) + "," + Math.min(255, c.b + 255 * amt) + ")";
  };
  Renderer.prototype._darken = function (hex, amt) {
    const c = this._parse(hex);
    return "rgb(" + Math.max(0, c.r - 255 * amt) + "," + Math.max(0, c.g - 255 * amt) + "," + Math.max(0, c.b - 255 * amt) + ")";
  };
  Renderer.prototype._rgba = function (col, a) {
    let r, g, b;
    if (col[0] === "#") { const c = this._parse(col); r = c.r; g = c.g; b = c.b; }
    else { const m = col.match(/\d+(\.\d+)?/g); r = +m[0]; g = +m[1]; b = +m[2]; }
    return "rgba(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + "," + a + ")";
  };
  Renderer.prototype._ensureScanPattern = function () {
    if (this._scanPattern || this._scanTried) return;
    this._scanTried = true;
    try {
      const c = document.createElement("canvas");
      c.width = 2; c.height = 3;
      const x = c.getContext("2d");
      x.fillStyle = "rgba(0,0,0,0.10)";
      x.fillRect(0, 0, 2, 1); // one dark line every 3px
      this._scanPattern = this.ctx.createPattern(c, "repeat");
    } catch (e) {
      this._scanPattern = null;
    }
  };
  Renderer.prototype._textColor = function (value) {
    // dark text on bright/light tiles, white otherwise
    if (value >= 1024) return "#1a0a14";
    if (value === 16 || value === 32) return "#0a0a14";
    return "#ffffff";
  };
  Renderer.prototype._parse = function (hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  CR.Renderer = Renderer;
})((window.CR = window.CR || {}));
