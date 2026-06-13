# Combat System — the stat model

> The canonical "what & why" is [VISION.md](VISION.md); the rule *language* is
> [VOCABULARY.md](VOCABULARY.md). This file defines the **stats** — the numeric
> substrate that combat, exploration cadence and balance all ride on. It is a
> design reference, not an implementation log; the code does not yet carry most
> of this (see [Where the code is today](#where-the-code-is-today)).

## Why this exists

You cannot balance a level in isolation against a system that isn't defined.
Today every combatant has only `hp` and `atk` — so every fight is a pure **DPS
race**, and the only lever to make Level 1 winnable is to nerf the boss's
numbers. That is a band-aid, not a fix. Before tuning anything we define **what
the stats are and what each one governs**.

Two principles drive the whole model:

1. **Stats drive cadence.** In an AFK game you *watch* rather than steer, so the
   tempo of combat and exploration — set by the stats — *is* the core feel. We
   therefore derive stats **backwards from target cadence** (decide how long a
   trash fight / a room-hop / a boss *should* take, then solve for the numbers),
   instead of guessing constants and balancing after the fact.
2. **Stats govern cadence & attrition; mechanics govern walls.** Raw stat growth
   (from loot / grind) makes you clear faster and delve deeper — the AFK reward.
   But a **wall** is a *mechanic* whose answer is a **programmed response**, not a
   stat threshold. This is how [Design rule #1](VISION.md) stays structural:
   waiting longer buys cadence, never a breakthrough. *(How exactly stat-growth
   is metered vs. rule #1 is an open economy question — see
   [Open questions](#open-questions).)*

## The six stats

Each stat is an **abstract concept** (a quality, not a component), and each owns a
distinct lever — a stat exists only if it controls something the others don't.

| Concept | Governs | Cadence role |
|---|---|---|
| **Force** | physical damage dealt by `Attack` | combat length (offense) |
| **Ward** | **flat** reduction on *all* incoming damage, physical **and** arcane | combat length (survival) |
| **Fortitude** | health pool — damage absorbed before the golem is **decommissioned** | combat length (survival) |
| **Attunement** | **potency** of skills (the strength of `Mend` and other arcane Maneuvers) | how much each magic action accomplishes |
| **Poise** | how much arcane channeling the golem sustains before **overstrain** bites into its Fortitude | **delve** length (the attrition budget) |
| **Celerity** | action frequency / turn order | **the cadence itself** (combat *and* room-to-room) |

So each stat owns a slice of cadence — that is the system, not a pile of numbers.

### Design decisions baked into the table

- **Ward is flat, not %.** Flat reduction makes Ward *anti-swarm*: it trivialises
  the chip damage of a trash pack but barely dents a boss's big hit. That gives it
  a role genuinely distinct from Fortitude (a raw buffer). A **%** Ward would just
  scale effective-HP and become redundant with Fortitude.
- **Magic is two stats, not one.** `Attunement` (how *strong* a cast is) is split
  from `Poise` (how *much* you can cast) so builds can diverge — a glass-cannon
  channeler (high Attunement, low Poise) vs. a steady supporter (low Attunement,
  high Poise).

## The magic model — strain, not a battery (the "flip")

Magic is **not** a depleting mana bar that hard-stops at empty. It is the
opposite: the golem channels **freely**, but each skill use accumulates **Strain**,
and `Poise` is *how much Strain it bears before the overflow damages it*.

- While `Strain ≤ Poise`: casting is free.
- Beyond `Poise`: each further skill **costs Fortitude** (overdraw — the arcane
  flow frays the construct).
- Strain **cools at the tower** (so Poise is a *delve-scoped* budget — over-cast
  deep in a delve and it bites). *Whether it also vents partially between fights is
  open.*

Why the flip is better here than a mana bar:

- **More on-theme** — a construct pushed to overheat under the Artificer's craft.
- **A programmable risk lever, not a hard wall.** "Out of mana → can't act" is a
  dead stop; strain is an *authored* risk/reward: `WHEN ally critical → Mend even
  past Poise (pay Fortitude)`. You *decide* to push. That's gameplay, not a lockout.
- `Mend` becomes a **Fortitude ↔ magic-budget converter**, so in-delve sustain is
  bounded by Poise — boss viability depends on how much budget you conserved.

## Deterministic combat — burst is programmed, not rolled

Combat is **fully deterministic**: no crit, no hit/miss dice. Variety comes from
the **seeded random dungeon**, not from combat RNG — which keeps the journal
trustworthy ("my program did this", not "I got unlucky") and keeps the sim cheap
to test.

The spike that a crit would provide is instead a **programmable condition** — the
burst comes from your program reading state correctly, which is *more* gameplay:

- **Momentum / charge** — every Nth hit is empowered (`WHEN momentum = full →
  Heavy Strike`). This is the Nevergrind **chain-combo** lever already in the vision.
- **Conditional finisher** — `+X% vs target below 30%`, or `vs a weakened target`.
- **Extra action from Celerity** — fast enough to act twice in a window.

In every case the "crit" is a word in the `WHEN → DO` language, authored and
deterministic.

## The stat hexagon

The six stats sit on a hexagon. **Opposites carry no malus** — the layout is
purely about *readable radar shapes*: adjacent stats that builds tend to stack
together produce smooth **lobes**; scattering correlated stats would make jagged
stars. The arrangement gives **two free readings**.

```
                Force
            ╱          ╲
   Attunement            Celerity      ← upper half = OFFENSE
       │                    │             (Force · Attunement · Celerity)
     Poise               Fortitude     ← lower half = SUSTAIN
            ╲          ╱                  (Ward · Fortitude · Poise)
                Ward
```

- **Edges = build archetypes** (adjacent = stacked together → a clean lobe):
  - **Force + Celerity** → the **Assailant** (hits hard × hits often = DPS)
  - **Ward + Fortitude** → the **Bulwark** (deflects × endures = tank)
  - **Attunement + Poise** → the **Channeler** (potency × sustain = caster) —
    placed straddling the offense/sustain line, so a caster who stacks both magic
    stats still bulges *one* clean lobe instead of an ugly hourglass.
- **Halves = posture:** an aggressive build is top-heavy, a defensive build
  bottom-heavy, a balanced build roughly regular.

*(Later option, not decided: make the hexagon **mechanically** meaningful — a
point-buy where boosting a stat is cheaper when its opposite is low, forcing
specialization so the hexagon becomes a real build space. For now it is visual.)*

## Monsters use the same model

Monsters carry the **same six stats**, so a monster's hexagon **is its threat
profile**: a high-Ward monster shrugs off physical hits, a high-Celerity monster
acts often, a high-Fortitude monster is a damage sponge (bottom-heavy), a
glass-cannon is top-heavy. The shape *signals what kind of wall it is* — and the
rule language can read it (`Enemy · most HP` today; `Enemy · armored / fast`
later). Difficulty = stat shape × pack count × mechanics, not just bigger numbers.

## Balance method (cadence-first)

1. Set **cadence targets** — e.g. a trash fight ≈ N turns / ~S seconds, a room-hop
   ≈ T seconds, a boss ≈ M turns.
2. **Derive** base Force / Ward / Fortitude / Celerity from those targets.
3. Tune against the **targets and the progression as a whole**, never one level in
   isolation (you'd only re-tune it later against the full curve).

## Where the code is today

`src/sim.ts` currently models only a fraction of this — it is the honest starting
point, not the model:

| Model stat | Today in `sim.ts` |
|---|---|
| Force | `atk` |
| Fortitude | `maxHp` / `hp` |
| Ward | — (only a temporary `defending` flag halves damage for one turn) |
| Attunement | — (`Mend`/`cure` heals a flat `HEAL_AMOUNT`) |
| Poise | — (skills are free; no Strain) |
| Celerity | — (turn order is fixed: heroes then enemies, round-robin) |

The slice-4 `counterHeal` trait (Hex Warden) is an **ad-hoc mechanic**, not a stat
— exactly the kind of thing the wall taxonomy (deferred) will systematise.

## Open questions

- **Exact base numbers + cadence targets** — the whole point of the cadence-first
  method; still to set.
- **Stat-growth vs. Design rule #1** — the framing is "stats = cadence/attrition,
  walls = mechanics beaten by programming". Needs the economy (slice 10+) to make
  it concrete: where stat upgrades come from, and the guarantee they never
  *out-stat* a wall.
- **Wall / mechanic taxonomy** — the catalogue of enemy mechanics and their
  programmable answers (counter-heal, enrage, telegraph, regen, adds, immunities…).
  Sketched in conversation, **not yet decided** — its own design pass.
- **Strain reset rules** — cools at the tower for sure; does it vent between fights?
- **Ward as flat** — confirm the exact reduction model and whether a floor (min 1
  damage) is needed so high Ward can't make a unit unkillable.
- **Hexagon: visual only, or a mechanical point-buy?**
