# Architecture

## File map

```
index.html            Entry point + page layout (canvas left, rule editor right)
src/
  sim.ts              PURE encounter sim: types, decide(), step() — one fight
  sim.test.ts         Vitest unit tests for the encounter sim (colocated)
  run.ts              PURE run layer: RunState, stepRun(), catchUp() — a gauntlet
  run.test.ts         Vitest unit tests for the run layer (colocated)
  save.ts             localStorage save/load + offline catch-up math (owns the clock)
  music.ts            Web Audio music director (3 themes, cross-faded by state)
  render.ts           PURE view: draws a GameState onto the canvas (+ run HUD)
  sprites.ts          Pixel-art sprites generated in code (hero, slime)
  main.ts             Wiring: camp/run modes, rule editor (DOM), loop, journal, save
  style.css           UI styling
  audio/              The three Suno theme OGGs (camp / run / boss)
vite.config.ts        base: './' (GitHub Pages) + Vitest config
docs/
  ROADMAP.md          Vision, design rules, planned slices
  progress/           Verification screenshots, one per slice
.github/workflows/
  deploy.yml          Build + publish dist/ to the gh-pages branch (Pages serves it)
```

## Two pure layers: encounter and run

Game logic is split into two **pure** modules (no DOM, canvas, timers, or
randomness — same inputs always give the same outputs):

- `sim.ts` — the **encounter**: one fight. `decide(self, units)` is the rule
  engine; `step(state)` advances one unit-action.
- `run.ts` — the **run**: a gauntlet of encounters. `stepRun(run)` advances the
  inner battle and, when it resolves, transitions the run (carry the party to the
  next encounter, or end it cleared/dead). The party (HP, deaths) persists across
  encounters — attrition is the run's pressure. See [VISION.md](VISION.md).

`main.ts` owns the only mutable loop and the camp ↔ run UI. **Offline catch-up**
rides on this purity: `save.ts` stamps a snapshot with `savedAt`, and on the next
load `catchUp(run, elapsedSteps)` simply replays `stepRun` for the elapsed
wall-clock — deterministic replay *is* the AFK mechanic. All clock/storage I/O
lives in `save.ts`/`main.ts`; `sim.ts`/`run.ts` never see time.

- `decide(self, units)` — the **rule engine** running a unit's Procedure: it
  scans the Protocols top-to-bottom and the first whose composite State resolves
  to a target wins (inspired by FF12 gambits). The State's Subject IS the target.
  This is the heart of the game; the player programs by ordering Protocols.
- `step(state)` — advances one unit-action and returns a *new* state.
- `stepRun(run)` — advances the run (the encounter, then the gauntlet transition).

Why this matters:

1. **Testability that can't lie.** Pure functions are tested against hand-computed
   expected values (see "Testing" below).
2. **AFK offline catch-up is trivial later** — just replay `step`/`stepRun` N
   times for the elapsed seconds.
3. **Determinism = diagnosis.** The journal is only trustworthy because the sim
   is reproducible. When dice / D&D randomness arrive, use a **seeded PRNG**
   (passed through state) so runs stay reproducible.

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
- **No `innerHTML` for anything a player can author.** The rule editor is built
  with DOM APIs; the decision log escapes dynamic text (`esc()` in `main.ts`).
- **GitHub Pages friendliness:** keep `base: './'` so asset paths stay relative;
  verify the *production build* (`npm run build`), not just the dev server.
- **Build in tiny verified slices**, attacking the riskiest unknown first, and
  prove each slice by running it in a browser (screenshot in `docs/progress/`).
