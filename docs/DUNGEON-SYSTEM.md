# Dungeon system — the room-graph delve (design)

> Companion to [VISION.md](VISION.md) / [ROADMAP.md](ROADMAP.md) /
> [COMBAT-SYSTEM.md](COMBAT-SYSTEM.md). This file is the **canonical reference** for
> how a dungeon is shaped, populated and navigated. It **supersedes the cell-grid**
> of slice 8 (`dungeon.ts`’s `boolean[]` cells + rectangular rooms) and folds in the
> deferred room-variety (slice 11) + trap/`DelveEvent` work. Decisions here are
> **gravées** (settled with the user 2026-06-15); open items are flagged `OPEN`.

## North star

A dungeon is a **graph of rooms joined by corridors**, in the Nevergrind-Online mould:
*a room is a room, a corridor is a corridor.* The party **auto-delves** it by its
**exploration Procedure** — and the rework’s whole point is to make that Procedure
finally **decisive**: with room **types peeked one hop ahead** and **corridor fights
that can be routed around**, the player programs *route choices* (“head for loot while
healthy, avoid corridor packs when hurt, beeline the boss only when ready”). You still
**don’t steer** — *avoidance is a programmed routing decision*, which deepens the
“you watch, you don’t control” identity rather than breaking it.

## The map model — a graph

- **Node = a room**, with a **type** (below). **Edge = a corridor** connecting two
  rooms; a corridor may hold **enemies** and/or **traps**.
- Replaces the spatial `boolean[]` grid. Pathing/navigation is **graph traversal**
  (BFS over rooms through corridors), not cell stepping.
- **Rendering is unchanged** — still the first-person “scrying” view; only the
  **granularity of movement** changes: the party occupies a **room** or **traverses a
  corridor** (room-to-room), like Nevergrind, instead of cell-by-cell. The minimap
  shows the **room graph**.

### Room types

| Type | What it is / does |
|---|---|
| `entrance` | Where the delve starts (and where `retreat` heads). |
| `fight` | Holds a monster encounter (from the level’s pool). **Unavoidable**: must be cleared (or fled) to pass *through* the room. |
| `loot` | Grants the **non-Insight** rewards — the common currency / gear / items (the delve **haul**, lost on a wipe). Ties into the slice-10 economy. |
| `buff` | Grants a **run-scoped temporary boon**: a stat buff, a better-loot buff, **extended dungeon vision** (see room types beyond the normal 1-hop peek), etc. Lost at delve end/wipe. |
| `boss` | The level’s boss encounter (from the level def). The objective. |
| `???` | Resolved (seeded) to one of `loot` / `fight` / `buff` — managed risk the player can choose to engage or skip. |

### Corridors, avoidance, traps, flee

- **Room fight = unavoidable**: to pass through a `fight`/`boss` room you clear it (or
  flee the delve).
- **Corridor enemies = avoidable**: the party can route through a **different
  corridor** — but that choice is **programmed** (the exploration Procedure prefers an
  enemy-free path, or accepts the fight). Routing is the new strategic surface.
- **Flee is always possible**, any room/corridor — it ends combat (and per existing
  rules, sends the delve back).
- **Traps live in corridors** (the deferred `DelveEvent`): a corridor **owns** a trap
  reaction (the ownership model we’d left open — *cells/corridors own reactions, units
  don’t*). Entering/traversing a corridor emits a delve event; the corridor’s trap
  reacts. Mirrors combat reactions (id-dispatched, serialisable refs).

### Fog of war + the type peek

- Explored rooms are **known** (minimap ✓). Unexplored rooms are revealed by delving.
- For rooms **directly connected** to a known room, the party knows their **type**
  (a **1-hop peek**) — enough to route by type — but not what’s beyond.
- **Vision buffs** extend the peek depth (see types 2+ hops out) — making *vision*
  an earned, programmable resource.

## Hybrid generation — authored skeleton + seeded fill

Settled: **hybrid** (authored identity + roguelite variation). A **level** authors:

- A **topology** — the **forced graph shape**: the author can demand “rooms in a
  **cross**”, “all in a **line**”, a **hub**, a **branching tree**, … (a template of
  **slots** = nodes + the corridors between them).
- **Room slots**: which are **mandatory** (e.g. `entrance`, `boss`) and which are
  **optional** (may or may not appear this descent), with **type constraints** per
  slot (e.g. “this slot is `fight`”, “this one is `loot`-or-`buff`”, “this one is `???`”).
- A **monster pool**: the set of monster ids encounters **draw from** (by id, into the
  content bestiary), with per-encounter count/comp constraints.
- **Ambiance/biome** (theme; later).

