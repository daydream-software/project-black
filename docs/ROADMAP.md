# Roadmap

## Vision

You are not a hero — you are the one who **programs** the heroes. Using a
**Procedure** — ordered **Protocols** (`WHEN State → Maneuver`, inspired by FF12
gambits) — you decide how your adventurers behave, then let them fight
autonomously, including while you're away (AFK / idle).
A blend of Satisfactory (build & optimise a system), Final Fantasy (party &
progression) and D&D (emergent, dice-driven encounters).

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

Screenshots: [docs/progress/](progress/).

## Planned slices

Order is a recommendation, not a contract — we can resequence.

### Tooling slice — Versioning, changelog & in-game "What's New"
Convention adopted up front (Conventional Commits, see [CONTRIBUTING.md](../CONTRIBUTING.md)) ✅ —
the rest is deferred. When built: generate a developer `CHANGELOG.md` and a
player-facing `src/changelog.json` (only `feat` / `fix` / `perf`, grouped New /
Fixes / Improvements, per version). Bake the build version into the app.
Show the **"What's New"** panel **both** ways:
- **automatically** on version change (compare build version to `localStorage`
  last-seen version, list only newer entries), and
- via a manual **"Patch notes"** button that reopens the full changelog anytime.

Generator tool is **TBD** (Node script or git-cliff) and is decoupled from the
game — the game just reads `changelog.json`.
**Done when:** bumping the version and rebuilding makes the panel appear in-browser
with the right entries, it doesn't reappear on a second load, and the Patch-notes
button reopens it on demand.

### Slice 3 — Composite rules (State + Maneuver), party + targeting *(recommended next)*
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

### Slice 4 — The first "wall"
An enemy with a mechanic that a naive program cannot beat (e.g. *counters healing*,
or *enrages below 50%*), solvable **only** by changing the Procedure.
**Done when:** the default Procedure loses, and a specific Protocol change wins —
proven in-browser.

### Slice 5 — AFK offline progression + save
`localStorage` save/load; on load, compute elapsed time and replay `step` to catch
up. Introduce a seeded PRNG so catch-up is reproducible.
**Done when:** closing and reopening the tab resumes correctly and credits offline
progress.

### Slice 6 — Ship it live (GitHub Pages)
Create the GitHub repo, enable Pages, confirm `deploy.yml` publishes a playable
build. *(Can be pulled earlier — it's motivating to play on the web.)*
**Done when:** the game is reachable at its Pages URL on any device.

## Later / long-term

- **Progression & unlocks:** limited **Procedure capacity** (rule-list length) that
  you unlock/grow; buy/unlock new Subjects, Predicates, Skills & Items (FF12 shop
  feel) as the meta-progression. Encounters may also impose a slot budget as a
  puzzle/optimization constraint. See [VOCABULARY.md](VOCABULARY.md#procedure-capacity-rule-list-length).
- **Content growth:** more enemies, biomes/floors, status effects, items, jobs.
- **D&D flavour:** seeded dice rolls, emergent encounter events.
- **Co-op:** local (shared keyboard / screen) → online P2P via Trystero/PeerJS.
- **Theme/setting:** to be decided (placeholder art for now; the "program your
  units" fiction suits automatons/constructs, but unconstrained).
