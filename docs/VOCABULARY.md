# Vocabulary — the rule grammar (conceptual reference)

> **Status (2026-06-16): the slot *authoring UI* this doc describes was retired.**
> Golems are now programmed in code — the **Inscription Language**
> ([INSCRIPTION-LANG.md](INSCRIPTION-LANG.md)) — not by composing dropdowns. This file
> stays as the **canonical reference for the rule *grammar*** (the **Procedure /
> Protocol / State / Maneuver** vocabulary, still canonical per CLAUDE.md): the
> concepts the code language expresses, and the `decide()` semantics it preserves
> (first match wins, filter-then-pick, subject = target). The §"Planned data model"
> and §"Currently shipped subset" sections below are **historical** — that refactor
> shipped, then the editor moved to code. `protocol.ts` still holds this Protocol
> model + compiler internally (monsters run Procedures; the language compiles to it),
> but a player no longer authors slots.

A unit's behaviour is an ordered list of rules. Each rule is:

> **WHEN `<State>` → DO `<Maneuver>`**

- **State** = `Subject` + `Predicate` (a composite condition).
  e.g. `Self · HP < 30%`, `Ally lowest-HP · HP < 50%`, `Enemy nearest · always`.
- The **Subject of the State is also the target** of the Maneuver. There is no
  separate target picker — the unit that matched the State is the unit acted upon
  (this is how FF12 gambits work).
- **Maneuver** = `Command` + `Object` (a composite action, mirroring the State).
  Commands: `Attack`, `Use Skill`, `Use Item`, `Flee`. `Attack`/`Flee` take no
  Object; `Use Skill`/`Use Item` name which one (the skill/item **is** the Object).
  e.g. `Attack`, `Use Skill · Mend`, `Use Skill · Fire`, `Use Item · Potion`, `Flee`.
- Grammar symmetry: the State's **Subject** is *who* is acted on; the Maneuver's
  **Object** is *what* is wielded.
- Rules are scanned top-to-bottom; the **first State that holds wins** (priority
  = order). This is the core engine (`decide()`).

> Terms: **State** (Subject + Predicate) and **Maneuver** (Command + Object) are
> the two halves of a rule. A single rule line is a **Protocol**; the whole
> ordered list a unit carries is its **Procedure**. (Inspired by FF12's gambit
> system.)

Status legend: ✅ implemented · 🔜 next (party/targeting slice) · ⏳ later.

---

## Subjects (the "who" — selects both the trigger and the target)

| Subject | Qualifier | Status |
|---|---|---|
| **Self** | — | ✅ |
| **Ally** | any | ✅ |
| Ally | lowest HP % | ✅ |
| Ally | nearest | ✅ (= list order; no geometry yet) |
| Ally | by role (Tank / Healer / DPS) | ⏳ |
| Ally | specific member | ⏳ |
| **Enemy** | any / nearest | ✅ (= list order; no geometry yet) |
| Enemy | lowest HP (to finish) | ✅ |
| Enemy | highest HP | ⏳ |
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

## Maneuvers — `Command` + `Object`

A Maneuver is a **Command** plus (for some commands) an **Object**. It acts on
the **State's subject** (the matched unit). The four commands:

| Command | Object | Status |
|---|---|---|
| **Attack** | — (basic hit, no cost) | ✅ |
| **Use Skill** | a skill (see below) | ✅ |
| **Use Item** | a consumable item (see below) | ⏳ |
| **Flee** | — (disengage) | ⏳ (modelled; no effect yet) |

### `Use Skill · <skill>`

| Skill | Sensible target | Notes | Status |
|---|---|---|---|
| **Heavy Strike** | Enemy | more damage, slower / costs a charge | ⏳ |
| **Fire / Ice / Lightning** | Enemy | elemental; weaknesses later | ⏳ |
| **Finisher** | Enemy | bonus vs low-HP targets | ⏳ |
| **Defend** | Self | halves incoming until next turn | ✅ |
| **Mend** | Self / Ally | heal (was "Cure"; renamed) | ✅ |
| **Greater Mend** | Self / Ally | bigger heal | ⏳ |
| **Revive** | Ally (downed) | | ⏳ |
| **Cleanse** | Self / Ally | remove a status | ⏳ |
| **Shield / Barrier** | Self / Ally | prevent incoming damage | ⏳ |
| **Haste / Power / Protect** | Self / Ally | buffs | ⏳ |
| **Poison / Slow / Weaken** | Enemy | debuffs | ⏳ |
| **Taunt** | Self (vs enemies) | force enemies to target this unit | ⏳ |
| **Flee** | Self | disengage | ⏳ |
| **Wait** | Self | skip to build a resource | ⏳ |

> A Maneuver whose skill doesn't fit the State's subject (e.g. `Mend` on an
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

// Maneuver = Command + Object. Attack/Flee take no Object; Use Skill/Item name one.
type Maneuver =
  | { command: 'attack' }
  | { command: 'flee' }
  | { command: 'useSkill'; skill: SkillId } // skill IS the Object
  | { command: 'useItem';  item: ItemId }   // item  IS the Object

interface Protocol { state: State; maneuver: Maneuver }
type Procedure = Protocol[] // ordered; first matching State wins; acts on State.subject
```

The editor builds a State from two dropdowns (Subject, Predicate) and a Maneuver
from a Command dropdown plus a **contextual** Object dropdown (shown only for
`Use Skill` / `Use Item`) — composition, no target picker. **Target resolution is
filter-then-pick:** candidates of the subject class are filtered by the predicate,
*then* the pick (`any`/`nearest`/`lowestHp`) selects among those that pass; an
empty result means the State does not hold.

## The combat vocabulary that exists today

> Historical note: this started as a fixed 2-hero party (slices 1–3); the team is now
> **player-authored point-buy golems** (no predefined units — see
> [COMBAT-SYSTEM.md](COMBAT-SYSTEM.md)), and behaviour is authored in code
> ([INSCRIPTION-LANG.md](INSCRIPTION-LANG.md) §3 maps each item below to its code form,
> e.g. `Ally · lowest HP` → `senses.allies.lowest_hp`). Each golem runs its **own**
> Procedure; units act on the **CTB** schedule (Celerity-ordered, not round-robin).

The vocabulary items wired in `src/content/` (the catalog the language and the sim
share):

- **Subjects:** `Self`, `Ally · any`, `Ally · lowest HP`, `Enemy · nearest`,
  `Enemy · lowest HP`, `Enemy · most HP` (the last ships **locked** — bought with
  Insight at the Library).
- **Predicates:** `Always`, `HP < 30%`, `HP < 50%`, `HP = 100%`.
- **Maneuvers:** `Attack`, `Use Skill · Mend` (Mend ships **locked**),
  `Use Skill · Defend`, `Flee` (modelled, no effect yet).