The **seeded fill** (per descent) instantiates: which optional rooms appear, each
slot’s concrete type (within constraints), which monsters from the pool fill each
fight, and trap placement in corridors. → **fixed for the run, revealed by
exploration, varied between descents.** Keeps the roguelite rule (a robust *program*
beats a level, not a memorised map) while each level keeps an authored character.

This is the **content** model — everything by-id, glob-assembled, serialisable, like
the combat content: a level is a content file declaring its topology + slots + pool;
monsters/buffs/loot/traps are content referenced by id.

## Exploration vocabulary (the routing decisions) — proposed

The grammar stays `WHEN <Subject + Predicate> → DO <Move>`. The rework enriches it so
routing is programmable (to refine in the vocab slice):

- **Subjects** (the “what” a rule targets, peeked-or-known): `Connected room · of type
  [fight/loot/buff/boss/???]`, `Connected room · unexplored`, `Boss room` (once known),
  `Corridor · with enemies` / `· clear`, `Exit`.
- **Predicates**: `party HP% below N`, `has buff [X]`, `room is reachable/known`.
- **Moves**: `head toward <subject>` (route there — **avoiding** corridor fights when a
  clear path exists, else engaging), `head toward <subject> (shortest, accept fights)`,
  `avoid` (take an enemy-free path onward), `retreat`, `rest` (`OPEN`: does `buff`/heal
  content replace the current off-combat-Mend rest, or do both coexist?).

These give real programs: “WHEN connected `loot` room known AND HP>60% → head toward
it”, “WHEN corridor with enemies AND HP<40% → avoid”, “WHEN `boss` known AND HP>80% →
head toward (shortest)”, “else → explore unknown”.

## Combat integration

A `fight`/`boss` room builds its encounter from the **level’s monster pool** (chosen
by the seeded fill), not a hardcoded `'pack'`/`'warden'`. This kills the current
`delve.ts` hardcode and gives **real per-level bosses + varied packs** for free — the
monsters are already content (`content/monsters/`); this just makes *which spawn where*
content too (the level pool + the room’s rolled encounter).

## Economy tie-in (see ROADMAP slice 10/11)

- **`loot` rooms** drop the **farmable common currency + gear/items** — the delve
  **haul**, **capped** (anti-grind) and **lost on a wipe**.
- **Insight** is unchanged: only the **first clear** of a level pays it (never farmed).
- **`buff` rooms** grant **run-scoped** boons (gone at delve end). Buffs are content
  (one per file, by id) — incl. a **vision** buff that extends the peek.

## Rendering

Unchanged frame (first-person scrying + minimap). Movement becomes **room ↔ corridor**
traversal; the minimap renders the **room graph** (✓ explored, peeked types on
connected rooms, unknown beyond). No new visual identity — “juste la manière du
déplacement qui change.”

## OPEN questions (resolve as we slice)

- **Buff catalogue**: the concrete set of run boons (stat, loot-quality, vision depth,
  …) + how they stack/expire.
- **Loot/currency specifics**: the common-currency design + gear model (slice-10
  territory — may stay deferred while the *rooms* land).
- **`rest` vs buff/heal rooms**: keep off-combat-Mend rest, fold it into `buff`, or both.
- **Corridor-enemy data model**: how a corridor “has enemies” (a mini-encounter on the
  edge) and how avoidance routing scores paths.
- **Topology authoring shape**: how a level declares the forced graph (named templates
  vs an explicit slot-graph the author writes).
- **`???` resolution timing**: rolled at generation, at reveal (peek), or at entry.

## Slice plan (riskiest unknown first — see CLAUDE.md method)

Each slice proven in-browser, not just by tests.

1. **Graph map model + hybrid generation** *(the foundation; replaces the cell grid)*.
   Pure `dungeon.ts` rewrite: a level’s authored topology/slots/pool → a seeded
   **room graph** (typed nodes, corridor edges), serialisable. Connectivity + the
   authored mandatory rooms guaranteed (tests pin determinism + the skeleton).
2. **Delve over the graph** — `delve.ts` navigates rooms/corridors; fog + 1-hop type
   peek; room fights from the pool; flee. (Combat sim unchanged.)
3. **Routing exploration vocabulary** — the new Subjects/Predicates/Moves (content),
   making avoidance + type-routing programmable; the editor offers them.
4. **Room-type content** — `loot`/`buff`/`???` behaviours; buffs as content (incl.
   the vision buff that extends the peek).
5. **Corridor traps (`DelveEvent`)** — corridor-owned trap reactions, the delve event
   bus (the combat-reaction twin).
6. **Rendering adaptation** — first-person scrying + room-graph minimap over the new
   model.

Riskiest first = (1) the graph + hybrid generation: it’s the substrate everything else
hangs on, and the biggest departure from today’s code.
