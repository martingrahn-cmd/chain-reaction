/* Chain Reaction — meta layer: high scores, lifetime counters, achievements.
 * Pure data + localStorage. No rendering. Consumed by the controller.
 */
(function (CR) {
  "use strict";

  // ---- High scores -----------------------------------------------------
  const HS_KEY = "chainreaction.highscores";
  const HS_MAX = 10;
  const HighScores = {
    load: function () {
      try { return JSON.parse(localStorage.getItem(HS_KEY)) || []; }
      catch (e) { return []; }
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
      try { return JSON.parse(localStorage.getItem(LIFE_KEY)) || {}; }
      catch (e) { return {}; }
    },
    save: function (o) { try { localStorage.setItem(LIFE_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } },
    // Records one finished run into the lifetime totals.
    record: function (moves, chains) {
      const l = Lifetime.load();
      l.games = (l.games || 0) + 1;
      l.moves = (l.moves || 0) + (moves || 0);
      l.chains = (l.chains || 0) + (chains || 0);
      Lifetime.save(l);
      return l;
    },
    games: function () { return Lifetime.load().games || 0; },
    moves: function () { return Lifetime.load().moves || 0; },
    chains: function () { return Lifetime.load().chains || 0; },
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
    unlocked: function () {
      try { return JSON.parse(localStorage.getItem(ACH_KEY)) || []; }
      catch (e) { return []; }
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
  };

  CR.HighScores = HighScores;
  CR.Lifetime = Lifetime;
  CR.Achievements = Achievements;
})((window.CR = window.CR || {}));
