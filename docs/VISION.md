# Vision — what the game is

> **You don't play the heroes. You _program_ them — then send them on
> autonomous runs and live with the result.**

You assemble a party and write each unit's **Procedure** (ordered
`WHEN <State> → DO <Maneuver>` rules). Then you launch a **run**: an escalating
gauntlet of encounters that **plays itself**. You don't touch the fights — you
authored the intelligence beforehand. The run either climbs or dies on a fight
your program couldn't beat. You read the **journal** to see exactly why, revise
your Protocols, and send a smarter program deeper next time.

## Genre & nearest cousins

A **programmable, AFK auto-battler roguelite.** Its three relatives, each
proven fun on its own:

- **Gladiabots** — you author rule-based bot AI, launch, watch it auto-fight,
  lose, revise the AI, retry. This is our core verb.
- **Slay the Spire** — run-based, _drafted_ builds, run-permadeath with
  persistent **meta-progression**. This is our run structure.
- **FF12 gambits** — the `State → Maneuver` rule language itself (our lexicon:
  Procedure / Protocol / State / Maneuver — never "gambit"; see
  [VOCABULARY.md](VOCABULARY.md)).

No existing game fuses all three **and** plays AFK. That gap is the game.

## The core loop

```
   CAMP ──launch──▶ RUN (auto) ──win──▶ deeper ──▶ … ──▶ cleared
    ▲                  │  ▲                                  │
    │                  │  └─ draft node: pick ONE reward     │
  revise               │                                     │
  Protocols            └─ lose a fight ──▶ BACK TO 0 ─────────┘
  + spend meta            (no rescue; meta kept)
    ▲                                     │
    └────────── read the JOURNAL ◀────────┘
```

1. **Camp.** Assemble party + Procedures from the vocabulary you've unlocked.
2. **Launch.** Combat is **fully automatic** — no mid-fight control. It runs
   even while you're away (AFK).
3. **Draft at nodes.** Between fights the run **waits for one choice** among
   competing rewards (see below). This is the only place it pauses for you.
4. **Win → advance. Lose → back to 0.** Defeat _anywhere_ ends the run; there is
   **no rescue mid-run**. But — _roguelite, not roguelike_ — **meta persists**:
   unlocked vocabulary, heroes, and relics carry to the next run; only the gains
   of _this_ attempt are lost.
5. **Journal.** The decision log is a **replay/debugger**: which unit did what,
   on whom, why, at which turn — and where it went wrong.
6. **Revise & relaunch.** A better program (and better drafts) reaches further.

## Build diversity from one pick economy

All growth inside a run flows through **a single drafting economy**: at each node
you take _one_ reward among competing categories —

- a **new party member**,
- a **new Procedure slot**,
- a **new Predicate** (a new condition you can program with),
- a **new Skill / Item** (a new Maneuver Object),
- **+attributes** on an existing member,
- … (relics / passives later).

There is no passive XP — **every pick is a trade-off.** Build identity _emerges_
from your sequence of choices against what the seed offers: the "**one monster
hero**" run (picks poured into a single deep unit) vs. the "**ten-member swarm**"
run (picks spent on recruits) are the same economy spent differently. This is
Slay the Spire's card/relic economy applied to a _programmable party_.

## Center of gravity: the editor and the journal

Combat is **not** the game — it's the **test bench**. The game, the place you
actually _play_, is the **editor** (writing Procedures, spending drafts) and the
**journal/replay** (diagnosing the last death). Consequences:

- The journal is a **first-class debugger**, not a side panel: filterable,
  answering "why did unit X do Y at turn N" and "where did the run tip over."
- The **deterministic, seeded simulation is load-bearing**: without it you can't
  diagnose, reproduce, or trust that "my fix worked." (This is why the pure
  `sim.ts` + seeded PRNG matter beyond AFK catch-up.)

## A session

- **2-minute check-in:** glance at how far the auto-run got (or that it died),
  read the journal, tweak a rule or queue a draft, relaunch. _Relaxed._
- **30-minute sit-down:** a wall keeps killing your runs; you rethink the
  Procedure, restructure the party, crack it. _Intense._

AFK reconciliation: **combats auto-resolve even while you're gone** (you may
return to a triumph _or_ a corpse + a lesson); the run only **holds at draft
nodes** for your input; it **never pauses to save a losing fight.** The AFK
delivers progress _and_ risk — but only intelligence goes deeper.

## Pillars (carried from the ROADMAP, sharpened)

1. **Automation is the gameplay.** Programming the party _is_ the combat.
2. **Intense ↔ relaxed.** Calm authoring punctuated by tense walls.
3. **AFK delivers the run; the program unlocks progress.**
4. **The language grows.** New Subjects/Predicates/Commands/Objects, heroes,
   enemies and mechanics stack as modular content — and expanding the language
   is itself the meta-progression.
5. **Static & tiny.** GitHub Pages, no server. Solo first; local then P2P co-op.

## Design rules

> **#1 — Waiting never beats a wall.** Staying AFK longer gives loot and depth
> already within reach, never a breakthrough. A wall falls only to a better
> Procedure / build — never to time. (Avoids the shallow-idle trap.)

> **#2 — No rescue.** The run is an autonomous bet you place in advance. You
> cannot intervene in a losing fight; you can only program _better next time_.
> The journal is how you learn; the seed makes the lesson real.

## Open knobs (decide while building, not now)

- **Procedure slots: per-unit or shared pool?** Leaning **per-unit, drafted** —
  it's what makes _tall vs. wide_ genuinely different to program.
- **Run structure:** node-map (Slay-the-Spire-like) vs. linear floors; run
  length in real time given AFK.
- **What meta-progression unlocks** beyond vocabulary (starting loadouts,
  heroes, relic pool, ascension-style difficulty).
- **Theme / fiction:** still placeholder. The "program your units" fiction suits
  constructs / automatons / summoned familiars, but it's open.
- **Front-load vs. in-run accrual** of drafts — current lean: **drafts at nodes**
  (the pick economy above), light and automatic where possible.

## POC ≠ game

What exists today are **subsystem POCs**, not the game:

- **Combat** (slices 1–4): the rule engine, multi-unit party, composite
  State/Maneuver, the first counter-mechanic wall. Validates that programmed
  auto-combat is legible and that walls fall to reprogramming.
- **AFK + save** (planned slice 5): offline catch-up via deterministic replay,
  seeded PRNG.

They prove _mechanisms_ in isolation. **This document is the whole they serve.**
Build each subsystem as a POC, but never mistake a POC for the game — the game
is the loop above.

## VISION vs ROADMAP

**VISION = what & why** (this file, the north star). **ROADMAP = build order**
(technical slices). When they conflict, VISION wins — update the ROADMAP to
match. See [ROADMAP.md](ROADMAP.md).
