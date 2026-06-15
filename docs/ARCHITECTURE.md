# Architecture

## File map

```
index.html            Entry point + page layout (full-bleed canvas + floating UI)
src/
  sim.ts              PURE encounter sim: types, decide(), step() — one fight
  sim.test.ts         Vitest unit tests for the encounter sim (colocated)
  combat-core.ts      PURE stat→number primitives (attackDamage/healAmount/overdraw/
                      recovery/poolFor + constants); a leaf so content can use them
                      without a sim↔content cycle. sim.ts re-exports them.
  content/            EXTENSIBLE game content — one file per item, glob-assembled
    registry.ts       Option<T> + collect()/indexById()/mapById() (the assemblers)
    subjects/ predicates/         combat State vocabulary (one Option per file)
    exploration/{subjects,predicates,moves}/   delve vocabulary
    skills/           mend.ts/defend.ts: a SkillDef per file (editor face + effect)
    monsters/         slime.ts/hex-warden.ts: a MonsterDef (stat block) per file
  delve.ts            PURE delve state machine: navigate + fight + clear a dungeon
  delve.test.ts       Vitest tests for the delve loop
  dungeon.ts          PURE seeded procedural dungeon generation (rooms + corridors)
  dungeon.test.ts     Vitest tests for generation (pinned to seeds)
  rng.ts              Seeded PRNG (mulberry32) + int/range/pick/shuffle helpers
  rng.test.ts         Vitest tests for the PRNG (reproducibility)
  levels.ts           Level configs + first-clear / Insight tracking (meta)
  levels.test.ts      Vitest tests for level clearing
  protocol.ts         PURE rule compiler: editor rows → the model the sim consumes
                      (the vocabulary catalogs now live in content/; this re-exports
                      them and holds only the row→Protocol compiler + helpers)
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

### Modular content (`src/content/`)

Extensible content — rule-editor vocabulary, skills, monsters — is **one file per
item**, auto-assembled per category with Vite's `import.meta.glob`, so adding content
is dropping a file in a folder (design pillar #4), never editing a central import
wall. Three load-bearing rules:

- **The glob lives only in each category's `index.ts`** (`['./*.ts','!./index.ts']`,
  `eager`, `import:'default'`). Consumers import the assembled catalog, never
  `import.meta.*`. Each item is `export default {…} satisfies <Def>` — types at the
  definition, no `as`, clean under eslint-config-love's `no-unsafe-*`.
- **`id` is the save contract; `order` is explicit.** Persisted rows reference items
  by `id`, so a file's *name* is cosmetic but its `id` must never change. Glob keys
  sort by filename, not intent — so every vocabulary item carries an `order` and
  `collect()` sorts on it. (Monster runtime ids aren't persisted, so the bestiary is
  keyed by a free-form `id`.)
- **Assemblers (`registry.ts`):** `collect` → ordered list (dropdowns); `indexById`
  → by-id record for keys you control (the bestiary, `MONSTERS.slime`); `mapById` →
  by-id **Map** for keys that may be stale (skills), so `.get()` returns
  `T | undefined` and a dropped item reads as inert, never a crash.

**The engine knows no variants — it only orchestrates.** All *interpretation* of the
combat vocabulary lives in content, not `sim.ts`:

- a **Subject** file carries `candidates(self, units)` + `pick(list)` (shared selectors
  and pick strategies live in `content/combat/targeting.ts`); a **Predicate** file
  carries `holds(unit)`. `resolveTarget` is just `subject.pick(subject.candidates(…)
  .filter(predicate.holds))` — filter-then-pick, nothing variant-specific.
- a **skill** carries its active `effect` (`content/skills/`).
- a passive/reactive effect is a registered **hook**: `content/combat/modifiers/` are
  damage modifiers folded into every Attack (Defending's halving is one — the skill
  sets the `defending` flag, the modifier owns what it *means*); `content/combat/
  reactions/` listen to **battle events**. The engine emits a `CombatEvent` (a
  discriminated union — `action` / `damage` / `heal`, extensible) at each natural point
  in `step`; a Reaction declares the `kind` it listens for and `react`s (mutate + log).
  The slice-4 counter-heal *wall* is just a `heal` reaction (the monster carries the
  `counterHeal` *value*, the reaction owns the *logic*). The engine folds whatever is
  registered for the event's kind and never names a specific reaction — adding a wall,
  a thorns effect, a counterspell is a new file + (if a new moment) one `emit` call,
  never an engine branch. (Exploration moments — onMove / trap — will be a sibling
  `DelveEvent` union emitted by the delve layer, same pattern.)

Content that carries *behaviour* imports its numeric primitives from `combat-core.ts`,
never from `sim.ts` — that keeps the dependency a DAG (`sim → content → combat-core`)
with no runtime cycle. Effect/reaction functions mutate the combatants the sim already
cloned (a scoped `no-param-reassign` exception, like `render.ts`'s ctx); damage
modifiers are pure (they return a number). `attackDamage` in `combat-core` is the BASE
(Might − Ward, floored); status logic is folded on top from content.

(Exploration's vocabulary — `delve.ts`'s `ExSubject/ExPredicate/ExMove` — is still
interpreted by central conditionals; the same externalisation is its own later slice.)

`main.ts` owns the only mutable loop and the town ↔ delve UI. A launched delve is
autonomous: in town the player authors two **Procedures** (ordered lists of
**Protocols** — one rule each: `WHEN State → DO Maneuver`), one driving combat and
one driving exploration, descends, and lives with the result — then reads the
journal and iterates. (Procedure = the list; Protocol = a single rule. The two are
a whole/part pair, *not* a combat/exploration split — see VOCABULARY.md.)

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
