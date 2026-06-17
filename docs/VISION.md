# Vision — what the game is

> **You don't steer the adventurers. You _program_ their brains — how they fight
> AND how they delve — then send them into a dungeon and watch them crawl it on
> their own.**

You assemble a party and author its behaviour as rule lists. Then you send it
**delving** into a procedurally-generated dungeon: it navigates, fights the
monster packs it meets, grabs loot, and hunts the dungeon's target — all on its
own, by the rules you wrote. It returns victorious or it wipes. You read the
**journal** of the delve, revise your rules, and send a smarter party back down.

## Genre & pacing reference

A **programmable, idle-but-watched, procedurally-generated dungeon-crawler roguelite.** The
moment-to-moment pacing is **Nevergrind Online's** — brisk, continuous delving:
navigate, hit a monster pack, fight, chain kills, push on, find the target. The
twist that makes it ours: in Nevergrind a *human party leader navigates the
dungeon while the others relax* — **here that navigator is your code.** You write
the leader's brain.

Relatives: **Nevergrind Online** (the delve loop & pacing: town → procedural
dungeon → find/kill the target → return), **Gladiabots** (you author the AI,
launch, watch it lose, revise), **FF12 gambits** (the `WHEN-State → Maneuver`
rule language).

## Two programmable brains, one grammar

The whole game is "program your party." You author **two** Procedures (ordered
lists of Protocols — one rule each), both in the same `WHEN <State> → DO <X>`
grammar — learn it once, apply it twice:

- **Combat Procedure** — `WHEN <State = Subject + Predicate> → Maneuver` (built).
- **Exploration Procedure** — `WHEN <dungeon State> → Move` (new). Subjects =
  rooms, exits, loot, stairs, monsters-in-view; Predicates = unexplored, distance,
  estimated threat, chain-active; Moves = head toward / grab / rest / flee /
  descend / push the chain.

The exploration Procedure **is** the party leader. At a branch it doesn't stop and
ask — it consults your rules and picks. That is why the delve is autonomous, and
why idle-but-watched play is natural here (it was awkward before): you didn't remove the navigator,
you **automated** it.

## The core loop

```
   TOWN ──descend──▶ DUNGEON (autonomous delve) ──target killed──▶ back to TOWN
    ▲  active: program the 2 Procedures,              │  loot; meta persists
    │  equip loot, buy/unlock, manage party          │
    │                                                 └─ party wipes ──▶ back to 0
    │                                                         (meta kept)
    └──────────────── read the JOURNAL of the delve ◀──────────────────┘
```

- **Town — active, you're present.** The *only* place you decide: edit both
  Procedures, equip what you found, buy/unlock new vocabulary & heroes, manage the
  party. This is where build choices are made.
- **Dungeon — autonomous, hands-off.** The party delves a **seeded procedural**
  dungeon by your Procedures: navigates, fights packs (combat Procedure), chains
  kills, auto-collects loot, hunts the **target**. No live input — it runs itself
  in real time while the game is open; you idle or watch. **No offline progress:**
  close the game and the delve waits where it left off (time-away never advances it).
- **Outcome.** Target killed → return with the haul. Party wiped → back to 0.
  Either way you read the **journal** (a replay/debugger) and reprogram.

Build decisions live in **town** (active); the **delve** is pure autonomous (idle-but-watched).
That split resolves the old "drafts need live input vs. hands-off" tension — there are
no mid-delve pauses; you choose your build between delves, in town.

## Pacing & the chain lever (from Nevergrind)

Delving is brisk and continuous. **Chain combos** — clearing packs back-to-back
without breaking — boost loot/XP but raise risk, which makes them a juicy thing to
*program*: `WHEN chain active AND party HP > 60% → push the next pack` vs.
`WHEN HP < 40% → break the chain and rest`. The dungeon's **target** gives each
delve a goal and a natural length — not "explore until you die."

## Build diversity & meta-progression

- **Within a delve:** the dungeon, its loot, and its packs are **seeded** — a new
  problem each time, so your program must be *robust*, not tuned to one layout.
- **In town:** spend the haul — equip gear, buy/level skills, and **unlock new
  vocabulary** (Subjects / Predicates / Skills / Moves) and heroes. **The language
  growing is the meta-progression** (pillar 4); it persists across delves
  (roguelite). Tall-vs-wide and other build identities emerge from how you spend,
  equip, and program.

## Center of gravity

The game you actually *play* is the **town** — writing the two Procedures and
shaping the build. The dungeon is the **test bench**; the **journal** is how you
diagnose a wipe — and it's the golems' own voice: it shows what your code chose to
`record(...)`, not engine narration, so observability is itself something you
program. The **deterministic, seeded simulation is load-bearing**:
without it you can't reproduce a delve, diagnose it, or trust that a fix worked.
(This is why `sim.ts`/`delve.ts` stay pure; the seeded PRNG arrives with procedural
dungeons.)

