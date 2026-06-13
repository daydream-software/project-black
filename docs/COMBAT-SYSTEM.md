# Combat System — the stat model

> The canonical "what & why" is [VISION.md](VISION.md); the rule *language* is
> [VOCABULARY.md](VOCABULARY.md). This file defines the **stats** — the numeric
> substrate that combat, exploration cadence and balance all ride on. It is a
> design reference, not an implementation log; **all six stats are now wired**
> in `src/sim.ts` (see [Where the code is today](#where-the-code-is-today)).

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
| **Might** | physical damage dealt by `Attack` | combat length (offense) |
| **Ward** | **flat** reduction on *all* incoming damage, physical **and** arcane | combat length (survival) |
| **Fortitude** | health pool — damage absorbed before the golem is **decommissioned** | combat length (survival) |
| **Attunement** | **potency** of skills (the strength of `Mend` and other arcane Maneuvers) | how much each magic action accomplishes |
| **Poise** | how much arcane channeling the golem sustains before **overstrain** bites into its Fortitude | **delve** length (the attrition budget) |
| **Celerity** | action frequency / turn order | **the cadence itself** (combat *and* room-to-room) |

So each stat owns a slice of cadence — that is the system, not a pile of numbers.

**Shorthand:** `M · W · F · A · P · C` (Might / Ward / Fortitude / Attunement /
Poise / Celerity) — each the stat's initial, all distinct (Might, not "Force", so
it never collides with Fortitude's F). A build writes as e.g.
`[M5 F5 C2] + [A4 P4 F4]` (a bruiser + a mender).

### Design decisions baked into the table

- **Ward is flat, not %.** Flat reduction makes Ward *anti-swarm*: it trivialises
  the chip damage of a trash pack but barely dents a boss's big hit. That gives it
  a role genuinely distinct from Fortitude (a raw buffer). A **%** Ward would just
  scale effective-HP and become redundant with Fortitude.
- **Magic is two stats, not one.** `Attunement` (how *strong* a cast is) is split
  from `Poise` (how *much* you can cast) so builds can diverge — a glass-cannon
  channeler (high Attunement, low Poise) vs. a steady supporter (low Attunement,
  high Poise).

### Stat scale — compact, every point visible

Stats live on a **compact scale (~0–10** at start; caps rise with meta). A point is
defined by its **cadence effect**, so the displayed number *is* the impact — no
`150` sitting next to `3`. Combat numbers stay small (hits ~1–4, heals ~2–5). The
trade-off is **breakpoints**: a single point of Might can turn a 3-hit kill into a
2-hit one. That is a *feature* for the build puzzle (optimise toward thresholds),
tuned to avoid dead zones. `0` is fine — it just means *not invested* (a
pure-physical golem has Attunement 0). **Monsters are exempt from the player's
scale/caps** (see below).

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
                Might
            ╱          ╲
   Attunement            Celerity      ← upper half = OFFENSE
       │                    │             (Might · Attunement · Celerity)
     Poise               Fortitude     ← lower half = SUSTAIN
            ╲          ╱                  (Ward · Fortitude · Poise)
                Ward
```

- **Edges = build archetypes** (adjacent = stacked together → a clean lobe):
  - **Might + Celerity** → the **Assailant** (hits hard × hits often = DPS)
  - **Ward + Fortitude** → the **Bulwark** (deflects × endures = tank)
  - **Attunement + Poise** → the **Channeler** (potency × sustain = caster) —
    placed straddling the offense/sustain line, so a caster who stacks both magic
    stats still bulges *one* clean lobe instead of an ugly hourglass.
- **Halves = posture:** an aggressive build is top-heavy, a defensive build
  bottom-heavy, a balanced build roughly regular.

## Authoring a party — the point-buy

**The hexagon IS the build space (decided).** There are **no predefined golems** —
the player **authors** the whole team by spending a **build budget**, and that
includes **committing to how many golems** the team has. Only **monsters** are
predefined.

The model (numbers are a strawman, to tune against a reference build in-app):

- A **build budget** — strawman **24 points**.
- **Fielding a golem costs** — strawman **3 points** (a "chassis" cost). It grants
  **nothing** — no free baseline stats; it is pure cost.
- The **remainder is spent on stats**, distributed **freely** across the golems
  (even or uneven). On the compact **0–12** scale, 1 point = 1 stat point, **flat
  cost** for now (we weight a stat only if play shows it dominates).

So with 24 points and 4 golems: 12 goes to chassis, **12 left** for stats —
`3/3/3/3`, or `4/4/2/2`, or whatever you choose.

| Golems | Chassis | Stat points left |
|---|---|---|
| 1 (titan) | 3 | **21** |
| 2 (duo) | 6 | **18** |
| 3 | 9 | **15** |
| 4 (swarm) | 12 | **12** |

The committed trade-off: **bodies** (action-economy via CTB, redundancy against
focus-fire, more Procedures to author) vs. **concentration** (each golem strong but
fragile, one Procedure). A 3-point swarm golem is deliberately feeble — that is the
*cost* of going wide, and judging "viable or not" is the player's call. There is **no
opposition malus** — just budget and cost, the hexagon shape emerges. The **budget,
the per-stat caps and the golem-count cap all grow via meta-progression** (raid
cycles — see `ROADMAP.md`).

## Monsters use the same model

Monsters carry the **same six stats**, so a monster's hexagon **is its threat
profile**: a high-Ward monster shrugs off physical hits, a high-Celerity monster
acts often, a high-Fortitude monster is a damage sponge (bottom-heavy), a
glass-cannon is top-heavy. The shape *signals what kind of wall it is* — and the
rule language can read it (`Enemy · most HP` today; `Enemy · armored / fast`
later). Difficulty = stat shape × pack count × mechanics, not just bigger numbers.

Two ways monsters differ from golems:

- **Off-balance and unbounded.** Monsters are tuned freely and are **not bound by
  the player's budget or scale caps** — a designer can push any stat past what a
  player could buy.
- **A long boss is built by composition, not a giant HP bar.** Several units in one
  encounter (e.g. *2 slimes + 1 slime* for a pack; *boss slime + enraged boss slime*
  for a boss), reusing the **multi-enemy sim** — so no single number is large, and
  killing the first unit reads as a natural **phase transition**. A boss
  encounter's ~24-action target is met by the *composition*, each unit staying
  compact.

## Cadence — the tempos, and how Celerity is felt

Cadence has **two independent dials**, and conflating them is the trap:

- **Tempo** = wall-clock seconds per action/step — the *feel*, deliberately
  **contemplative**. SFX is designed *around* the tempo, not the reverse.
  - **Combat: ~2.0 s per action.** Slow on purpose — not as an SFX floor but so
    **Celerity is legible**: at this spacing you watch a fast golem take extra
    turns while a slow one waits. Faster would make Celerity invisible math.
  - **Exploration: ~0.9 s per step** (up from 0.45). A measured walk. **Pairs with
    adding exploration SFX** (footstep / room-reveal / scrying hum) — slowing the
    walk without audio is dead air.
- **Drama** = number of actions per fight — the *length*, set by the **stats**, not
  the tempo. So combats can breathe (2 s/blow) without dragging (few blows):

  | Fight | Target actions | ≈ wall-clock |
  |---|---|---|
  | Trash pack | ~8 | ~16 s |
  | Elite / mini | ~14 | ~28 s |
  | Boss | ~24 | ~48 s |

  Trash stays brisk — a contemplative delve gets its length from *more rooms /
  fights and the measured walk*, never from padded trash.

**Session (emergent, not padded):** Level 1 ≈ 2–2.5 min; deep levels ≈ 4–5 min.

### Celerity = a CTB turn scheduler (FFX-style, not a filling ATB bar)

Turn order is **not fixed** — and it is **not** a real-time gauge you wait on
(FF4–9 ATB). It is **FFX-style CTB**: a deterministic scheduler where each unit's
**Celerity** sets how soon its next turn comes back. Two things are deliberately
kept separate:

| | Fixed or dynamic? | Driven by |
|---|---|---|
| **Order** — who acts, in what sequence | **dynamic** | Celerity |
| **Spacing** — wall-clock between on-screen actions | **fixed ~2 s** | the beat (for SFX) |

So every ~2 s *someone* acts (constant spacing → SFX breathes), but **who** comes
from the scheduler, not a fixed list. Celerity 12 / 10 / 8 → a **6 : 5 : 4** share
of turns: in the time the slow mob acts 4×, the Mender acts 6× and the Sentinel 5×.
The old round-robin dissolves into a stream of "next to act".

- **Deterministic** — pure scheduling math, ties broken by a fixed rule (e.g. lower
  index). No RNG; the journal stays trustworthy.
- **Celerity is a real build lever** — a fast Mender = responsive heals; a fast
  Sentinel = more tank actions. Programmable around (`WHEN …`).
- **Presentation: a turn-order carousel** (an FFX-style upcoming-turns strip). For a
  game you *watch*, showing what acts next makes Celerity legible and the autonomous
  combat readable instead of opaque. *(The model is CTB; the carousel — or even
  climbing bars — is just how it's drawn.)*
- **Door it opens** (noted, not decided): per-action **recovery cost** — a Heavy
  Strike pushes your next turn further out — a deterministic, programmable tradeoff
  that fits the burst idea.

This replaces today's fixed order (heroes then enemies, round-robin).

### Deriving stats from the targets (cadence-first)

1. Pick the **target action-count** for a fight (trash ~8, boss ~24).
2. Solve the **stats** so it resolves in that many actions —
   *enemy Fortitude ≈ (hits-to-kill) × hero Might*, minus Ward; a high-Ward enemy
   needs more hits; Celerity shifts how many of those hits are *yours*.
3. Tune against the **targets and the whole progression**, never one level alone
   (you'd only re-tune it later against the full curve).

## Where the code is today

`src/sim.ts` now carries the **six stats** as a `Stats` interface on every
`Combatant` (compact 0–12 scale). **All six are wired:**

| Model stat | Today in `sim.ts` | State |
|---|---|---|
| Might | `might` → `attackDamage = max(1, might − target.ward)` | ✅ wired |
| Ward | `ward` → flat reduction in `attackDamage`, floored at `MIN_DAMAGE = 1` | ✅ wired |
| Fortitude | `fortitude` → `maxHp = poolFor(fortitude) = fortitude × HP_PER_FORTITUDE` (4) | ✅ wired |
| Attunement | `attunement` → `healAmount` (**Mend** potency); `Defend` still halves a hit | ✅ wired |
| Poise | `poise` → Strain budget: each `Mend` adds `MEND_STRAIN`; `overdraw()` past Poise bites the caster's Fortitude. Persists across the delve, cools at the tower. | ✅ wired |
| Celerity | `celerity` → **CTB scheduler**: per-unit `charge`; `recovery(cel) = round(SCHED_BASE / max(1,cel))`; the least-charge unit acts next (ties by index). Higher Celerity = more turns (12:10:8 → 6:5:4). | ✅ wired |

Combat resolves on the **compact scale** (hits ~1–4, heals ~5, pools ~16–44),
proven in-browser (`docs/progress/combat-6stats-compact-scale.png`). **Strain** is
live: a `Mend` cast accrues Strain on its caster; past `Poise` the overflow frays
Fortitude (`overdraw` — `docs/progress/strain-overdraw.png`). A **rest** (the
exploration `rest` Move) is *off-combat Mend*: `restToConvergence()` runs each
golem's own Procedure against the party alone (attacks fizzle, Mends fire) to
convergence — same skill, same potency, same Strain budget as in combat, so it's
bounded and a healer-less party gets nothing. The heal skill is **Mend** (the
`mend` SkillId; "Cure" is retired). **Celerity** now drives an FFX-style **CTB
scheduler** (`step`/`upcomingTurns` share `nextActor`; round-robin is gone),
surfaced as a **turn-order carousel** in combat (`docs/progress/ctb-carousel.png`)
— the slow Warden shows up far less often than the fast Mender. The Warden was
re-tuned (Fortitude 11→18) to survive the fast Mender's front-load so the slice-4
discriminator still holds under CTB. Exact cadence-target tuning (action counts,
`MEND_STRAIN`/Poise) remains the deferred balance pass.

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
- **Point-buy tuning** — the model is decided (budget − flat chassis per golem →
  stat points spent freely, flat cost, 0–12); the *numbers* (budget 24, chassis 3,
  caps, golem-count range) are a strawman to tune against a reference build in-app.
  Open fallback: **weighted** per-stat cost if play shows one stat dominates.
- **Wipe model** — leading candidate is the *tower siege* (raid every N delves; a
  failed defence resets to 0 but seeds resources; meta-capacity unlocks persist).
  See `ROADMAP.md`. Open: N, raid scaling, the seed's contents.
