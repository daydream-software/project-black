# Vocabulary — the language you program units in

A unit's behaviour is an ordered list of rules. Each rule is:

> **WHEN `<State>` → DO `<Maneuver>`**

- **State** = `Subject` + `Predicate` (a composite condition).
  e.g. `Self · HP < 30%`, `Ally lowest-HP · HP < 50%`, `Enemy nearest · always`.
- The **Subject of the State is also the target** of the Maneuver. There is no
  separate target picker — the unit that matched the State is the unit acted upon
  (this is how FF12 gambits work).
- **Maneuver** = `Verb` + `which` (a composite action):
  `Use Skill · <skill>` or `Use Item · <item>`.
  e.g. `Use Skill · Cure`, `Use Skill · Fire`, `Use Item · Potion`.
- Rules are scanned top-to-bottom; the **first State that holds wins** (priority
  = order). This is the core engine (`decide()`).

> Terms: **State** and **Maneuver** are the two halves of a rule. A single rule
> line is a **Protocol**; the whole ordered list a unit carries is its
> **Procedure**. (Inspired by FF12's gambit system.)

Status legend: ✅ implemented · 🔜 next (party/targeting slice) · ⏳ later.

---

## Subjects (the "who" — selects both the trigger and the target)

| Subject | Qualifier | Status |
|---|---|---|
| **Self** | — | ✅ |
| **Ally** | any | 🔜 |
| Ally | lowest HP % | 🔜 |
| Ally | nearest | 🔜 |
| Ally | by role (Tank / Healer / DPS) | ⏳ |
| Ally | specific member | ⏳ |
| **Enemy** | any | ✅ (implicit "nearest") |
| Enemy | nearest | 🔜 |
| Enemy | lowest HP (to finish) | 🔜 |
| Enemy | highest HP | 🔜 |
| Enemy | strongest / by threat | ⏳ |
| Enemy | of a specific type | ⏳ |
| **Party** (aggregate) | — | ⏳ |
| **Battle** (no subject / global) | — | ✅ (used by `Always`) |

## Predicates (what is true about the subject)

| Predicate | Notes | Status |
|---|---|---|
| HP **<** X% | thresholds: 10 / 25 / 30 / 50 / 70 | ✅ (30, 50) |
| HP **=** full (100%) | | ✅ |
| HP **>** X% | | ⏳ |
| is **downed** / dead | for Ally/Enemy | ⏳ |
| **exists** / count ≥ N | for Enemy/Party aggregates | ⏳ |
| has **status** (poison/burn/stun/slow) | | ⏳ |
| **lacks** status X | e.g. "enemy not yet poisoned" | ⏳ |
| has **buff** / lacks buff | | ⏳ |
| resource / charge **ready** | once units have a resource/cooldown | ⏳ |
| is **charging / casting** | enemy intent | ⏳ |
| **Always** (default / "otherwise") | Battle subject | ✅ |
| Start of battle (turn 1) | Battle subject | ⏳ |
| Every Nth turn | Battle subject | ⏳ |

## Maneuvers

A Maneuver is a verb plus a specific choice. It acts on the **State's subject**
(the matched unit). The two verbs:

### `Use Skill · <skill>`

| Skill | Sensible target | Notes | Status |
|---|---|---|---|
| **Attack** | Enemy | basic, no cost | ✅ |
| **Heavy Strike** | Enemy | more damage, slower / costs a charge | ⏳ |
| **Fire / Ice / Lightning** | Enemy | elemental; weaknesses later | ⏳ |
| **Finisher** | Enemy | bonus vs low-HP targets | ⏳ |
| **Defend** | Self | halves incoming this turn | ✅ |
| **Cure** | Self / Ally | heal | ✅ (self) |
| **Greater Cure** | Self / Ally | bigger heal | ⏳ |
| **Revive** | Ally (downed) | | ⏳ |
| **Cleanse** | Self / Ally | remove a status | ⏳ |
| **Shield / Barrier** | Self / Ally | prevent incoming damage | ⏳ |
| **Haste / Power / Protect** | Self / Ally | buffs | ⏳ |
| **Poison / Slow / Weaken** | Enemy | debuffs | ⏳ |
| **Taunt** | Self (vs enemies) | force enemies to target this unit | ⏳ |
| **Flee** | Self | disengage | ⏳ |
| **Wait** | Self | skip to build a resource | ⏳ |

> A Maneuver whose skill doesn't fit the State's subject (e.g. `Cure` on an
> `Enemy` subject) simply does nothing — a "dead" rule. The editor can warn, but
> composition stays free.

### `Use Item · <item>`

Items are **consumable** (finite — a resource axis distinct from skills).

| Item | Effect | Status |
|---|---|---|
| **Potion / Hi-Potion** | heal the subject | ⏳ |
| **Antidote** | cure poison | ⏳ |
| **Ether** | restore resource/charge | ⏳ |
| **Phoenix Down** | revive a downed ally | ⏳ |
| **Bomb** | damage the subject | ⏳ |

---

## Procedure capacity (rule-list length)

How many Protocols a unit may carry is itself a design variable — not unlimited.
A limited rule count makes priority ordering *matter*: you can't handle every
case, so which rules earn a slot? Two complementary uses:

- **Progression resource.** Units start with few slots and unlock/buy more over
  time (the FF12 gambit-slot economy) — a core meta-progression reward.
- **Puzzle / optimization constraint.** Some encounters can cap the budget
  ("clear this with ≤ 4 Protocols"), and solving with fewer rules can score better —
  a Zachtronics-style optimization metric that fits the "program your units"
  identity and the optimise-a-system pillar.

Capacity can vary per unit (a fresh recruit vs. a veteran) and per encounter.

---

## Planned data model (for the slice-3 refactor)

Replaces the current flat `Condition`/`ActionKind` with a composite model where
the target lives in the State, and the Maneuver is verb + choice:

```ts
type Subject =
  | { who: 'self' }
  | { who: 'ally';  pick: 'any' | 'lowestHp' | 'nearest' | 'role'; role?: Role }
  | { who: 'enemy'; pick: 'any' | 'nearest' | 'lowestHp' | 'highestHp' | 'type'; type?: EnemyType }
  | { who: 'party' }
  | { who: 'battle' }

type Predicate =
  | { p: 'hpPctBelow'; value: number }
  | { p: 'hpFull' }
  | { p: 'hpPctAbove'; value: number }
  | { p: 'isDowned' }
  | { p: 'hasStatus'; status: Status }
  | { p: 'lacksStatus'; status: Status }
  | { p: 'countAtLeast'; n: number }
  | { p: 'always' }

interface State { subject: Subject; predicate: Predicate } // subject == the target

type Maneuver =
  | { use: 'skill'; skill: SkillId }
  | { use: 'item';  item: ItemId }

interface Protocol { state: State; maneuver: Maneuver; enabled: boolean }
type Procedure = Protocol[] // ordered; first matching State wins; acts on State.subject
```

The editor builds a State from two dropdowns (Subject, Predicate) and a Maneuver
from two more (Verb = Skill/Item, then which one) — composition, no target picker.

## Currently shipped subset (slices 1–2)

States: `Self · HP<30%`, `Self · HP<50%`, `Enemy · HP<30%`, `Self · HP=full`,
`Battle · Always`. Maneuvers: `Use Skill · Attack`, `Use Skill · Cure` (self),
`Use Skill · Defend` (self).
