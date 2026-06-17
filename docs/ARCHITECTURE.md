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
    monsters/         slime.ts/hex-warden.ts: a MonsterDef per file (stats+procedure+reaction refs)
    combat/           modifiers/ reactions/ targeting.ts procedures.ts (cross-cutting + AI helpers)
    sfx/              one sound per file, each importing its own .ogg; sfx.ts just plays them
  delve.ts            PURE delve state machine: navigate + fight + clear a dungeon
  delve.test.ts       Vitest tests for the delve loop
  mapgraph.ts         PURE seeded room-graph generation: generateGraph(level, seed)
                      → typed rooms + corridor edges (replaced the retired cell grid)
  mapgraph.test.ts    Vitest tests for generation (pinned to seeds)
  lang/               The INSCRIPTION LANGUAGE — golem brains authored in code
    lexer.ts parser.ts interp.ts   a Python-subset tree-walker (pure, sandboxed)
    combat.ts explore.ts           bind the namespace + drive sim/delve via DI hooks
    gate.ts                        PROGRESSION: which language features are unlocked
    migrate.ts                     old slot rows → seed source text (save migration)
    editor.ts editor-cm.ts         CodeMirror 6 mode/completion/linter (authoring only)
    *.test.ts                      lang / explore / gate unit tests
  rng.ts              Seeded PRNG (mulberry32) + int/range/pick/shuffle helpers
  rng.test.ts         Vitest tests for the PRNG (reproducibility)
  levels.ts           Level configs + first-clear / Insight tracking (meta)
  levels.test.ts      Vitest tests for level clearing
  protocol.ts         PURE Protocol model + compiler: the slot rule model the sim still
                      consumes internally (monsters run Procedures; the language compiles
                      to it; defaults seed it). The slot *authoring UI* was retired — a
                      player now writes code (lang/) — but this stays the sim's IR.
  protocol.test.ts    Vitest tests for the compiler (defaults can't drift)
  party.ts            PURE point-buy: BUILD_BUDGET / CHASSIS_COST, legal-build checks
  shop.ts             Unlockable vocabulary + language features (the Insight economy /
                      the Library — was "Trainer")
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
  main.ts             Wiring: screens, the Workshop code editor + Library, game loop,
                      journal, save (the only mutable shell)
  style.css           UI styling
  audio/              Suno theme OGGs (camp / run / boss) + golem SFX
vite.config.ts        base: './' (GitHub Pages) + Vitest config
docs/
  VISION.md           North star — what & why
  ROADMAP.md          Build order, design rules, planned slices
  INSCRIPTION-LANG.md The code language (golem brains in code) — design + build state
  COMBAT-SYSTEM.md    The six-stat model + cadence (CTB) + point-buy
  DUNGEON-SYSTEM.md   The room-graph delve (generation, routing, rooms, traps)
  VOCABULARY.md       The rule grammar reference (Procedure / Protocol / State / Maneuver)
  ARCHITECTURE.md     This file
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
- `mapgraph.ts` — **generation**: `generateGraph(level, seed)` instantiates a level's
  authored topology into a seeded **room graph** (typed rooms, corridor edges)
  deterministically from a seed.
- `lang/` — the **inscription language**: a pure Python-subset tree-walker. A golem's
  source compiles to a per-turn policy; `lang/combat.ts` and `lang/explore.ts` inject
  it into `sim`/`delve` via DI hooks (`setProgramDecider` / `setExplorationProgramDecider`), so
  the pure sim never imports the language. `gate.ts` enforces which language features
  are unlocked. The interpreter owns its whole namespace ⇒ sandbox + determinism.
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
  never an engine branch. (Exploration's trap moment shipped without a formal event
  union — a corridor owns its trap and fires it on traversal; see below.)

Content that carries *behaviour* imports its numeric primitives from `combat-core.ts`,
never from `sim.ts` — that keeps the dependency a DAG (`sim → content → combat-core`)
with no runtime cycle. Effect/reaction functions mutate the combatants the sim already
cloned (a scoped `no-param-reassign` exception, like `render.ts`'s ctx); damage
modifiers are pure (they return a number). `attackDamage` in `combat-core` is the BASE
(Might − Ward, floored); status logic is folded on top from content.

**Exploration is externalised the same way.** `delve.ts`'s `decideExploration` only
orchestrates (filter-then-move); the behaviour lives in `content/exploration/`: a
**Subject** (`target`/`unexplored`/`exit`) carries `stepToward(s)` + `reachable(s)`;
a **Predicate** carries `holds(s, subject)` (the `known` predicate asks its Subject);
a **Move** (`head`/`retreat`/`rest`) carries `resolve(s, subject)` (the cell to move
to — the party's own pos = rest, -1 = no move). The dungeon-navigation primitives
(BFS to a goal / to the frontier, objective + entrance cells, party HP) are the delve
twin of `combat-core` — `content/exploration/navigation.ts`, a leaf the content
composes without importing `delve.ts` at runtime (types only). **Traps shipped**
without a formal `DelveEvent` bus: a corridor *owns* its trap reaction
(`content/exploration/traps/`) and the delve fires it on traversal — the ownership
model (cells/corridors own reactions, not units) we'd left open.

This content path is the **empty-program fallback**. When a golem has authored code,
the **inscription language** (`lang/`) drives `decide` / `decideExploration` instead,
via the DI hooks — so a player's code is the brain, and the content vocabulary is the
substrate it (and monsters, and the default seed) compile down to.

`main.ts` owns the only mutable loop and the town ↔ delve UI. A launched delve is
autonomous: in town (the **Workshop**) the player **inscribes** each Golem's brain in
**code** — a combat `Engram.combat_turn:` block per golem and a party-wide
`Engram.exploration_turn:` block — descends, and lives with the result, then reads the
journal and iterates. The authoring surface is a CodeMirror editor (the slot dropdown
editor was retired); the **Procedure / Protocol** vocabulary (one ordered policy per
golem, one rule = one Protocol) is the grammar that code expresses — see VOCABULARY.md.

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

Today a single mulberry32 stream inside `generateGraph` drives all randomness,
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
- **No `innerHTML` for anything a player can author.** The journal escapes dynamic
  text (`esc()` in `main.ts`); the code editor is CodeMirror (it owns its own DOM).
- **No runtime dependencies except the Workshop code editor** (CodeMirror 6,
  lazy-loaded — authoring surface only; it never touches the pure sim).
- **GitHub Pages friendliness:** keep `base: './'` so asset paths stay relative;
  verify the *production build* (`npm run build`), not just the dev server.
- **Build in tiny verified slices**, attacking the riskiest unknown first, and
  prove each slice by running it in a browser (screenshot in `docs/progress/`).