## The shell (screens)

**Title → Save-slot select → Town → Dungeon (the delve: fog-of-war map) → return
or wipe → Town.** Save slots are independent roguelite profiles.

## Pillars (carried, sharpened)

1. **Programming is the gameplay** — now **two** brains (fight + delve), one grammar.
2. **Intense ↔ relaxed** — calm authoring in town; tense delves you cannot rescue.
3. **Automation you watch, not idle-farming.** Inscribe your Golems and set them
   delving — they explore, fight and hunt the target *on their own, successfully*,
   because you programmed them well. You stay **present and watching** — idle but not
   away; the draw is **watching your program work** (Gladiabots / factory-game
   satisfaction), not waiting for a meter to fill. **No offline progress:** a delve
   runs in real time while the game is open and simply waits where it left off when
   you close it — time-away never advances a delve (and waiting never beats a wall,
   rule #1).
4. **The language grows** — new vocabulary, Golems and gear unlock over time;
   expanding what you can *express* (and inscribe) is the meta-progression.
5. **Static & tiny** — GitHub Pages, no server. Solo first; local then P2P co-op.

## Design rules

> **#1 — Waiting never beats a wall.** Staying idle gives loot and depth already
> within reach, never a breakthrough. A wall falls only to a better program/build
> — never to time.

> **#2 — No rescue.** A delve is an autonomous bet placed in advance — you cannot
> steer it live, not the fights and not the navigation. You program better *next*
> time. The journal is how you learn; the seed makes the lesson real.

## Setting (decided 2026-06-10) — an Artificer and her Golems

You're an **Artificer**. You don't hire heroes — you **build Golems** and
**inscribe their cores** with the behaviour they'll run on, then send them delving.
A Golem acts on its own inscription: it explores, fights and hunts the target by
itself. This makes "you program autonomous delvers" *diegetic* — a Golem runs on
what you etched into it, so authoring-then-watching is the natural way to play.

The theme reskins only the **setting nouns**; the rule-grammar (**Procedure /
Protocol / State / Maneuver**) is unchanged — "inscribing the core" *is* authoring a
Golem's Procedure/Protocol. Direction (some names still open; reskin gradually,
slice by slice — not a big-bang rename):

| System | Term |
|---|---|
| Player | **Artificer** |
| Party / units | **Golems** *(models TBD)* |
| Author behaviour | **inscribe** a Golem's **core** |
| Planning station | **The Workshop** |
| Learn vocabulary *(was "Trainer")* | **The Library** — study; spend **Insight** |
| Gear *(later)* | **The Arcane Forge** — craft & equip **Runes** |
| Recruit Golems *(later)* | **The Crucible** *(alt: Arcane Foundry)* |
| Unlock currency | **Insight** — rare, from **first clears** → vocabulary + Golems |
| Common currency *(later)* | **Parts** *(alt: Scrap / Resource)* — from packs → Runes/gear |
| Enemies | varied creatures (slimes, …) — **not** necessarily Golems |
| Levels | **Ruin · Vault · Ancient City · Necropolis · …** |
| Loot | **Parts** + **Runes**; Insight is a first-clear reward, **not** loot |

## Open knobs (decide while building)

- **How punishing is a wipe?** Full roguelite reset (lose the delve's gains, keep
  meta) vs. Nevergrind-style persistent characters (keep gear/levels, just return
  to town). Leaning roguelite, tunable.
- **Dungeon shape:** grid "blobber" vs. rooms-and-corridors; fog-of-war reveal;
  delve length / number of floors.
- **Exploration vocabulary:** the exact Subjects/Predicates/Moves, threat
  estimation, how the chain lever is exposed.
- **Loot:** auto-collected vs. a programmable "loot policy"; how the town shop and
  unlocks gate progression.
- **Theme / fiction:** ✅ decided — an **Artificer and her Golems** (see *Setting*
  above). A few names stay open (Parts/Scrap, Crucible/Foundry, the Golem models).

## POC ≠ game

Built today (and **live** on GitHub Pages): the combat engine (composite
State/Maneuver, party, the first counter-mechanic wall — the "Hex Warden"), the
**run-loop spine** (a fixed gauntlet — the forerunner of the dungeon), **save +
resume** (offline catch-up was built, now being dropped — see pillar 3: no offline
progress), a 3-track music director. These prove *mechanisms*. The
**dungeon + exploration Procedure + town shell** are what turn them into the game
above. Build them in tiny verified slices; never mistake a POC for the game.

## VISION vs ROADMAP

**VISION = what & why** (this file, the north star). **ROADMAP = build order**
(technical slices). When they conflict, VISION wins — update the ROADMAP to match.
See [ROADMAP.md](ROADMAP.md).
