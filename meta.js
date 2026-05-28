/* Chain Reaction — meta layer: high scores, lifetime counters, achievements.
 * Pure data + localStorage. No rendering. Consumed by the controller.
 */
(function (CR) {
  "use strict";

  // ---- High scores -----------------------------------------------------
  const HS_KEY = "chainreaction.highscores";
  const HS_MAX = 10;
  const HighScores = {
    // Tolerant load: drops anything malformed and coerces fields, so an old
    // or corrupted entry can never render "undefined" in the table.
    load: function () {
      var list;
      try { list = JSON.parse(localStorage.getItem(HS_KEY)); } catch (e) { return []; }
      if (!Array.isArray(list)) return [];
      return list
        .filter(function (e) { return e && typeof e.score === "number" && isFinite(e.score); })
        .map(function (e) {
          return {
            score: Math.max(0, Math.round(e.score)),
            maxTile: Math.max(0, Math.round(e.maxTile || 0)),
            chain: Math.max(0, Math.round(e.chain || 0)),
            date: e.date || 0,
          };
        })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, HS_MAX);
    },
    save: function (list) {
      try { localStorage.setItem(HS_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    },
    // Adds a run, keeps the top HS_MAX by score. Returns the rank (0-based),
    // or -1 if it didn't make the board.
    add: function (entry) {
      const list = HighScores.load();
      list.push(entry);
      list.sort(function (a, b) { return b.score - a.score; });
      const trimmed = list.slice(0, HS_MAX);
      HighScores.save(trimmed);
      return trimmed.indexOf(entry);
    },
  };

  // ---- Lifetime counters (e.g. games played) ---------------------------
  const LIFE_KEY = "chainreaction.lifetime";
  const Lifetime = {
    load: function () {
      var o;
      try { o = JSON.parse(localStorage.getItem(LIFE_KEY)); } catch (e) { o = null; }
      if (!o || typeof o !== "object") o = {};
      return {
        games: Math.max(0, Math.round(o.games || 0)),
        moves: Math.max(0, Math.round(o.moves || 0)),
        chains: Math.max(0, Math.round(o.chains || 0)),
        score: Math.max(0, Math.round(o.score || 0)),
        maxTile: Math.max(0, Math.round(o.maxTile || 0)),
      };
    },
    save: function (o) { try { localStorage.setItem(LIFE_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } },
    // Records one finished run into the lifetime totals.
    record: function (run) {
      run = run || {};
      const l = Lifetime.load();
      l.games += 1;
      l.moves += run.moves || 0;
      l.chains += run.chains || 0;
      l.score += run.score || 0;
      l.maxTile = Math.max(l.maxTile, run.maxTile || 0);
      Lifetime.save(l);
      return l;
    },
    games: function () { return Lifetime.load().games; },
    moves: function () { return Lifetime.load().moves; },
    chains: function () { return Lifetime.load().chains; },
    scoreTotal: function () { return Lifetime.load().score; },
    maxTile: function () { return Lifetime.load().maxTile; },
    avgScore: function () { const l = Lifetime.load(); return l.games ? Math.round(l.score / l.games) : 0; },
  };

  // ---- Achievements ----------------------------------------------------
  const ACH_KEY = "chainreaction.achievements";
  // Tiered trophies (GameVolt convention: bronze / silver / gold / platinum;
  // platinum = unlock all the rest). `test(ctx, have)` where ctx is
  // { maxTile, bestCombo, score, games }.
  // 15 bronze / 10 silver / 5 gold / 1 platinum (GameVolt convention).
  // ctx = { maxTile, bestCombo, score, moves, chains } for the current run,
  // plus lifetime { games, lifetimeMoves }.
  const DEFS = [
    // --- Bronze (15) — hit through normal early play ---
    { id: "power_on",   name: "Power On",      desc: "Make your first move",        icon: "🔌", tier: "bronze", test: function (c) { return c.moves >= 1; } },
    { id: "t32",        name: "Ignition",      desc: "Create a 32 tile",            icon: "🟡", tier: "bronze", test: function (c) { return c.maxTile >= 32; } },
    { id: "t64",        name: "Kindling",      desc: "Create a 64 tile",            icon: "🟠", tier: "bronze", test: function (c) { return c.maxTile >= 64; } },
    { id: "t128",       name: "Warm Up",       desc: "Create a 128 tile",           icon: "🔆", tier: "bronze", test: function (c) { return c.maxTile >= 128; } },
    { id: "t256",       name: "Heating Up",    desc: "Create a 256 tile",           icon: "🔥", tier: "bronze", test: function (c) { return c.maxTile >= 256; } },
    { id: "first_chain",name: "Reaction",      desc: "Trigger your first chain",    icon: "⚡", tier: "bronze", test: function (c) { return c.bestCombo >= 2; } },
    { id: "score500",   name: "First Sparks",  desc: "Score 500 in a run",          icon: "✨", tier: "bronze", test: function (c) { return c.score >= 500; } },
    { id: "score1k",    name: "Charged",       desc: "Score 1,000 in a run",        icon: "🔋", tier: "bronze", test: function (c) { return c.score >= 1000; } },
    { id: "score2k",    name: "Spark",         desc: "Score 2,000 in a run",        icon: "💡", tier: "bronze", test: function (c) { return c.score >= 2000; } },
    { id: "score3k",    name: "Reactor Online",desc: "Score 3,000 in a run",        icon: "📈", tier: "bronze", test: function (c) { return c.score >= 3000; } },
    { id: "moves25",    name: "Tinkerer",      desc: "Make 25 moves in a game",     icon: "🛠️", tier: "bronze", test: function (c) { return c.moves >= 25; } },
    { id: "moves50",    name: "Operator",      desc: "Make 50 moves in a game",     icon: "⚙️", tier: "bronze", test: function (c) { return c.moves >= 50; } },
    { id: "chains3",    name: "Cascader",      desc: "Trigger 3 chains in a game",  icon: "🌊", tier: "bronze", test: function (c) { return c.chains >= 3; } },
    { id: "games1",     name: "First Game",    desc: "Finish your first game",      icon: "🎮", tier: "bronze", test: function (c) { return c.games >= 1; } },
    { id: "games5",     name: "Getting Started",desc: "Play 5 games",               icon: "🕹️", tier: "bronze", test: function (c) { return c.games >= 5; } },
    // --- Silver (10) — committed play ---
    { id: "chain3",     name: "Chain Master",  desc: "Pull off a 3-chain",          icon: "⛓️", tier: "silver", test: function (c) { return c.bestCombo >= 3; } },
    { id: "t512",       name: "Critical Mass", desc: "Create a 512 tile",           icon: "☢️", tier: "silver", test: function (c) { return c.maxTile >= 512; } },
    { id: "t1024",      name: "Meltdown",      desc: "Create a 1024 tile",          icon: "🌋", tier: "silver", test: function (c) { return c.maxTile >= 1024; } },
    { id: "score5k",    name: "High Voltage",  desc: "Score 5,000 in a run",        icon: "⚡", tier: "silver", test: function (c) { return c.score >= 5000; } },
    { id: "score10k",   name: "Overload",      desc: "Score 10,000 in a run",       icon: "💥", tier: "silver", test: function (c) { return c.score >= 10000; } },
    { id: "chains10",   name: "Chain Reactor", desc: "Trigger 10 chains in a game", icon: "🔗", tier: "silver", test: function (c) { return c.chains >= 10; } },
    { id: "moves150",   name: "Marathon",      desc: "Make 150 moves in a game",    icon: "🏃", tier: "silver", test: function (c) { return c.moves >= 150; } },
    { id: "games15",    name: "Regular",       desc: "Play 15 games",               icon: "🎯", tier: "silver", test: function (c) { return c.games >= 15; } },
    { id: "games25",    name: "Persistent",    desc: "Play 25 games",               icon: "📅", tier: "silver", test: function (c) { return c.games >= 25; } },
    { id: "moves1k",    name: "Workhorse",     desc: "Make 1,000 moves all-time",   icon: "🧰", tier: "silver", test: function (c) { return c.lifetimeMoves >= 1000; } },
    // --- Gold (5) — mastery ---
    { id: "t2048",      name: "Breakthrough",  desc: "Reach the 2048 tile",         icon: "🏆", tier: "gold", test: function (c) { return c.maxTile >= 2048; } },
    { id: "t4096",      name: "Singularity",   desc: "Reach the 4096 tile",         icon: "🌀", tier: "gold", test: function (c) { return c.maxTile >= 4096; } },
    { id: "score25k",   name: "Overdrive",     desc: "Score 25,000 in a run",       icon: "🔋", tier: "gold", test: function (c) { return c.score >= 25000; } },
    { id: "score50k",   name: "Legend",        desc: "Score 50,000 in a run",       icon: "👑", tier: "gold", test: function (c) { return c.score >= 50000; } },
    { id: "chains25",   name: "Chain Storm",   desc: "Trigger 25 chains in a game", icon: "🌪️", tier: "gold", test: function (c) { return c.chains >= 25; } },
    // --- Platinum (1) — the cap ---
    { id: "platinum",   name: "Reactor Core",  desc: "Unlock every other trophy",   icon: "💎", tier: "platinum", test: function (c, have) { return PLAT_REQ.every(function (id) { return have.indexOf(id) !== -1; }); } },
  ];
  const PLAT_REQ = DEFS.filter(function (d) { return d.tier !== "platinum"; }).map(function (d) { return d.id; });
  const Achievements = {
    defs: DEFS,
    // Returns only ids that still exist in DEFS — stale ids from older
    // versions are silently dropped so counts stay accurate.
    unlocked: function () {
      var arr;
      try { arr = JSON.parse(localStorage.getItem(ACH_KEY)); } catch (e) { return []; }
      if (!Array.isArray(arr)) return [];
      var known = {};
      DEFS.forEach(function (d) { known[d.id] = 1; });
      return arr.filter(function (id) { return known[id]; });
    },
    _save: function (arr) { try { localStorage.setItem(ACH_KEY, JSON.stringify(arr)); } catch (e) { /* ignore */ } },
    isUnlocked: function (id) { return Achievements.unlocked().indexOf(id) !== -1; },
    // Evaluates all achievements against ctx; returns newly unlocked defs.
    check: function (ctx) {
      const have = Achievements.unlocked();
      const newly = [];
      DEFS.forEach(function (d) {
        // `have` grows during the pass, so platinum can unlock in the same
        // check that completes the set (it's defined last).
        if (have.indexOf(d.id) === -1 && d.test(ctx, have)) {
          have.push(d.id);
          newly.push(d);
        }
      });
      if (newly.length) Achievements._save(have);
      return newly;
    },
    // Definitions annotated with unlocked flag, for the achievements screen.
    list: function () {
      const have = Achievements.unlocked();
      return DEFS.map(function (d) {
        return { id: d.id, name: d.name, desc: d.desc, icon: d.icon, tier: d.tier, unlocked: have.indexOf(d.id) !== -1 };
      });
    },
    count: function () { return Achievements.unlocked().length; },
    total: function () { return DEFS.length; },
    // Dev/QA helpers.
    unlockAll: function () { Achievements._save(DEFS.map(function (d) { return d.id; })); },
    reset: function () { try { localStorage.removeItem(ACH_KEY); } catch (e) { /* ignore */ } },
  };

  // ---- Run goals -------------------------------------------------------
  // Ephemeral per-run mini-objectives. ctx = { maxTile, bestCombo, score,
  // moves, chains } for the current run.
  const GOAL_POOL = [
    { id: "reach256",  label: "Reach a 256 tile",      test: function (c) { return c.maxTile >= 256; } },
    { id: "reach512",  label: "Reach a 512 tile",      test: function (c) { return c.maxTile >= 512; } },
    { id: "reach1024", label: "Reach a 1024 tile",     test: function (c) { return c.maxTile >= 1024; } },
    { id: "chains3",   label: "Trigger 3 chains",      test: function (c) { return c.chains >= 3; } },
    { id: "chains6",   label: "Trigger 6 chains",      test: function (c) { return c.chains >= 6; } },
    { id: "combo3",    label: "Pull off a 3-chain",    test: function (c) { return c.bestCombo >= 3; } },
    { id: "score2k",   label: "Score 2,000",           test: function (c) { return c.score >= 2000; } },
    { id: "score5k",   label: "Score 5,000",           test: function (c) { return c.score >= 5000; } },
    { id: "moves40",   label: "Make 40 moves",         test: function (c) { return c.moves >= 40; } },
  ];
  const RunGoals = {
    // Returns `n` distinct goals (shuffled copy of the pool).
    pick: function (n) {
      const a = GOAL_POOL.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a.slice(0, n || 3).map(function (g) {
        return { id: g.id, label: g.label, test: g.test, done: false };
      });
    },
  };

  CR.HighScores = HighScores;
  CR.Lifetime = Lifetime;
  CR.Achievements = Achievements;
  CR.RunGoals = RunGoals;
})((window.CR = window.CR || {}));
