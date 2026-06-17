# Roadmap

> **The canonical "what & why" now lives in [VISION.md](VISION.md).** This file
> is the build order (technical slices). When the two conflict, VISION wins.

## Vision (summary — see [VISION.md](VISION.md))

You are not a hero — you **program** the heroes' brains: how they **fight** and
how they **delve**, each a **Procedure** (an ordered list of **Protocols** — one
rule each) in one `WHEN State → DO X` grammar. The game is a **programmable, idle-but-watched, procedural
dungeon-crawler roguelite** (Nevergrind Online's pacing × Gladiabots × FF12
gambits): from **town** you program and manage, then **descend**; the party
**auto-delves** a seeded dungeon (navigate, fight packs, loot, hunt the target);
a **wipe sends you back to 0** (meta persists); you iterate from the **journal**.
A wall falls only to a better program/build — never to waiting.

### Design pillars

1. **Automation is the gameplay.** Programming the party *is* the combat — there is
   no separate "build phase" bolted onto a "fight phase" (the seam that killed
   earlier attempts).
2. **Intense ↔ relaxed.** Calm tinkering with logic, punctuated by tense runs.
3. **Automation you watch, not idle-farming; the program unlocks progress.**
   > **Design rule #1:** staying idle must *never* beat a wall by waiting — only by
   > improving the Procedure. Waiting longer gives loot, not breakthroughs. (There is
   > **no offline progress** — a delve runs in real time while open and waits where
   > it left off.)
4. **Grows over time.** New conditions, actions, enemies, mechanics stack as
   modular content.
5. **Static & tiny.** Ships on GitHub Pages, no server. Solo + local co-op first;
   online co-op later via P2P (Trystero / PeerJS) — never a server we maintain.

## Method

Tiny verified slices. Attack the riskiest unknown first. Prove every slice by
**running it in a browser** (not by green tests alone). Keep the simulation pure
and deterministic. English codebase. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Status

| Slice | What | State |
|---|---|---|
| 1 | Adventurer follows a rule program vs looping slimes; on-screen decision log | ✅ done & verified |
| 2 | Interactive rule editor (reorder, on/off, add/remove); live re-sim; Defend; death if non-viable | ✅ done & verified |
| 3 | Composite rules (State = Subject+Predicate, Maneuver = Command+Object), 2-hero party w/ per-unit Procedures vs a 3-enemy group, filter-then-pick targeting, victory/defeat | ✅ done & verified |
| 4 | The first "wall": Hex Warden counters every heal; naive cure-Procedure loses, disabling the cure rule wins. Encounter selector (Slime Pack / Hex Warden) | ✅ done & verified |
| RL | **Run-loop POC** (the roguelite spine): pure `run.ts` layer above the encounter — camp → launch → auto-advance a gauntlet (party HP/deaths carry: attrition) → defeat ends the run → back to camp. Editor locked during a run (no rescue); stage HUD; journal. | ✅ done · *later superseded by the delve layer; `run.ts` removed* |
| 5 | **Save + offline catch-up:** `localStorage` persists the camp roster and an in-progress run; on load, an in-progress run fast-forwards by elapsed wall-clock (`catchUp`) — finishing offline lands on RUN OVER. Defensive load (versioned, never bricks). | ✅ done · *offline catch-up later removed — a delve now resumes in real time; save/defensive-load kept* |
| 6 | **Ship it live (GitHub Pages):** `gh-pages`-branch deploy (org bans nested unpinned actions); the game is playable on the web | ✅ done & verified |
| 7 | **Seeded PRNG foundation:** `rng.ts` (resumable mulberry32) + tests; `RunState.seed` set per launch, shown in the run bar, persisted (save v2) | ✅ done & verified |

Screenshots: [docs/progress/](progress/).

## Post-slice-9 — combat redesign + modular content + the dungeon-graph rework

On branch **`refactor/modular-content`** (built 2026-06; **pending landing** via squash/ff
— not yet merged). All green: 133 tests, `tsc` + ESLint clean, build OK; proven in-browser
(town → descend → real-time delve with combat / loot / corridor traps / boss; the victory
path is covered by `delve.test` + engine runs).

