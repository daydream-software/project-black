# Roadmap

> **The canonical "what & why" now lives in [VISION.md](VISION.md).** This file
> is the build order (technical slices). When the two conflict, VISION wins.

## Vision (summary — see [VISION.md](VISION.md))

You are not a hero — you **program** the heroes' brains: how they **fight** (a
combat **Procedure**) and how they **delve** (an exploration **Protocol**), in one
`WHEN State → DO X` grammar. The game is a **programmable, AFK, procedural
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
3. **AFK delivers the reward; the program unlocks progress.**
   > **Design rule #1:** staying AFK must *never* beat a wall by waiting — only by
   > improving the Procedure. Waiting longer gives loot, not breakthroughs.
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
| RL | **Run-loop POC** (the roguelite spine): pure `run.ts` layer above the encounter — camp → launch → auto-advance a gauntlet (party HP/deaths carry: attrition) → defeat ends the run → back to camp. Editor locked during a run (no rescue); stage HUD; journal. | ✅ done & verified |
| 5 | **Save + offline catch-up:** `localStorage` persists the camp roster and an in-progress run; on load, an in-progress run fast-forwards by elapsed wall-clock (`catchUp`) — finishing offline lands on RUN OVER. Defensive load (versioned, never bricks). | ✅ done & verified |
| 6 | **Ship it live (GitHub Pages):** `gh-pages`-branch deploy (org bans nested unpinned actions); the game is playable on the web | ✅ done & verified |
| 7 | **Seeded PRNG foundation:** `rng.ts` (resumable mulberry32) + tests; `RunState.seed` set per launch, shown in the run bar, persisted (save v2) | ✅ done & verified |

Screenshots: [docs/progress/](progress/).

## Planned slices — toward the dungeon-crawler ([VISION.md](VISION.md))

The vision pivoted (2026-06-09) to a **programmable, AFK, procedural
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

### Slice 8 — The delve: exploration Protocol + a procedural dungeon *(the new core)*
Replace the fixed gauntlet with a **seeded procedural dungeon** the party
**auto-delves** by an **exploration Protocol** — the same `WHEN <State> → DO <Move>`
grammar, now over dungeon Subjects/Predicates and Moves (head toward / retreat /
rest). The party navigates the **spatial grid**, the existing combat sim fires in
monster rooms, and the delve ends at the **target** (win) or a wipe. Locked
direction: a **spatial grid** rendered **first-person ("scrying eye / drone")** —
the diegetic frame for the "you watch, don't control" identity and the fog of war.
**Done when:** a party with a trivial exploration Protocol auto-delves a generated
dungeon, fights along the way, and reaches & kills the target — proven in-browser,
with the navigation choices visible in the journal. Built in sub-slices:

- **8a-1** ✅ *(done & verified)* — pure seeded generation (`dungeon.ts`): connected
  grid, rooms, L-corridors, objective at the farthest room. 5 tests (determinism +
  connectivity across 200 seeds).
- **8a-2** ✅ *(done & verified)* — pure delve state machine (`delve.ts`): frontier
  exploration (navigate only the seen; `target` gated by `known`), fights on
  entering rooms (reuse `sim`), guaranteed termination (cleared/dead/stuck + cap),
  JSON-serialisable, decision-logging journal. 8 tests incl. a discriminator that
  the protocol genuinely drives navigation. Headless — additive, nothing wires it.
- **8b** ✅ *(done & verified)* — the stylized first-person **"scrying" view**
  (the room ahead + exits, party-from-behind + HP, a fog-of-war minimap; reuses
  the combat view during fights) and the **wiring**: the run/gauntlet is replaced
  by the delve (Town → **Descend** → Dungeon → Cleared / Wiped / Stuck → Town).
  `save.ts` migrated `RunState` → `DelveState` (version 3). Proven in-browser: a
  party auto-delves a seeded dungeon, the journal shows the exploration decisions
  + fights, it reaches the objective, and — with the cure rule disabled so the
  Hex Warden's counter can't trap it — **kills the target (DELVE CLEARED)**
  (`docs/progress/slice8b-*.png`). `run.ts` is now superseded (dead but still
  tested) — to be removed in a cleanup.
- **8c** ✅ *(done & verified)* — the exploration-Protocol **editor** in Town: a
  second, **party-wide** rule list (`Subject · Predicate → Move`) under the combat
  Procedure, built with the same composed-dropdown UI (reorder / enable / add /
  remove, locked during a delve). The authored rows are mapped to an `ExProtocol`
  and fed to `startDelve` (replacing the hardcoded `DEFAULT_EXPLORATION`), and
  persisted in the save (`exploration` — an **additive, optional** field; no
  version bump, so a live player's combat Procedure survives, and pre-8c saves
  default it). Proven in-browser: the editor renders both protocols
  (`docs/progress/slice8c-town-two-editors.png`); disabling the *Unexplored → head
  toward* frontier rule makes the delve go **STUCK on turn 1** ("no path forward")
  — the discriminating proof that the **authored** Protocol drives the delve, not
  the default (`docs/progress/slice8c-authored-protocol-drives-delve.png`). The
  testable part — the row→`ExProtocol` **rule compiler** + the exploration
  catalogs — lives in a pure `src/protocol.ts` (no DOM); `protocol.test.ts` (6
  tests) pins that `DEFAULT_EX_ROWS` compiles to exactly `DEFAULT_EXPLORATION`
  (mutation-checked), that disabled rows are dropped in priority order, and that
  `byId` rejects a corrupt id.

### Slice 9 — The shell: Title → Save slots → Town → Dungeon ✅ *(done & verified)*
The screen frame: a **title** screen, **multiple save slots** (independent
roguelite profiles, extending `save.ts`), a **Town** (edit both protocols, manage
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
**Done when:** a delve yields loot, Town lets you spend it to change the build, and
the changes persist into the next delve.

### Slice 11 — Exploration depth + the chain lever + room variety
Richer exploration vocabulary (threat estimation; loot / rest / elite / boss
rooms) and the Nevergrind **chain-combo** as a *programmable* risk/reward lever
(`WHEN chain active AND HP>60% → push` vs `WHEN HP<40% → break and rest`).
**Done when:** the same dungeon, run with two exploration Protocols (greedy-chain
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
- **Changelog / "What's New":** generate a dev `CHANGELOG.md` + a player-facing
  `src/changelog.json` (`feat`/`fix`/`perf`); show a "What's New" panel on version
  change and via a "Patch notes" button. (Conventional Commits already adopted.)
- **Co-op:** local (shared screen) → online P2P via Trystero/PeerJS — never a
  server we maintain.
- **Theme/setting:** to be decided (the "program your party" fiction suits
  constructs/automatons or a classic Nevergrind-style fantasy party).
