# Roadmap

## Vision

You are not a hero — you are the one who **programs** the heroes. Using FF12-style
*gambits* (ordered `condition → action` rules), you decide how your adventurers
behave, then let them fight autonomously, including while you're away (AFK / idle).
A blend of Satisfactory (build & optimise a system), Final Fantasy (party &
progression) and D&D (emergent, dice-driven encounters).

### Design pillars

1. **Automation is the gameplay.** Programming the party *is* the combat — there is
   no separate "build phase" bolted onto a "fight phase" (the seam that killed
   earlier attempts).
2. **Intense ↔ relaxed.** Calm tinkering with logic, punctuated by tense runs.
3. **AFK delivers the reward; the program unlocks progress.**
   > **Design rule #1:** staying AFK must *never* beat a wall by waiting — only by
   > improving the gambits. Waiting longer gives loot, not breakthroughs.
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
| 1 | Adventurer follows a gambit program vs looping slimes; on-screen decision log | ✅ done & verified |
| 2 | Interactive gambit editor (reorder, on/off, add/remove); live re-sim; Defend; death if non-viable | ✅ done & verified |

Screenshots: [docs/progress/](progress/).

## Planned slices

Order is a recommendation, not a contract — we can resequence.

### Slice 3 — Party + FF12 targeting *(recommended next)*
Multiple heroes and multiple enemies; targeting in conditions/actions:
`Self` / `Ally: lowest HP` / `Foe: nearest` / `Foe: highest HP`, etc.
*This is where gambits become genuinely rich, and it's the foundation most later
content needs.*
**Done when:** a 2-hero party with per-hero gambits clears a multi-enemy fight,
and targeting is visibly correct in the decision log.

### Slice 4 — The first "wall"
An enemy with a mechanic that a naive program cannot beat (e.g. *counters healing*,
or *enrages below 50%*), solvable **only** by changing the gambits.
**Done when:** the default program loses, and a specific gambit change wins — proven
in-browser.

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

- **Progression & unlocks:** limited gambit slots; buy/unlock new conditions &
  actions (FF12 shop feel) as the meta-progression.
- **Content growth:** more enemies, biomes/floors, status effects, items, jobs.
- **D&D flavour:** seeded dice rolls, emergent encounter events.
- **Co-op:** local (shared keyboard / screen) → online P2P via Trystero/PeerJS.
- **Theme/setting:** to be decided (placeholder art for now; the "program your
  units" fiction suits automatons/constructs, but unconstrained).
