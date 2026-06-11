# Architecture

## File map

```
index.html            Entry point + page layout (full-bleed canvas + floating UI)
src/
  sim.ts              PURE encounter sim: types, decide(), step() — one fight
  sim.test.ts         Vitest unit tests for the encounter sim (colocated)
  delve.ts            PURE delve state machine: navigate + fight + clear a dungeon
  delve.test.ts       Vitest tests for the delve loop
  dungeon.ts          PURE seeded procedural dungeon generation (rooms + corridors)
  dungeon.test.ts     Vitest tests for generation (pinned to seeds)
  rng.ts              Seeded PRNG (mulberry32) + int/range/pick/shuffle helpers
  rng.test.ts         Vitest tests for the PRNG (reproducibility)
  levels.ts           Level configs + first-clear / Insight tracking (meta)
  levels.test.ts      Vitest tests for level clearing
  protocol.ts         PURE rule compiler: editor rows → the model the sim consumes
  protocol.test.ts    Vitest tests for the compiler (defaults can't drift)
  shop.ts             Unlockable vocabulary (the Insight economy / Trainer)
  shop.test.ts        Vitest tests for buy/own/afford
  buildings.ts        Town building layout + hit-testing (clickable buildings)
  buildings.test.ts   Vitest tests for the hit-test
  save.ts             localStorage save/load (slots) — defensive, owns storage I/O
  save.test.ts        Vitest tests for save/load + slots (in-memory KVStore)
  music.ts            Web Audio music director (3 themes, cross-faded by state)
  sfx.ts              Combat sound effects (one clip per new battle-log entry)
  render.ts           PURE view: draws the camp / delve onto the canvas
  sprites.ts          Pixel-art sprites generated in code (hero, slime)
  dom.ts              Tiny typed DOM helpers (requireElement, require2dContext)
  main.ts             Wiring: screens, editors (DOM), game loop, journal, save
  style.css           UI styling
  audio/              Suno theme OGGs (camp / run / boss) + golem SFX
vite.config.ts        base: './' (GitHub Pages) + Vitest config
docs/
  VISION.md           North star — what & why
  ROADMAP.md          Build order, design rules, planned slices
  VOCABULARY.md       The shared terms (Procedure / Protocol / State / Maneuver …)
  progress/           Verification screenshots, one per slice
.github/workflows/
  deploy.yml          Build + publish dist/ to the gh-pages branch (Pages serves it)
```

## Pure layers: encounter, delve, dungeon

Game logic lives in **pure** modules (no DOM, canvas, timers, or ambient
randomness — same inputs always give the same outputs):

- `sim.ts` — the **encounter**: one fight. `decide(self, units)` is the rule
  engine; `step(state)` advances one unit-action.
- `delve.ts` — the **delve**: the party auto-navigates a seeded dungeon, fights
  the packs it meets, and hunts the target. `stepDelve(state)` advances one
  delve-step (an exploration move, or one battle-step while a fight is live).
- `dungeon.ts` — **generation**: `generateDungeon(seed, level)` lays out rooms and
  corridors deterministically from a seed.
- `rng.ts` — the **seeded PRNG** (mulberry32) every other pure module draws from.

`main.ts` owns the only mutable loop and the town ↔ delve UI. A launched delve is
autonomous: the player authors Procedures (combat) and Protocols (exploration) in
town, descends, and lives with the result — then reads the journal and iterates.

**No offline progress.** A delve resumes in real time exactly where it was saved;
time away never advances it. `save.ts` stamps each snapshot with `savedAt`, but
that timestamp is only metadata for the slot-select screen — it is *not* replayed
into the sim. (An earlier design fast-forwarded delves by elapsed wall-clock; that
was removed. Determinism still matters for the journal and for tests, just not for
catch-up.)

Why purity matters:

1. **Testability that can't lie.** Pure functions are tested against hand-computed
   expected values (see "Testing" below).
2. **Reproducibility = diagnosis.** The journal is only trustworthy because the sim
   is reproducible. All dice flow through the seeded PRNG (`rng.ts`), never
   `Math.random`; the one entropy source is the per-delve seed minted in `main.ts`
   (the impure shell) at Descend.

The renderer (`render.ts`) is a **pure view**: it reads state and draws it, never
mutating anything.

### RNG architecture (decision — to honour as dice arrive)

Today a single mulberry32 stream inside `generateDungeon` drives all randomness,
and `stepDelve` / `sim.ts` are fully deterministic (no rng input). That is fine
while only generation rolls dice, but it is **call-order-coupled**: adding one draw
anywhere reshuffles every later roll and changes existing layouts + seed-pinned
tests.

When combat/loot/events need dice, **split the stream per system** rather than
sharing one: at `startDelve`, derive independent seeds via `nextSeed` (`rng.ts`)
for a generation stream, a combat stream, an event/loot stream, etc., and thread
each into its own subsystem. That way a new combat roll never perturbs exploration
or loot. Do **not** add rng state fields before something actually consumes them —
write-but-never-read state is a trap (`delve.rng` is currently exactly that).

## Testing philosophy

A passing test is worthless if it doesn't fail when the logic breaks. We:

- test the pure `decide`/`step`/`stepDelve`/generation against **hand-verified**
  results,
- always cover **boundaries** (e.g. exactly 30% must *not* count as "below 30%"),
- periodically **mutate the code** (e.g. `<` → `<=`) to confirm a test goes red,
  then restore.

Run `npm test`. The DOM-heavy modules (`main.ts`, `render.ts`, audio) have no unit
tests — prove changes there by running the app and screenshotting (`docs/progress/`).

## Conventions

- **English everywhere** in code, comments, UI strings, docs, commits, issues.
- **No `innerHTML` for anything a player can author.** The rule editor is built
  with DOM APIs; the decision log escapes dynamic text (`esc()` in `main.ts`).
- **GitHub Pages friendliness:** keep `base: './'` so asset paths stay relative;
  verify the *production build* (`npm run build`), not just the dev server.
- **Build in tiny verified slices**, attacking the riskiest unknown first, and
  prove each slice by running it in a browser (screenshot in `docs/progress/`).
