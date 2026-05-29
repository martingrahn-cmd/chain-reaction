/* Chain Reaction — core logic + state (no rendering, no animation).
 * This file is the heart of the game. Keep it pure and readable.
 *
 * Board model:
 *   - board is a flat Array(16), index = row*4 + col, holding a tile object or null.
 *   - row = Math.floor(index/4), col = index % 4.
 *
 * Tile model:
 *   { id, value, row, col, isNew }
 *   Unique ids let the render layer track individual tiles across frames.
 */
(function (CR) {
  "use strict";

  // --- Tile factory -------------------------------------------------------
  let nextTileId = 1;
  function makeTile(value, row, col) {
    return { id: nextTileId++, value: value, row: row | 0, col: col | 0, isNew: false };
  }

  // --- Direction line maps ------------------------------------------------
  // Each line is an array of 4 board-indices ordered so the LAST element is
  // the wall the tiles slide toward. Tiles compact and merge from that wall.
  function buildLines() {
    const right = [], left = [], down = [], up = [];
    for (let r = 0; r < 4; r++) {
      const row = [r * 4 + 0, r * 4 + 1, r * 4 + 2, r * 4 + 3];
      right.push(row.slice());        // wall = col 3
      left.push(row.slice().reverse()); // wall = col 0
    }
    for (let c = 0; c < 4; c++) {
      const col = [0 * 4 + c, 1 * 4 + c, 2 * 4 + c, 3 * 4 + c];
      down.push(col.slice());         // wall = row 3
      up.push(col.slice().reverse()); // wall = row 0
    }
    return { right, left, down, up };
  }
  const LINES = buildLines();

  // --- Single slide pass --------------------------------------------------
  // Slides every line of `board` toward the direction wall, merging adjacent
  // equal pairs (each tile merges at most once). Returns the resulting board
  // plus the movement/merge data the renderer needs. Does not spawn.
  function slideBoard(board, dir) {
    const lines = LINES[dir];
    const newBoard = new Array(16).fill(null);
    const slides = []; // { id, value, from:{r,c}, to:{r,c} }
    const merges = []; // { newId, value, at:{r,c}, sourceIds:[a,b] }
    let moved = false;

    for (const line of lines) {
      // Tiles in this line, ordered far-from-wall -> wall.
      const tiles = [];
      for (const idx of line) {
        if (board[idx]) tiles.push(board[idx]);
      }

      // Build the merged sequence, scanning from the wall side (end).
      const out = []; // entries: { tile, sources: [a,b] | null }
      let i = tiles.length - 1;
      while (i >= 0) {
        if (i > 0 && tiles[i].value === tiles[i - 1].value) {
          const merged = makeTile(tiles[i].value * 2, 0, 0);
          out.unshift({ tile: merged, sources: [tiles[i - 1], tiles[i]] });
          i -= 2;
        } else {
          out.unshift({ tile: tiles[i], sources: null });
          i -= 1;
        }
      }

      // Place the sequence right-aligned against the wall.
      const offset = 4 - out.length;
      for (let k = 0; k < out.length; k++) {
        const boardIdx = line[offset + k];
        const r = Math.floor(boardIdx / 4);
        const c = boardIdx % 4;
        const entry = out[k];

        newBoard[boardIdx] = entry.tile;

        if (entry.sources) {
          for (const s of entry.sources) {
            slides.push({ id: s.id, value: s.value, from: { r: s.row, c: s.col }, to: { r: r, c: c } });
          }
          entry.tile.row = r;
          entry.tile.col = c;
          merges.push({
            newId: entry.tile.id,
            value: entry.tile.value,
            at: { r: r, c: c },
            sourceIds: [entry.sources[0].id, entry.sources[1].id],
          });
          moved = true;
        } else {
          const t = entry.tile;
          if (t.row !== r || t.col !== c) moved = true;
          slides.push({ id: t.id, value: t.value, from: { r: t.row, c: t.col }, to: { r: r, c: c } });
          t.row = r;
          t.col = c;
        }
      }
    }

    return { newBoard: newBoard, slides: slides, merges: merges, moved: moved };
  }

  // --- Full move with cascading chain reaction ----------------------------
  // Repeatedly slides in the SAME direction. The first slide is step 1; each
  // further slide that produces merges is the next combo step. Stops when a
  // slide yields no merges. Returns an animation "plan" of phases.
  function computeMove(startBoard, dir) {
    const phases = []; // { slides, merges, combo, phaseScore }
    let board = startBoard.slice();
    let totalScore = 0;
    let step = 0;

    while (true) {
      const res = slideBoard(board, dir);
      if (!res.moved) break;

      let combo = 0;
      let phaseScore = 0;
      if (res.merges.length > 0) {
        step += 1;
        combo = step;
        let mergeSum = 0;
        for (const m of res.merges) mergeSum += m.value;
        phaseScore = mergeSum * step; // combo multiplier = step number
        totalScore += phaseScore;
      }

      phases.push({ slides: res.slides, merges: res.merges, combo: combo, phaseScore: phaseScore });
      board = res.newBoard;

      // A pure shift (no merge) can only be the very first phase; no chain.
      if (res.merges.length === 0) break;
    }

    return {
      moved: phases.length > 0,
      phases: phases,
      finalBoard: board,
      totalScore: totalScore,
      chainLength: step,
    };
  }

  // --- Spawning -----------------------------------------------------------
  function spawnRandom(board, chance4) {
    const empties = [];
    for (let i = 0; i < 16; i++) if (!board[i]) empties.push(i);
    if (empties.length === 0) return null;
    const idx = empties[(Math.random() * empties.length) | 0];
    const value = Math.random() < (chance4 == null ? 0.1 : chance4) ? 4 : 2;
    const tile = makeTile(value, Math.floor(idx / 4), idx % 4);
    tile.isNew = true;
    board[idx] = tile;
    return tile;
  }

  // --- Game over detection ------------------------------------------------
  function canMove(board) {
    for (let i = 0; i < 16; i++) if (!board[i]) return true;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = board[r * 4 + c].value;
        if (c < 3 && board[r * 4 + c + 1].value === v) return true;
        if (r < 3 && board[(r + 1) * 4 + c].value === v) return true;
      }
    }
    return false;
  }

  // --- Persistence --------------------------------------------------------
  const LS_BEST = "chainreaction.bestScore";
  const LS_CHAIN = "chainreaction.longestChain";
  function loadNumber(key) {
    try {
      const v = parseInt(localStorage.getItem(key) || "0", 10);
      return isNaN(v) ? 0 : v;
    } catch (e) {
      return 0;
    }
  }
  function saveNumber(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
      /* ignore */
    }
  }

  // --- Game ---------------------------------------------------------------
  const LS_EASY = "chainreaction.easyMode";
  const LS_STATE = "chainreaction.gameState"; // in-progress board + score + stats

  // Per-game progression stats. Not shown yet — hooks for achievements,
  // an end screen, and balance tuning.
  function freshStats() {
    return { moves: 0, maxTile: 0, chainsTriggered: 0, bestComboThisGame: 0 };
  }

  function Game() {
    this.board = new Array(16).fill(null);
    this.score = 0;
    this.bestScore = loadNumber(LS_BEST);
    this.longestChain = loadNumber(LS_CHAIN);
    this.isGameOver = false;
    this.has2048 = false;
    this.history = []; // recent { cells, score } snapshots for multi-step undo
    this.stats = freshStats();
    try {
      this.easyMode = localStorage.getItem(LS_EASY) === "1";
    } catch (e) {
      this.easyMode = false;
    }
    this._applyDifficulty();
    this.undosRemaining = this.maxUndos;
  }

  // Easy mode: gentler spawns (fewer 4s) and more undos. Normal mode keeps
  // the MVP-spec values (10% fours, 1 undo).
  Game.prototype._applyDifficulty = function () {
    this.spawn4Chance = this.easyMode ? 0.04 : 0.1;
    this.maxUndos = this.easyMode ? 3 : 1;
  };

  Game.prototype.setEasy = function (on) {
    this.easyMode = !!on;
    try {
      localStorage.setItem(LS_EASY, this.easyMode ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
    this._applyDifficulty();
  };

  Game.prototype.newGame = function () {
    this.board = new Array(16).fill(null);
    this.score = 0;
    this.isGameOver = false;
    this.has2048 = false;
    this.undosRemaining = this.maxUndos;
    this.history = [];
    this.stats = freshStats();
    spawnRandom(this.board, this.spawn4Chance);
    spawnRandom(this.board, this.spawn4Chance);
    this.save();
  };

  // Snapshot just the values+positions so undo is independent of live tiles.
  Game.prototype._snapshot = function () {
    const cells = this.board.map(function (t) {
      return t ? { value: t.value, row: t.row, col: t.col } : null;
    });
    return { cells: cells, score: this.score };
  };

  // Performs a move. Returns the animation plan, or null if nothing moved.
  Game.prototype.move = function (dir) {
    if (this.isGameOver) return null;

    const snap = this._snapshot();
    const plan = computeMove(this.board, dir);
    if (!plan.moved) return null;

    // Commit the move. Keep a short history so undo can step back several
    // moves in a row (up to maxUndos), not just the most recent one.
    this.history.push(snap);
    if (this.history.length > this.maxUndos) this.history.shift();
    this.score += plan.totalScore;
    this.board = plan.finalBoard;
    plan.spawn = spawnRandom(this.board, this.spawn4Chance);

    // Stats.
    if (plan.chainLength > this.longestChain) {
      this.longestChain = plan.chainLength;
      saveNumber(LS_CHAIN, this.longestChain);
    }
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      saveNumber(LS_BEST, this.bestScore);
    }
    for (let i = 0; i < 16; i++) {
      if (this.board[i] && this.board[i].value >= 2048) this.has2048 = true;
    }

    // Progression stats.
    this.stats.moves += 1;
    if (plan.chainLength >= 2) this.stats.chainsTriggered += 1;
    if (plan.chainLength > this.stats.bestComboThisGame) this.stats.bestComboThisGame = plan.chainLength;
    for (let i = 0; i < 16; i++) {
      if (this.board[i] && this.board[i].value > this.stats.maxTile) this.stats.maxTile = this.board[i].value;
    }

    if (!canMove(this.board)) this.isGameOver = true;
    this.save();
    return plan;
  };

  Game.prototype.canUndo = function () {
    return this.undosRemaining > 0 && this.history.length > 0;
  };

  // Steps one move back. Can be called repeatedly to undo several moves in a
  // row, up to the remaining budget / available history.
  Game.prototype.undo = function () {
    if (!this.canUndo()) return false;
    const snap = this.history.pop();
    this.board = snap.cells.map(function (c) {
      return c ? makeTile(c.value, c.row, c.col) : null;
    });
    this.score = snap.score;
    this.undosRemaining -= 1;
    this.isGameOver = false;
    this.save();
    return true;
  };

  // --- Persist an in-progress game so the player can close and resume ----
  Game.prototype.save = function () {
    try {
      if (this.isGameOver) { localStorage.removeItem(LS_STATE); return; }
      localStorage.setItem(LS_STATE, JSON.stringify({
        v: 1,
        cells: this.board.map(function (t) { return t ? t.value : 0; }),
        score: this.score,
        has2048: this.has2048,
        undosRemaining: this.undosRemaining,
        stats: this.stats,
      }));
    } catch (e) { /* ignore */ }
  };

  // Restores a saved game. Returns true if a valid game was loaded.
  Game.prototype.load = function () {
    try {
      const raw = localStorage.getItem(LS_STATE);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1 || !Array.isArray(s.cells) || s.cells.length !== 16) return false;
      // Coerce cells to clean tile values; ignore anything non-positive.
      const cells = s.cells.map(function (v) { v = Math.round(+v) || 0; return v >= 2 ? v : 0; });
      if (!cells.some(function (v) { return v; })) return false;
      this.board = cells.map(function (v, i) {
        return v ? makeTile(v, Math.floor(i / 4), i % 4) : null;
      });
      this.score = s.score || 0;
      this.has2048 = !!s.has2048;
      this.undosRemaining = s.undosRemaining != null ? s.undosRemaining : this.maxUndos;
      this.history = []; // undo history doesn't carry across sessions
      this.isGameOver = false;
      this.stats = s.stats || freshStats();
      return true;
    } catch (e) {
      return false;
    }
  };

  Game.prototype.clearSaved = function () {
    try { localStorage.removeItem(LS_STATE); } catch (e) { /* ignore */ }
  };

  // Expose.
  CR.makeTile = makeTile;
  CR.computeMove = computeMove;
  CR.slideBoard = slideBoard;
  CR.canMove = canMove;
  CR.spawnRandom = spawnRandom;
  CR.Game = Game;

  // --- Console test harness (verification cases from the kick-off doc) ----
  // Run CR.runTests() in the browser console after step 3.
  function lineToBoardRight(values) {
    // Places a 4-value array into row 0 of an otherwise empty board.
    const board = new Array(16).fill(null);
    for (let c = 0; c < 4; c++) {
      if (values[c] != null) board[c] = makeTile(values[c], 0, c);
    }
    return board;
  }
  function boardRow0(board) {
    return [0, 1, 2, 3].map(function (c) {
      return board[c] ? board[c].value : null;
    });
  }
  function boardFrom(arr) {
    return arr.map(function (v, i) { return v ? makeTile(v, Math.floor(i / 4), i % 4) : null; });
  }
  function values(board) {
    return board.map(function (t) { return t ? t.value : 0; });
  }

  CR.runTests = function () {
    let pass = 0, fail = 0;
    function check(name, cond, extra) {
      if (cond) { pass++; console.log("PASS " + name); }
      else { fail++; console.log("FAIL " + name + (extra ? "  " + extra : "")); }
    }

    // Math.random mock (FIFO queue, falls back to real once drained).
    const realRandom = Math.random;
    function mockRandom(seq) {
      let i = 0;
      Math.random = function () { return i < seq.length ? seq[i++] : realRandom(); };
    }

    // Isolate the Game's localStorage keys so running tests never clobbers a
    // real in-progress game / best score.
    const KEYS = ["chainreaction.gameState", "chainreaction.bestScore", "chainreaction.longestChain", "chainreaction.easyMode"];
    const backup = {};
    KEYS.forEach(function (k) { try { backup[k] = localStorage.getItem(k); } catch (e) {} });
    KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });

    console.log("%c Chain Reaction — regression suite", "font-weight:bold");
    try {
      // 1) Slide-right line cases (incl. the kick-off verification table).
      const cases = [
        { in: [2, 2, 2, 2], expect: [null, null, null, 8], combo: 2 },
        { in: [4, 2, 2, 4], expect: [null, null, 4, 8], combo: 2 }, // doc table wrong; sum must stay 12
        { in: [2, null, null, 2], expect: [null, null, null, 4], combo: 1 },
        { in: [2, 2, 4, 4], expect: [null, null, 4, 8], combo: 1 }, // doc table wrong; sum must stay 12
        { in: [4, null, 4, null], expect: [null, null, null, 8], combo: 1 },
      ];
      cases.forEach(function (tc) {
        const plan = computeMove(lineToBoardRight(tc.in), "right");
        const result = boardRow0(plan.finalBoard);
        check("right " + JSON.stringify(tc.in),
          JSON.stringify(result) === JSON.stringify(tc.expect) && plan.chainLength === tc.combo,
          "got " + JSON.stringify(result) + " x" + plan.chainLength);
      });

      // 2) All four directions merge toward the correct wall.
      // right: [2,2,_,_] -> 4 at index 3
      check("dir right", values(computeMove(boardFrom([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "right").finalBoard)[3] === 4);
      // left: [_,_,2,2] -> 4 at index 0
      check("dir left", values(computeMove(boardFrom([0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "left").finalBoard)[0] === 4);
      // up: col0 rows2,3 -> 4 at index 0
      check("dir up", values(computeMove(boardFrom([0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]), "up").finalBoard)[0] === 4);
      // down: col0 rows0,1 -> 4 at index 12
      check("dir down", values(computeMove(boardFrom([2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "down").finalBoard)[12] === 4);

      // 3) Undo restores the exact pre-move board and score.
      (function () {
        const g = new Game();
        g.board = boardFrom([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        g.score = 0; g.undosRemaining = 1; g.history = []; g.isGameOver = false;
        const before = values(g.board);
        mockRandom([0, 0]); // deterministic spawn
        const plan = g.move("right");
        const movedOk = !!plan && g.score === 4;
        g.undo();
        check("undo restores board+score", movedOk && JSON.stringify(values(g.board)) === JSON.stringify(before) && g.score === 0);
      })();

      // 3b) Multi-step undo: three moves back, three undos, full restore.
      (function () {
        const g = new Game();
        g.maxUndos = 3; g.undosRemaining = 3; g.history = []; g.isGameOver = false;
        g.board = boardFrom([2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        g.score = 0;
        const before = values(g.board);
        mockRandom([0, 0, 0, 0, 0, 0]); // deterministic spawns across moves
        g.move("up"); g.move("left"); g.move("down");
        const movedThrice = g.history.length === 3;
        g.undo(); g.undo(); g.undo();
        check("multi-step undo (3 back)",
          movedThrice && g.undosRemaining === 0 && g.history.length === 0 &&
          JSON.stringify(values(g.board)) === JSON.stringify(before) && g.score === 0);
      })();

      // 4) Easy-mode spawn chance honours spawn4Chance via mocked random.
      mockRandom([0, 0.03]);
      check("easy: roll 0.03 < 0.04 -> 4", spawnRandom(new Array(16).fill(null), 0.04).value === 4);
      mockRandom([0, 0.05]);
      check("easy: roll 0.05 >= 0.04 -> 2", spawnRandom(new Array(16).fill(null), 0.04).value === 2);
      mockRandom([0, 0.05]);
      check("normal: roll 0.05 < 0.1 -> 4", spawnRandom(new Array(16).fill(null), 0.1).value === 4);

      // 5) Game over after the spawn fills the last cell with no moves left.
      (function () {
        const g = new Game();
        g.board = boardFrom([2, 4, 2, 4, 4, 8, 4, 8, 2, 4, 2, 4, 8, 8, 4, 8]);
        g.score = 0; g.isGameOver = false; g.has2048 = false; g.undosRemaining = 1; g.history = [];
        mockRandom([0, 0.05]); // only one empty after the merge; value 4 -> dead board
        const plan = g.move("right");
        check("game over after spawn", !!plan && g.isGameOver === true);
      })();

      // 6) Win + game over on the same move (reach 2048 onto a dead board).
      (function () {
        const g = new Game();
        g.board = boardFrom([2, 4, 2, 4, 4, 8, 4, 8, 2, 4, 2, 4, 1024, 1024, 4, 8]);
        g.score = 0; g.isGameOver = false; g.has2048 = false; g.undosRemaining = 1; g.history = [];
        mockRandom([0, 0.05]); // spawn 4 into the freed cell -> dead
        const plan = g.move("right");
        check("win + game over edge case", !!plan && g.has2048 === true && g.isGameOver === true);
      })();

      // Static game-over detection.
      check("game-over detection", !canMove(boardFrom([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])));
    } finally {
      Math.random = realRandom;
      KEYS.forEach(function (k) {
        try {
          if (backup[k] == null) localStorage.removeItem(k);
          else localStorage.setItem(k, backup[k]);
        } catch (e) {}
      });
    }

    console.log("%c " + pass + "/" + (pass + fail) + " tests passed", "font-weight:bold;color:" + (fail ? "#ff5a2a" : "#27e07a"));
    return fail === 0;
  };
})((window.CR = window.CR || {}));
