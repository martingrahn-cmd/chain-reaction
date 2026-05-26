/* Chain Reaction — procedural audio (Web Audio API, no asset files).
 * All sounds are synthesised on the fly. Context is created lazily and
 * resumed on the first user gesture (browser autoplay policy).
 */
(function (CR) {
  "use strict";

  // Pentatonic scale (semitone offsets) used to pitch merges by tile value.
  const PENTA = [0, 2, 4, 7, 9];
  const BASE_FREQ = 196; // ~G3

  // ---- Mix table -------------------------------------------------------
  // One place to balance every layer. Peak gains (pre-master). Tuned so the
  // ambient bed sits low, whoosh is felt-not-heard (it fires on every slide,
  // so keep it soft to avoid fatigue), and the milestone boom keeps clear
  // headroom above everything else.
  const MIX = {
    master: 0.82,       // leave headroom so stacked layers don't clip
    ambient: 0.04,      // low, constant bed
    whoosh: 0.06,       // soft — plays on every move, must not fatigue
    pop: 0.10,          // spawn
    invalid: 0.15,      // blocked-move tick
    merge: 0.24,        // per-merge tone
    chain: 0.38,        // cascade thump
    resolve: 0.16,      // end-of-chain
    milestoneArp: 0.22, // breakthrough arpeggio
    boom: 0.72,         // milestone sub-drop — the loudest event
    boomNoise: 0.26,
    gameOver: 0.30,
  };

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.ambientGain = null;
    this._ambientStarted = false;
    this._fxGen = 0; // bumped to cancel scheduled (setTimeout) notes
  }

  // Invalidate any pending scheduled notes (e.g. on New Game / Undo).
  AudioEngine.prototype.cancelPending = function () {
    this._fxGen++;
  };

  AudioEngine.prototype._ensure = function () {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MIX.master;
    this.master.connect(this.ctx.destination);
  };

  // Call from the first user input so audio is allowed to play.
  AudioEngine.prototype.unlock = function () {
    this._ensure();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    if (!this._ambientStarted) this._startAmbient();
  };

  AudioEngine.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : MIX.master;
  };

  AudioEngine.prototype._freqForValue = function (value) {
    const step = Math.max(0, Math.round(Math.log2(value)) - 1); // value 2 -> 0
    const octave = Math.floor(step / PENTA.length);
    const semis = PENTA[step % PENTA.length] + octave * 12;
    return BASE_FREQ * Math.pow(2, semis / 12);
  };

  AudioEngine.prototype._tone = function (freq, dur, type, gain, attack) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || "triangle";
    osc.frequency.value = freq;
    attack = attack == null ? 0.005 : attack;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  // Merge: bright synth tone, pitch mapped from tile value.
  AudioEngine.prototype.merge = function (value) {
    this._ensure();
    this._tone(this._freqForValue(value), 0.22, "triangle", MIX.merge, 0.004);
  };

  // Chain step: low thump whose pitch rises with the combo step.
  AudioEngine.prototype.chain = function (step) {
    this._ensure();
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    const f = 70 + step * 22;
    osc.frequency.setValueAtTime(f * 1.6, t0);
    osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.18);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(MIX.chain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.3);
  };

  // Milestone stinger: quick ascending arpeggio.
  AudioEngine.prototype.milestone = function () {
    this._ensure();
    if (!this.ctx) return;
    const notes = [0, 4, 7, 12, 16];
    const self = this;
    const gen = this._fxGen;
    notes.forEach(function (semi, i) {
      setTimeout(function () {
        if (self._fxGen !== gen) return;
        self._tone(BASE_FREQ * 2 * Math.pow(2, semi / 12), 0.3, "sawtooth", MIX.milestoneArp, 0.004);
      }, i * 70);
    });
  };

  // Heavy stinger for the milestone freeze: deep sub-drop + filtered noise hit.
  AudioEngine.prototype.boom = function () {
    this._ensure();
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    // sub-bass drop
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.5);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(MIX.boom, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.75);
    // noise impact
    const dur = 0.25;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const ng = this.ctx.createGain();
    ng.gain.value = MIX.boomNoise;
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.master);
    src.start(t0);
  };

  // End-of-chain resolve: a quick pleasant rising two-note.
  AudioEngine.prototype.resolve = function (combo) {
    this._ensure();
    if (!this.ctx || this.muted) return;
    const base = this._freqForValue(16);
    this._tone(base, 0.26, "triangle", MIX.resolve, 0.005);
    const self = this;
    const gen = this._fxGen;
    setTimeout(function () { if (self._fxGen !== gen) return; self._tone(base * 1.5, 0.3, "triangle", MIX.resolve * 1.1, 0.005); }, 80);
  };

  // Slide whoosh: short band-passed noise sweep. intensity 0..1.
  AudioEngine.prototype.whoosh = function (intensity) {
    this._ensure();
    if (!this.ctx || this.muted) return;
    intensity = intensity == null ? 1 : intensity;
    const t0 = this.ctx.currentTime;
    const dur = 0.18;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(380, t0);
    bp.frequency.exponentialRampToValueAtTime(1700, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(MIX.whoosh * intensity, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t0);
  };

  // Soft pop when a new tile spawns.
  AudioEngine.prototype.pop = function () {
    this._ensure();
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, t0);
    osc.frequency.exponentialRampToValueAtTime(720, t0 + 0.08);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(MIX.pop, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.13);
  };

  // Briefly duck the ambient bed (e.g. under a milestone stinger).
  AudioEngine.prototype.duckAmbient = function (ms) {
    if (!this.ctx || !this.ambientGain) return;
    const t0 = this.ctx.currentTime;
    const dur = (ms || 600) / 1000;
    const g = this.ambientGain.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(g.value, t0);
    g.linearRampToValueAtTime(0.008, t0 + 0.05);
    g.linearRampToValueAtTime(MIX.ambient, t0 + dur);
  };

  // Dull low click for an invalid (blocked) move.
  AudioEngine.prototype.thunk = function () {
    this._ensure();
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    osc.type = "square";
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(80, t0 + 0.08);
    lp.type = "lowpass";
    lp.frequency.value = 400;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(MIX.invalid, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  };

  // Game over: falling tone.
  AudioEngine.prototype.gameOver = function () {
    this._ensure();
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, t0);
    osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.9);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(MIX.gameOver, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 1.05);
  };

  // Low ambient drone loop.
  AudioEngine.prototype._startAmbient = function () {
    this._ensure();
    if (!this.ctx || this._ambientStarted) return;
    this._ambientStarted = true;
    const ag = this.ctx.createGain();
    ag.gain.value = MIX.ambient;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    o1.type = "sine"; o1.frequency.value = 55;
    o2.type = "sine"; o2.frequency.value = 55 * 1.5 + 0.4; // detuned fifth
    o1.connect(lp); o2.connect(lp);
    lp.connect(ag);
    ag.connect(this.master);
    o1.start(); o2.start();
    this.ambientGain = ag;
  };

  CR.AudioEngine = AudioEngine;
})((window.CR = window.CR || {}));