- **6-stat combat + monotonic point-buy** — Might/Ward/Fortitude/Attunement/Poise/Celerity;
  the player authors each golem from an empty 24-point budget, frozen on descend.
- **Modular content registry** — one file per item under `src/content/` assembled by
  `import.meta.glob`; the engine knows no variants. Combat *and* exploration vocabulary,
  skills, monsters (own their Procedure + reactions), damage modifiers, the event-bus
  reactions, sfx, corridor traps, and **buffs** are all standalone, id-dispatched,
  serialisable content (design pillar #4, finally structural).
- **Dungeon-graph rework** — the cell grid is gone; dungeons are a **room graph** (typed
  rooms, corridor edges) with hybrid authored-topology + seeded fill (`mapgraph.ts`).
  Fog + 1-hop type peek; room fights unavoidable, **type-routing** programmable;
  corridor traps (map-owned reaction twin).
- **Buff / loot rooms** — buff rooms grant a run-scoped boon rolled from the level pool
  (2× Might/Celerity, full heal, vision, enemy-Fortitude debuff); loot is symbolic until
  slice 10.
- **Hidden rooms + feed-routing** — secret rooms the crawler never finds until **Secret
  Sight** reveals them; a known-but-distant room (revealed or peeked) is a goal the party
  *explores toward* (never teleporting): "revealed ≠ explored".
- **Minimap** — fixed-size, centred on the current room, fogged (only discovered structure),
  ✓ = cleared/resolved (not merely entered).

Still pending here: **loot economy** (slice 10), **corridor enemies** (avoidable fights —
unlocks the `retreat`/avoid move), an optional **hidden boss room** (needs a winnability
rule), and landing the branch on `main`.

## Planned slices — toward the dungeon-crawler ([VISION.md](VISION.md))

The vision pivoted (2026-06-09) to a **programmable, idle-but-watched, procedural
dungeon-crawler roguelite**. Slices 1–6 + the run-loop POC built the combat brain,
the autonomous-run spine, save/catch-up and a live deploy — the forerunners. These
slices grow that into the game: a second **exploration** brain, a procedural
**dungeon**, and the **town** shell. Order is a recommendation — resequence freely
(the shell can be pulled earlier if you want the frame first).

### Slice 7 — Seeded PRNG (foundation) ✅ *(done & verified)*
A small deterministic, **seeded** PRNG threaded through run state — so procedural
dungeons (and later dice) are reproducible and offline-catch-up-safe. Deferred in
slice 5 for want of a consumer; the dungeon is that consumer.
**Done when:** the same seed reproduces identical generation/rolls (pinned by a
test), and the seed persists in the save.

*Shipped:* `src/rng.ts` — a mulberry32 PRNG that is **resumable from a stored
state** (store `rng.s` in game state, `makeRng(state)` continues the exact
sequence — this is what keeps rolls reproducible across save/load and offline
replay). `RunState` gained a `seed` (set per launch in `main.ts`, shown in the
run bar, persisted; save `VERSION` bumped to 2 so older blobs are ignored). 8 rng
tests pin determinism + resumability. **No sim consumer yet** — slice 8's dungeon
generation is the first; the rng is mutable for ergonomics but its state is
captured back into the immutable game state to keep the sim pure.

### Slice 8 — The delve: exploration Procedure + a procedural dungeon *(the new core)*
Replace the fixed gauntlet with a **seeded procedural dungeon** the party
**auto-delves** by an **exploration Procedure** — the same `WHEN <State> → DO <Move>`
grammar, now over dungeon Subjects/Predicates and Moves (head toward / retreat /
rest). The party navigates the **spatial grid**, the existing combat sim fires in
monster rooms, and the delve ends at the **target** (win) or a wipe. Locked
direction: a **spatial grid** rendered **first-person ("scrying eye / drone")** —
the diegetic frame for the "you watch, don't control" identity and the fog of war.
**Done when:** a party with a trivial exploration Procedure auto-delves a generated
dungeon, fights along the way, and reaches & kills the target — proven in-browser,
with the navigation choices visible in the journal. Built in sub-slices:

- **8a-1** ✅ *(done & verified)* — pure seeded generation (`dungeon.ts`): connected
  grid, rooms, L-corridors, objective at the farthest room. 5 tests (determinism +
  connectivity across 200 seeds).
- **8a-2** ✅ *(done & verified)* — pure delve state machine (`delve.ts`): frontier
  exploration (navigate only the seen; `target` gated by `known`), fights on
  entering rooms (reuse `sim`), guaranteed termination (cleared/dead/stuck + cap),
  JSON-serialisable, decision-logging journal. 8 tests incl. a discriminator that
  the Procedure genuinely drives navigation. Headless — additive, nothing wires it.
- **8b** ✅ *(done & verified)* — the stylized first-person **"scrying" view**
  (the room ahead + exits, party-from-behind + HP, a fog-of-war minimap; reuses
  the combat view during fights) and the **wiring**: the run/gauntlet is replaced
  by the delve (Town → **Descend** → Dungeon → Cleared / Wiped / Stuck → Town).
  `save.ts` migrated `RunState` → `DelveState` (version 3). Proven in-browser: a
  party auto-delves a seeded dungeon, the journal shows the exploration decisions
  + fights, it reaches the objective, and — with the cure rule disabled so the
  Hex Warden's counter can't trap it — **kills the target (DELVE CLEARED)**
  (`docs/progress/slice8b-*.png`). `run.ts` (the superseded gauntlet layer) and its
  tests have since been removed.
- **8c** ✅ *(done & verified)* — the exploration-Procedure **editor** in Town: a
  second, **party-wide** rule list (`Subject · Predicate → Move`) under the combat
  Procedure, built with the same composed-dropdown UI (reorder / enable / add /
  remove, locked during a delve). The authored rows are mapped to an `ExProcedure`
  and fed to `startDelve` (replacing the hardcoded `DEFAULT_EXPLORATION`), and
  persisted in the save (`exploration` — an **additive, optional** field; no
  version bump, so a live player's combat Procedure survives, and pre-8c saves
  default it). Proven in-browser: the editor renders both Procedures
  (`docs/progress/slice8c-town-two-editors.png`); disabling the *Unexplored → head
  toward* frontier rule makes the delve go **STUCK on turn 1** ("no path forward")
  — the discriminating proof that the **authored** Procedure drives the delve, not
  the default (`docs/progress/slice8c-authored-protocol-drives-delve.png`). The
  testable part — the row→`ExProtocol` **rule compiler** + the exploration
  catalogs — lives in a pure `src/protocol.ts` (no DOM); `protocol.test.ts` (6
  tests) pins that `DEFAULT_EX_ROWS` compiles to exactly `DEFAULT_EXPLORATION`
  (mutation-checked), that disabled rows are dropped in priority order, and that
  `byId` rejects a corrupt id.

### Slice 9 — The shell: Title → Save slots → Town → Dungeon ✅ *(done & verified)*
The screen frame: a **title** screen, **multiple save slots** (independent
roguelite profiles, extending `save.ts`), a **Town** (edit both Procedures, manage
the party — today's "camp" grows up), and the **Dungeon** delve view.
**Done when:** pick a slot → Town → descend → Dungeon → return, and slots persist
independently. Built in two sub-slices:

- **9a** ✅ *(done & verified)* — the **save-slot persistence layer** in `save.ts`:
  `saveSlot / loadSlot / deleteSlot / listSlots` over 3 per-slot localStorage keys,
  plus a one-shot `importLegacy` (migrates the pre-9 single-save blob into slot 0
  verbatim, preserving `savedAt`). The store is an **injected `KVStore`** (default
  `localStorage`) so the layer is unit-testable in node with an in-memory fake —
  `save.test.ts` (7 tests) pins slot isolation (mutation-checked), defensive load
  of a corrupt blob, `listSlots` metadata, and the legacy import. Additive/headless.
- **9b** ✅ *(done & verified)* — the **screen shell + wiring**: a `screen: 'title'
  | 'slots' | 'game'` state above the in-game `mode`; a Title screen, a slot-picker
  (cards show *In town* / *Delving…* / *Party wiped* + relative time; New game /
  Continue / two-step-confirm Delete), and an `activeSlot` every save routes through
  (`saveNow()` no-ops on title/slots; the ticker also gates on `screen==='game'`).
  Startup no longer auto-resumes — it shows the title, and **offline catch-up moved
  to slot-entry** (`enterSlot` fast-forwards an in-progress delve; a delve that
  finished while away lands on its end screen — Design rule #1). Back-to-slots is
  **pause, not abandon** (the delve is saved and resumes on re-entry). The dead
  legacy `saveGame/loadGame` are removed. Proven in-browser: Title → New game (slot
  1) → descend → ← Slots (slot 1 *Delving…*, slot 2/3 empty) → New game (slot 2,
  *In town*) → **reload** lands on Title with both slots intact → Continue resumes &
  catches up → two-step Delete erases one slot only (`docs/progress/slice9-*.png`).

### Slice 10 — Loot & the Town economy (build diversity + meta)
Loot drops in the dungeon (auto-collected); in **Town** you **equip / spend /
unlock** — the start of the pick economy and the "language grows" meta-progression.
Gear and unlocked vocabulary persist across delves (roguelite).

**Design direction (agreed 2026-06-10):**
- **Loot buys expressiveness, not raw power** — vocabulary / rule-slots / heroes —
  so it can't trivialise a wall by grinding (Design rule #1 stays intact). Gear,
  when it lands (slice 11+), is behaviour-changing / a sidegrade, never +stat power.
- **Dungeons are re-playable levels.** A level is a *config* (level 1 = 3-7 rooms,
  1-2 packs, 1 boss), **not** a fixed layout — each descent is a fresh seed within
  that config, so it varies (your program must stay robust, not tuned to one map).
  The **first clear of a level pays Insight**; re-running it pays the common
  currency (later). That single split — progress → expressiveness, grind → bounded
  power — is the whole economy.
- **Two resources (eventual):** a common currency (from packs / re-runs) for gear /
  depth, and a **rare unlock resource** — placeholder *"Insight"* — earned **only on
  the FIRST clear of a level** (never on a re-run). Because it can't be farmed by
  repeating content, *waiting never buys a breakthrough* — rule #1 becomes
  structural, not a promise.
- **The farmable currency is capped; Insight is not.** The common currency has a
  **storage cap**, so idle / grind accumulation *saturates* — you can't bank your
  way to power by waiting (a second structural guard for rule #1). The cap is
  itself a **purchasable upgrade** (storage / vault — bought like any other unlock),
  which also makes "widen storage vs. unlock vocab" a real investment choice and a
  natural sink. **Insight is never capped** — it's only earned by clearing, so
  there's nothing to grind, and we want it to flow into expressiveness.
- **Wipe = roguelite:** unlocked vocabulary / slots / heroes persist (the meta);
  the delve's un-banked currency + gear are lost.
- **Resource names are theme-dependent** (dungeon adventurers vs. constructs in a
  virtual world vs. …, still undecided) — skin the names later; the mechanics
  don't depend on the fiction.
- **Key build insight:** unlocking vocabulary requires the vocab to *exist in the
  sim*, so the slice ships one genuine new vocabulary item (a real Skill /
  Predicate / Move) that starts **locked**.

**Built in two sub-slices** (the level system is the substrate the economy rides on):

- **10a — Levels.** ✅ *(done & verified)* The dungeon is now config-driven:
  `generateDungeon(seed, gen)` parameterised by `{ width, height, rooms:[min,max],
  packs:[min,max] }` (grid in the config so bigger levels are bigger; packs a
  chosen seeded count, not a coin flip) — **10a-1**. `src/levels.ts` holds the
  `LevelConfig` + a `LEVELS` list; `DelveState.levelId`; a per-profile additive
  `clearedLevels`; first-clear recorded on clear (ticker + offline catch-up) —
  **10a-2**. A Town **level select** (chips: name · room range · ✓ cleared badge)
  drives `descend(selected level)`; the picker hides during a delve — **10a-3**.
  Proven in-browser: selecting Level 2 descends its 31×23 / 6-9-room config; a
  cleared level shows its badge, persisting across reload (`docs/progress/`).
  Boss stays the Hex Warden for now (per-level enemies are content, deferred).
- **10b — Insight economy + vocab unlock.** ✅ *(done & verified)* On a level's
  **first clear**, +1 Insight (uncapped; re-runs and wipes pay nothing) — pure
  `applyClear`, **10b-1**, with a `✦ N` counter. A new combat Subject "Enemy · most
  HP" (`highestHp` targeting) ships **locked**; options carry an `unlock` id and a
  pure `available(options, unlocked)` filters every editor dropdown — **10b-2**.
  The **Trainer** station (Planning ↔ Trainer switcher) spends Insight via pure
  `shop.buy` to learn vocab, which then appears in the editor — **10b-3**.
  `insight` + `unlocked` persist per profile (additive). Proven at the mouse: ✦2 →
  Trainer → Learn → ✦1, "✓ learned", "Enemy · most HP" in the dropdown, persists
  (`docs/progress/slice10b-trainer.png`). Placeholder vocab — *not* a progression
  decision. **The full "language grows" loop works end to end.**

  **Town = a village hub** (the spend surface). Each building is a progression
  category: **Trainer** (learn vocabulary — "the language grows"; built in 10b),
  later **Smith/Forge** (gear, slice 11+), **Tavern/Guild** (recruit heroes),
  Library (rule-slot capacity). The two Procedure editors (combat + exploration)
  are the **Planning** station — you *arrange* there; buildings *expand* what you put
  in. Navigation is **light + theme-agnostic for now** — a station switcher
  (Planning · Trainer · …) that swaps the work area — because the immersive
  town-map skin is theme-dependent (theme still open); it graduates to a real
  village map once the theme lands. So 10b builds exactly one building (the
  Trainer) plus the station switcher.

**Settled:** Insight only on a level's first clear (no participation reward, never
capped). Dungeons are re-playable config-driven levels (varied per seed).

**Deferred (content/progression, not the system):** the real progression — the set
of levels, their configs / order / gating, which vocab unlocks at what cost; gear /
the capped common currency (slice 11+); theme/fiction & resource naming.

> **Balance/tuning — a first pass SHIPPED (2026-06-16).** The slice-10 worry (a fresh
> party couldn't clear level 1 because its boss was the slice-4 **Hex Warden**) is
> resolved: level 1 (**The Ruin**) now has a beatable attack-only boss, the
> **Ruin Keeper**, and the Hex Warden moved to level 2 (**The Vault**). A
> **level-1 Celerity-cliff** softlock (a golem authored with Celerity 0 never acted)
> was fixed with flat stat-floors on golems + slowed level-1 monsters. A real player
> can now build → clear level 1 → earn Insight, verified in-app. Exact cadence-target
> tuning across the full progression remains the deferred late pass.

## Post-slice-10 — the Inscription Language (authoring becomes code) ✅ *(done & verified)*

The biggest change since the dungeon-graph rework, **landed on `main` + deployed
(2026-06-16)**: the slot-dropdown Procedure editor was **retired** and golem brains are
now **authored in code** — the **Inscription Language**, a small Python subset run by a
pure tree-walking interpreter (`src/lang/`). Design + build state live in
[INSCRIPTION-LANG.md](INSCRIPTION-LANG.md); this is the build-order summary.

- **The interpreter** (`lang/lexer.ts` → `parser.ts` → `interp.ts`): a reactive,
  per-turn policy `senses → action` (no program counter ⇒ no VM state in the save ⇒
  determinism is free). Fuel-bounded; runtime errors are per-turn recoverable. Combat
  (`lang/combat.ts`) + exploration (`lang/explore.ts`) bind the namespace and drive the
  pure `sim`/`delve` via **DI hooks** (`setProgramDecider` / `setExplorationProgramDecider`) — the
  sim never imports the language. The slot **engine** (`protocol.ts`) stays as the sim's
  internal model: monsters run Procedures, and an empty program falls back to it.
- **The editor** (`lang/editor-cm.ts`): a lazy-loaded **CodeMirror 6** surface in the
  **Workshop** with a language mode, an unlocked-namespace completion source, and a
  linter (syntax + gate errors) — the one scoped exception to "no runtime deps".
- **Engrams** (`47d87b9`): named, reusable programs authored in the **Library** and
  copied onto golems in the Workshop (copy-on-assign). The entry point is a declarative
  `Engram.combat_turn:` / `Engram.exploration_turn:` block (NOT `def` — which frees `def`
  to be a gated feature).
- **Insight-gated progression** (`gate.ts`, `52c9fa1`): the language starts **minimal**
  — `if`/loops/`def`/`import`/comprehensions **and** `Skills.Mend` are LOCKED; spend
  Insight at the Library to unlock. A program using a locked construct fails LOUD
  (delve → `stuck`, no silent fallback). Verified end-to-end in-app: clear level 1 →
  +1 Insight → buy `lang-if` → `if` compiles while `for` stays locked, persisting across
  reload.
- **Save VERSION 4**: existing slot saves migrate slots→source text on load
  (`lang/migrate.ts`); new golems seed a default program.
- **`record(...)` → the journal** (`2026-06-17`): the language's debug builtin (renamed
  from `print`, never gated) writes a golem's own lines into the delve **journal** as
  `note` entries — the in-fiction debug console. The deciders drain it; `sim`/`delve`
  fold it into the log (capped per turn).

### Slice 11 — Exploration depth + the chain lever + room variety
Richer exploration vocabulary (threat estimation; loot / rest / elite / boss
rooms) and the Nevergrind **chain-combo** as a *programmable* risk/reward lever
(`WHEN chain active AND HP>60% → push` vs `WHEN HP<40% → break and rest`).
**Done when:** the same dungeon, run with two exploration Procedures (greedy-chain
vs. cautious), produces visibly different outcomes.

## Shipped slices — detail

### Slice 3 — Composite rules (State + Maneuver), party + targeting ✅ *(done & verified)*
Adopt the composite model from [VOCABULARY.md](VOCABULARY.md): a rule becomes
**WHEN `<State = Subject + Predicate>` → DO `<Maneuver = verb + which>`**, built
from composed dropdowns rather than a flat menu. The **State's subject is the
target** (no separate target picker); the Maneuver is `Use Skill · <skill>` or
`Use Item · <item>`. Introduce multiple heroes and enemies so subject selection
(`Self` / `Ally: lowest HP` / `Enemy: nearest` / `Enemy: lowest HP`) is meaningful.
Rename the mechanic away from "gambit": **State** + **Maneuver** are a rule's two
halves; one rule line is a **Protocol**; a unit's ordered list is its **Procedure**.
*This is where the rule language becomes genuinely rich, and it's the foundation
most later content needs.*
**Done when:** a 2-hero party with per-unit Procedures clears a multi-enemy fight,
and composed targeting is visibly correct in the decision log.

### Slice 4 — The first "wall" ✅ *(done & verified)*
An enemy with a mechanic that a naive program cannot beat (e.g. *counters healing*,
or *enrages below 50%*), solvable **only** by changing the Procedure.
**Done when:** the default Procedure loses, and a specific Protocol change wins —
proven in-browser.

*Shipped:* the **Hex Warden** — whenever a hero is healed it strikes the healed
unit for 30 (`counterHeal` trait in `sim.ts`, applied as a same-turn reaction
before the outcome check). The default party's `Ally lowest HP<50% → Cure` rule
becomes a death-spiral trap; disabling that one rule (Healer joins the DPS race;
the Warrior tanks on its own `Self HP<30% → Defend`) flips defeat → victory.
Proven in-browser (`docs/progress/slice4-defeat.png` → `slice4-victory.png`) and
pinned by two opposite-outcome tests. An **encounter selector** (Slime Pack /
Hex Warden) keeps the player's Procedures and swaps only the enemy group, so the
"same program, different wall" contrast is visible.

### Slice 5 — AFK offline progression + save ✅ *(done & verified)*
`localStorage` save/load; on load, compute elapsed time and replay `step` to catch
up. Introduce a seeded PRNG so catch-up is reproducible.
**Done when:** closing and reopening the tab resumes correctly and credits offline
progress.

*Shipped:* `src/save.ts` persists the camp **roster** (editor rows) and the current
**run** separately, stamped with `savedAt`; saved on edit/launch/back-to-camp, a
~1 s heartbeat during a run, and `visibilitychange`/`pagehide`. On load, an
in-progress run is fast-forwarded by `catchUp(run, elapsedSteps)` (pure, in
`run.ts`); a run that finished while away lands on RUN OVER so the journal is read
(Design rule #1). Catch-up is **load-only** (not on refocus — the throttled
interval already advances an open tab). Load is defensive (versioned + try/catch →
ignore corrupt/stale, never bricks). Verified in-browser: edit→reload persists; an
injected old `savedAt`→reload fast-forwards the run to its end.

> **Superseded:** the **offline catch-up** described above was later removed
> (the run layer became the delve). A delve now **resumes in real time** exactly
> where it was saved — time away never advances it (VISION.md pillar 3). The save
> persistence and defensive/versioned load remain; `savedAt` is now only the
> slot-picker's "x ago" stamp, not a replay input.
**PRNG deferred:** the sim has zero randomness today, so catch-up is *already*
reproducible — a seeded PRNG would be infra with no consumer. It lands with the
first dice/randomness (D&D flavour), where the seed will live in `RunState`.

### Slice 6 — Ship it live (GitHub Pages) ✅ *(done & verified)*
Create the GitHub repo, enable Pages, confirm `deploy.yml` publishes a playable
build. *(Can be pulled earlier — it's motivating to play on the web.)*
**Done when:** the game is reachable at its Pages URL on any device.

**🔴 LIVE: https://daydream-software.github.io/project-black/** — verified in a
browser (app renders, relative-base JS/CSS load on the `/project-black/`
subpath). The deploy deviates from the standard Pages-Actions pipeline: the org
enforces **SHA-pinned actions**, and GitHub's `upload-pages-artifact` pulls in a
tag-pinned nested action the policy rejects. So `deploy.yml` builds and publishes
`dist/` to the **`gh-pages` branch with plain git** (only SHA-pinned
checkout + setup-node; the write-enabled `GITHUB_TOKEN` pushes), and Pages serves
from that branch. Pushes to `main` auto-deploy.

## Later / long-term

- **Wipe model (decide during slice 10):** full roguelite reset (lose the delve's
  gains, keep meta) vs. Nevergrind-style persistent characters (keep gear/levels,
  return to town). Leaning roguelite.
  **Candidate (2026-06-12) — the tower siege.** The reset is diegetic: every **N
  delves** the Artificer is **raided**; fail to defend the tower and he triggers a
  failsafe (the *McGuffin*) — the run resets to 0 but **seeds some resources** to
  retry. **Meta that persists = unlocks/capacity** (Insight & resource caps,
  vocabulary, and the build **budget + golem-count caps** — so each cycle you can
  build bigger). **Two failure scales:** a delve-wipe loses only the haul; a failed
  siege is the full reset. Defending **reuses the combat sim** (an inbound
  encounter vs. your golems + Procedures). Open: exact N, how the raid scales with
  delves survived, what the seed contains. See `docs/COMBAT-SYSTEM.md`.
- **Progression depth:** limited **Procedure / Protocol capacity** (rule-list
  length) you unlock/grow; buy/unlock new Subjects, Predicates, Skills, Moves,
  Items & heroes (FF12 shop feel) as meta. Dungeons may impose a slot budget as a
  puzzle constraint. See [VOCABULARY.md](VOCABULARY.md#procedure-capacity-rule-list-length).
- **Content growth:** more monsters & packs, dungeon biomes/floors, status effects,
  items, hero classes, more "walls" (mechanics a naive program can't beat).
- **D&D flavour:** seeded dice rolls and emergent dungeon events (now that the
  PRNG exists).
- **Feel & polish:** an animated **boss splash** synced to the music on entering a
  boss/target room; combat & exploration juice; the journal as a real, filterable
  **replay/debugger**.
- **Changelog / "What's New":** the in-game **consumer SHIPPED (2026-06-17)** — the
  build version is injected from `package.json` (`__APP_VERSION__`), and `main.ts`
  surfaces `src/changelog.json` as a "What's New" panel on a version bump (last-seen
  in a global `localStorage` key) + a title button (`src/changelog.ts`). **Still
  deferred:** the *generator* (commits → `changelog.json` + a dev `CHANGELOG.md`) —
  the JSON is hand-authored for now (no per-release tags ⇒ version-bucketing is
  ambiguous). (Conventional Commits already adopted.)
- **Co-op:** local (shared screen) → online P2P via Trystero/PeerJS — never a
  server we maintain.
- **Theme/setting:** to be decided (the "program your party" fiction suits
  constructs/automatons or a classic Nevergrind-style fantasy party).
