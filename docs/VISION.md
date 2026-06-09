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

A **programmable, AFK, procedurally-generated dungeon-crawler roguelite.** The
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

The whole game is "program your party." You author **two** rule lists, both in the
same `WHEN <State> → DO <X>` grammar — learn it once, apply it twice:

- **Combat Procedure** — `WHEN <State = Subject + Predicate> → Maneuver` (built).
- **Exploration Protocol** — `WHEN <dungeon State> → Move` (new). Subjects = rooms,
  exits, loot, stairs, monsters-in-view; Predicates = unexplored, distance,
  estimated threat, chain-active; Moves = head toward / grab / rest / flee /
  descend / push the chain.

The exploration Protocol **is** the party leader. At a branch it doesn't stop and
ask — it consults your rules and picks. That is why the delve is autonomous, and
why AFK is natural here (it was awkward before): you didn't remove the navigator,
you **automated** it.

## The core loop

```
   TOWN ──descend──▶ DUNGEON (autonomous delve) ──target killed──▶ back to TOWN
    ▲  active: program the 2 protocols,              │  loot; meta persists
    │  equip loot, buy/unlock, manage party          │
    │                                                 └─ party wipes ──▶ back to 0
    │                                                         (meta kept)
    └──────────────── read the JOURNAL of the delve ◀──────────────────┘
```

- **Town — active, you're present.** The *only* place you decide: edit both
  protocols, equip what you found, buy/unlock new vocabulary & heroes, manage the
  party. This is where build choices are made.
- **Dungeon — autonomous, AFK-able.** The party delves a **seeded procedural**
  dungeon by your protocols: navigates, fights packs (combat Procedure), chains
  kills, auto-collects loot, hunts the **target**. No live input; it plays on even
  while you're away (offline catch-up replays the delve deterministically).
- **Outcome.** Target killed → return with the haul. Party wiped → back to 0.
  Either way you read the **journal** (a replay/debugger) and reprogram.

Build decisions live in **town** (active); the **delve** is pure autonomous (AFK).
That split resolves the old "drafts need live input vs. AFK" tension — there are
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

The game you actually *play* is the **town** — writing the two protocols and
shaping the build. The dungeon is the **test bench**; the **journal/replay** is
how you diagnose a wipe. The **deterministic, seeded simulation is load-bearing**:
without it you can't reproduce a delve, diagnose it, or trust that a fix worked.
(This is why `sim.ts`/`run.ts` stay pure; the seeded PRNG arrives with procedural
dungeons.)

## The shell (screens)

**Title → Save-slot select → Town → Dungeon (the delve: fog-of-war map) → return
or wipe → Town.** Save slots are independent roguelite profiles.

## Pillars (carried, sharpened)

1. **Programming is the gameplay** — now **two** brains (fight + delve), one grammar.
2. **Intense ↔ relaxed** — calm authoring in town; tense delves you cannot rescue.
3. **AFK delivers the delve; the program unlocks progress.** The delve runs itself
   (the exploration Protocol is the navigator) and continues offline.
4. **The language grows** — new vocabulary, heroes and gear unlock over time;
   expanding what you can *express* is the meta-progression.
5. **Static & tiny** — GitHub Pages, no server. Solo first; local then P2P co-op.

## Design rules

> **#1 — Waiting never beats a wall.** Staying AFK gives loot and depth already
> within reach, never a breakthrough. A wall falls only to a better program/build
> — never to time.

> **#2 — No rescue.** A delve is an autonomous bet placed in advance — you cannot
> steer it live, not the fights and not the navigation. You program better *next*
> time. The journal is how you learn; the seed makes the lesson real.

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
- **Theme / fiction:** still open (constructs/automatons, or a classic fantasy
  party à la Nevergrind).

## POC ≠ game

Built today (and **live** on GitHub Pages): the combat engine (composite
State/Maneuver, party, the first counter-mechanic wall — the "Hex Warden"), the
**run-loop spine** (a fixed gauntlet — the forerunner of the dungeon), **save +
offline catch-up**, a 3-track music director. These prove *mechanisms*. The
**dungeon + exploration Protocol + town shell** are what turn them into the game
above. Build them in tiny verified slices; never mistake a POC for the game.

## VISION vs ROADMAP

**VISION = what & why** (this file, the north star). **ROADMAP = build order**
(technical slices). When they conflict, VISION wins — update the ROADMAP to match.
See [ROADMAP.md](ROADMAP.md).
