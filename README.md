# Chain Reaction

A juice-driven take on 2048. Classic 4×4 sliding and merging, with a signature
twist: **auto-cascading chain reactions**. When a merge creates a new match, it
cascades on its own with a rising combo multiplier, sound, and escalating visual
intensity.

*2048 meets Block Blast — chain reactions, neon, juice.*

## Play

Open `index.html` in a browser, or play the deployed version.

- **Move:** swipe (touch) or arrow keys / WASD
- **Goal:** reach the 2048 tile
- **Chains:** a merge that creates another match auto-cascades for bonus score

Tap **?** in-game for the tutorial and difficulty (Normal / Easy).

## Tech

Vanilla JS + Canvas 2D, Web Audio API (procedural sound), `localStorage` for
best score, longest chain, difficulty, and an in-progress game. No build step,
no dependencies.

| File | Role |
|------|------|
| `index.html` | markup + controller/bootstrap |
| `game.js` | core logic, state, chain reactions, persistence |
| `render.js` | canvas rendering + animation |
| `particles.js` | particle system |
| `audio.js` | procedural audio + mix table |
| `style.css` | layout + neon styling |

Accessibility: respects `prefers-reduced-motion`. Mobile: touch input and
haptics where supported.

Append `?dev` to the URL for a small panel of test/preset buttons.
