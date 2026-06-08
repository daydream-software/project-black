# Architecture

## File map

```
index.html            Entry point + page layout (canvas left, gambit editor right)
src/
  sim.ts              PURE simulation: types, decide(), step(), conditions
  sim.test.ts         Vitest unit tests for the simulation (colocated)
  render.ts           PURE view: draws a GameState onto the canvas
  sprites.ts          Pixel-art sprites generated in code (hero, slime)
  main.ts             Wiring: gambit editor (DOM), game loop, decision log
  style.css           UI styling
vite.config.ts        base: './' (GitHub Pages) + Vitest config
docs/
  ROADMAP.md          Vision, design rules, planned slices
  progress/           Verification screenshots, one per slice
.github/workflows/
  deploy.yml          Build + publish dist/ to GitHub Pages
```

## Core principle: a pure deterministic simulation

All game logic lives in `src/sim.ts` as **pure functions** — no DOM, no canvas,
no timers, no randomness. Given the same inputs they always return the same
outputs.

- `decide(self, enemy, program)` — a **FF12 gambit engine**: scans gambits
  top-to-bottom, the first whose condition holds wins. This is the heart of the
  game; the player programs by ordering gambits.
- `step(state, program)` — advances one turn and returns a *new* state.

Why this matters:

1. **Testability that can't lie.** Pure functions are tested against hand-computed
   expected values (see "Testing" below).
2. **AFK offline catch-up is trivial later** — just replay `step` N times for the
   elapsed seconds.
3. **Determinism.** When dice / D&D randomness arrive, use a **seeded PRNG**
   (passed through state) so runs stay reproducible and offline catch-up matches
   online play.

The renderer (`render.ts`) is a **pure view**: it reads state and draws it, never
mutating anything. `main.ts` owns the only mutable loop.

## Testing philosophy

A passing test is worthless if it doesn't fail when the logic breaks. We:

- test the pure `decide`/`step`/`conditionHolds` against **hand-verified** results,
- always cover **boundaries** (e.g. exactly 30% must *not* count as "below 30%"),
- periodically **mutate the code** (e.g. `<` → `<=`) to confirm a test goes red,
  then restore.

Run `npm test`.

## Conventions

- **English everywhere** in code, comments, UI strings, docs, commits, issues.
- **No `innerHTML` for anything a player can author.** The gambit editor is built
  with DOM APIs; the decision log escapes dynamic text (`esc()` in `main.ts`).
- **GitHub Pages friendliness:** keep `base: './'` so asset paths stay relative;
  verify the *production build* (`npm run build`), not just the dev server.
- **Build in tiny verified slices**, attacking the riskiest unknown first, and
  prove each slice by running it in a browser (screenshot in `docs/progress/`).
