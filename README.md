# Chain Reaction

A juice-driven take on 2048. Classic 4×4 sliding and merging, with a signature
twist: **auto-cascading chain reactions**. When a merge creates a new match, it
cascades on its own with a rising combo multiplier, escalating sound, and
intensifying visuals.

*2048 meets Block Blast — chain reactions, neon, retro-arcade juice.*

**Play:** https://martingrahn-cmd.github.io/chain-reaction/

## How to play

- **Move:** swipe (touch), arrow keys, or WASD — every tile slides at once.
- **Merge:** two tiles with the same number become one worth double.
- **Chains:** a merge that creates another match auto-cascades for bonus score.
- **Goal:** reach the 2048 tile, then keep going in endless mode.

The **☰ MENU** button (or `Esc` / `M`) opens the menu: how-to-play tutorial,
high scores, achievements, difficulty (Normal / Easy) and sound.

## Features

- Auto-cascading chains with combo multipliers and an end-of-chain payoff.
- Local **high-score** table (top 10) and **31 tiered achievements**
  (15 bronze / 10 silver / 5 gold / 1 platinum) with unlock toasts.
- In-progress games are **saved** and resumed automatically (with a "RESUMED
  RUN" notice).
- End screen with run stats (max tile, best chain, chains, moves) and a
  reactor-state rank.
- Retro arcade / CRT presentation: neon board, animated background grid with
  light pulses, scanline menus.
- **Full keyboard support** in menus (focus trap, arrows/Tab, Enter, Esc).
- Accessibility: respects `prefers-reduced-motion`. Performance: particle
  budget with low-end / FPS degrade.
- Mobile-first: safe-area aware, touch input, and haptics where supported.

## Tech

Vanilla JS + Canvas 2D, Web Audio API (procedural sound), `localStorage` for
saves/scores/achievements. **No build step and no external runtime
dependencies** — fonts are self-hosted, so it runs fully offline.

| File | Role |
|------|------|
| `index.html` | markup + controller/bootstrap |
| `game.js` | core logic, state, chain reactions, persistence, regression suite |
| `render.js` | canvas rendering + animation |
| `bg.js` | animated background grid + light pulses |
| `particles.js` | particle system |
| `audio.js` | procedural audio + mix table |
| `meta.js` | high scores, lifetime stats, achievements |
| `style.css` | layout + neon/retro styling |
| `assets/fonts/` | self-hosted Press Start 2P + VT323 (latin subset, woff2) |

## GameVolt portal

The game runs standalone, and also lights up the GameVolt portal SDK when
present (every call is guarded behind `if (window.GameVolt)`):

- `GameVolt.init("chain-reaction")` + save migration on first login
- `GameVolt.leaderboard.submit(score)` at the end of a run
- `GameVolt.achievements.unlock(id)` as trophies unlock

To ship inside the portal: include `/sdk/gamevolt.js` before the inline script,
and define the 31 achievement ids in Supabase `achievement_defs` as
`chain-reaction-<id>` (e.g. `chain-reaction-power_on`).

## Dev tools

Append `?dev` to the URL for a collapsible dev panel (bottom-left) and console
helpers. Run `dev.help()` in the console for the full list — board presets,
effect tests, `dev.unlockAll()` / `dev.resetAch()` / `dev.score(n)`, and
`dev.portalTest()`. The regression suite (`CR.runTests()`, 16 cases) runs
automatically in `?dev` mode only.
