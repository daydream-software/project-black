// Deterministic combat simulation.
//
// This module is PURE: no DOM, no canvas, no timers, no randomness. Given the
// same inputs it always produces the same outputs. That is what makes it testable
// in a way that genuinely fails when the logic breaks, and what keeps a delve
// reproducible so the journal is trustworthy. (There is no offline catch-up — a
// delve resumes in real time; see docs/ARCHITECTURE.md.)
//
// The rule language (see docs/VOCABULARY.md):
//   Protocol  = WHEN <State> → DO <Maneuver>
//   State     = Subject + Predicate     (the Subject IS the target — no picker)
//   Maneuver  = Command + Object         (Attack / Use Skill · X / Use Item · Y / Flee)
//   Procedure = ordered Protocols; first State that holds wins (priority = order)
//
// Grammar symmetry: the State's Subject is WHO is acted on; the Maneuver's
// Object is WHAT is wielded (the chosen skill/item). Attack and Flee take no
// Object, just as a bare predicate needs no qualifier.

export type Side = 'hero' | 'enemy'

/**
 * The six stats (see docs/COMBAT-SYSTEM.md — the canonical reference). Each owns
 * a distinct lever; a build is a point in this space. Compact 0–12 scale: a point
 * is defined by its *cadence effect*, so the displayed number IS the impact.
 *
 *   Might      physical damage dealt by Attack
 *   Ward       FLAT reduction on ALL incoming damage (anti-swarm: trivialises
 *              chip, barely dents a big hit) — distinct from Fortitude's buffer
 *   Fortitude  health pool — maxHp = fortitude × HP_PER_FORTITUDE
 *   Attunement potency of skills (the strength of Mend / other arcane Maneuvers)
 *   Poise      Strain tolerance — how much channeling before overdraw bites
 *              Fortitude. STORED but not yet wired (Strain is a later slice).
 *   Celerity   action frequency / turn order. STORED but not yet wired — turn
 *              order is still fixed round-robin; CTB is a later slice.
 */
export interface Stats {
  might: number
  ward: number
  fortitude: number
  attunement: number
  poise: number
  celerity: number
}

export interface Combatant extends Stats {
  /** Stable identity used for targeting and the decision log. */
  id: string
  name: string
  side: Side
  hp: number
  maxHp: number
  /** Set when the unit Defends; halves incoming damage until its next turn. */
  defending: boolean
  /**
   * CTB scheduler clock (battle-scoped): time until this unit's next turn — the
   * unit with the LEAST charge acts next, so higher Celerity (smaller `recovery`)
   * means more frequent turns. Reset each battle by `makeBattle` (unlike `strain`,
   * which is delve-scoped and persists). Optional/absent defaults to `recovery`.
   */
  charge?: number
  /** This unit's own ordered rule list. */
  procedure: Procedure
  /**
   * Accumulated arcane Strain (see docs/COMBAT-SYSTEM.md). Each skill cast adds to
   * it; while `strain ≤ poise` casting is free, beyond Poise the overflow frays the
   * caster's Fortitude (overdraw). It is a **delve-scoped budget** — it persists
   * across fights and rests and only cools at the tower (a fresh delve starts at 0).
   * Optional/absent = 0 (defensive: a save written before Strain reads as 0).
   */
  strain?: number
  /**
   * Wall trait: when an enemy of this unit is healed, this unit strikes the
   * healed target for this much (it feeds on / punishes restorative magic).
   * Undefined / 0 = no counter. Drives the slice-4 "counter-heal" wall.
   */
  counterHeal?: number
  /** Render hint: draw larger / mark as a boss. */
  isBoss?: boolean
}

/** HP a single Fortitude point grants. The fortitude→pool factor (a free tuning
 *  knob, kept small so each point is a visible ~1–2 hits on the compact scale). */
export const HP_PER_FORTITUDE = 4

/** maxHp for a given Fortitude on the compact scale. */
export function poolFor(fortitude: number): number {
  return fortitude * HP_PER_FORTITUDE
}

/** Minimum damage of any landed hit — the Ward floor, so high Ward shaves chip
 *  damage to a trickle but can never make a unit literally unkillable. */
export const MIN_DAMAGE = 1

/**
 * Physical damage `attacker` deals to `target` with an Attack: Might minus the
 * target's flat Ward, floored at MIN_DAMAGE, then halved (round up) if the target
 * is Defending. Flat Ward is what makes it anti-swarm — it eats a 3-Might slime's
 * chip but barely dents a 6-Might boss.
 */
export function attackDamage(attacker: Combatant, target: Combatant): number {
  const base = Math.max(MIN_DAMAGE, attacker.might - target.ward)
  return target.defending ? Math.ceil(base / 2) : base
}

/** How much a unit's Mend restores — its Attunement (skill potency). */
export function healAmount(healer: Combatant): number {
  return healer.attunement
}

/** Strain a single Mend cast adds to its caster. Strawman — the whole
 *  Strain economy is tuned in play; this is the one knob to turn first. */
export const MEND_STRAIN = 2

/**
 * The overdraw a cast inflicts: adding `cost` Strain to a caster currently at
 * `strain` (cap `poise`), how much of THIS cast lands above Poise — that overflow
 * is paid in Fortitude (HP). Under Poise the cast is free (0). Pure + exported so
 * the Strain economy is unit-testable without driving a whole battle.
 */
export function overdraw(strain: number, poise: number, cost: number): number {
  return Math.max(0, strain + cost - Math.max(poise, strain))
}

/** CTB scheduler base — the "time" a Celerity-1 golem waits between turns. The
 *  whole turn order is FFX-style CTB (not round-robin, not a filling ATB bar):
 *  each unit's next turn comes back after `recovery(celerity)`, integer-quantised
 *  so the schedule never drifts and the journal stays trustworthy. */
export const SCHED_BASE = 120

/**
 * Time until a unit of this Celerity gets its next turn (smaller = sooner, so
 * higher Celerity acts more often). Floored at Celerity 1 — a Celerity-0 golem is
 * merely the slowest, never frozen. `recovery(12):recovery(10):recovery(8)` =
 * `10:12:15`, i.e. a `6:5:4` share of turns over time.
 */
export function recovery(celerity: number): number {
  return Math.round(SCHED_BASE / Math.max(1, celerity))
}

/** This unit's current scheduler charge, defaulting to a fresh `recovery` if a
 *  save predates the CTB field (defensive — never NaN). */
function chargeOf(u: Combatant): number {
  return u.charge ?? recovery(u.celerity)
}

/** The living unit scheduled to act next: least charge, ties broken by lowest
 *  index (deterministic). Returns -1 if nothing is alive. */
function nextActor(units: Combatant[]): number {
  let best = -1
  for (let i = 0; i < units.length; i += 1) {
    if (units[i].hp <= 0) continue
    if (best === -1 || chargeOf(units[i]) < chargeOf(units[best])) best = i
  }
  return best
}

/**
 * The next `n` unit ids in CTB order, WITHOUT mutating or applying any actions —
 * a pure projection (clone charges, run pick/advance/reset n times) that assumes
 * current HP. Shares `nextActor` with `step` so the carousel can never disagree
 * with the real schedule. Drives the turn-order carousel.
 */
export function upcomingTurns(units: Combatant[], n: number): string[] {
  let sim = units.map((u) => ({ ...u, charge: chargeOf(u) }))
  const order: string[] = []
  for (let k = 0; k < n; k += 1) {
    const idx = nextActor(sim)
    if (idx < 0) break
    const m = chargeOf(sim[idx])
    sim = sim.map((u) => (u.hp > 0 ? { ...u, charge: chargeOf(u) - m } : u))
    order.push(sim[idx].id)
    sim[idx] = { ...sim[idx], charge: recovery(sim[idx].celerity) }
  }
  return order
}

// --- State = Subject + Predicate -------------------------------------------

/**
 * How to pick one unit among those matching a Subject's class+predicate.
 * `first` covers "any" and "nearest" — there is no geometry yet, so "nearest"
 * is operationally the front of the list (lowest index). `lowestHp` picks the
 * most-hurt by HP ratio; `highestHp` picks the healthiest (focus the biggest
 * threat — the boss/tank); both tie-broken by index.
 */
export type Pick = 'first' | 'lowestHp' | 'highestHp'

export type Subject =
  | { who: 'self' }
  | { who: 'ally'; pick: Pick } // allies = same side, INCLUDING self
  | { who: 'enemy'; pick: Pick }

export type Predicate =
  | { p: 'hpPctBelow'; value: number }
  | { p: 'hpFull' }
  | { p: 'always' }

export interface State {
  subject: Subject
  predicate: Predicate
}

// --- Maneuver = Command + which --------------------------------------------

/** Skills are the "Use Skill" Objects (Attack and Flee are their own commands). */
export type SkillId = 'mend' | 'defend'

/**
 * A Maneuver mirrors a State: a Command plus (for some commands) an Object.
 * `attack` / `flee` take no Object; `useSkill` / `useItem` name which one
 * (`skill` / `item` ARE the Object). `useItem` is modelled but not yet wired —
 * composition stays open for later.
 */
export type Maneuver =
  | { command: 'attack' }
  | { command: 'flee' }
  | { command: 'useSkill'; skill: SkillId }
  | { command: 'useItem'; item: string }

export interface Protocol {
  state: State
  maneuver: Maneuver
  /** Human-readable text shown in the editor and the decision log. */
  label: string
}

/** A unit's ordered list of protocols (priority = order). */
export type Procedure = Protocol[]

export interface Decision {
  /** Index of the protocol that fired, or -1 for the default fallback. */
  protocolIndex: number
  maneuver: Maneuver
  /** The resolved target (the State's subject), or null if nothing applies. */
  targetId: string | null
  reason: string
}

// --- Target resolution: the heart of this slice ----------------------------

/** Does this predicate hold for a given unit? */
export function predicateHolds(pred: Predicate, u: Combatant): boolean {
  switch (pred.p) {
    case 'always':
      return true
    case 'hpFull':
      return u.hp >= u.maxHp
    case 'hpPctBelow':
      return (u.hp / u.maxHp) * 100 < pred.value
  }
}

/** Living units matching the Subject's class (self / ally / enemy). */
function candidatesFor(subject: Subject, self: Combatant, units: Combatant[]): Combatant[] {
  switch (subject.who) {
    case 'self':
      return self.hp > 0 ? [self] : []
    case 'ally':
      return units.filter((u) => u.hp > 0 && u.side === self.side)
    case 'enemy':
      return units.filter((u) => u.hp > 0 && u.side !== self.side)
  }
}

/** Choose one unit from a non-empty candidate list per the pick strategy. */
function pickOne(pick: Pick, list: Combatant[]): Combatant | null {
  if (list.length === 0) return null
  if (pick === 'first') return list[0]
  // lowestHp / highestHp: by HP ratio; strict comparison keeps the earliest on a tie.
  let best = list[0]
  for (const u of list) {
    const r = u.hp / u.maxHp
    const b = best.hp / best.maxHp
    if (pick === 'lowestHp' ? r < b : r > b) best = u
  }
  return best
}

/**
 * Resolve a State to a concrete target unit, or null if the State does not hold.
 *
 * Order is FILTER-then-PICK: we keep only the candidates that pass the
 * predicate, *then* pick among those. That makes "Ally lowest-HP · HP<50%" mean
 * "the most-hurt ally that is also below 50%", not "the most-hurt ally, only if
 * it happens to be below 50%". An empty result means the State is false.
 */
export function resolveTarget(state: State, self: Combatant, units: Combatant[]): Combatant | null {
  const passing = candidatesFor(state.subject, self, units).filter((u) => predicateHolds(state.predicate, u))
  const pick: Pick = state.subject.who === 'self' ? 'first' : state.subject.pick
  return pickOne(pick, passing)
}

/**
 * THE core function: run a unit's procedure. Scan its protocols top-to-bottom;
 * the first whose State resolves to a target wins, and that target is what the
 * Maneuver acts on. Falls back to attacking the nearest enemy.
 */
export function decide(self: Combatant, units: Combatant[]): Decision {
  for (let i = 0; i < self.procedure.length; i += 1) {
    const protocol = self.procedure[i]
    const target = resolveTarget(protocol.state, self, units)
    if (target !== null) {
      return { protocolIndex: i, maneuver: protocol.maneuver, targetId: target.id, reason: protocol.label }
    }
  }
  const enemy = units.find((u) => u.hp > 0 && u.side !== self.side)
  return {
    protocolIndex: -1,
    maneuver: { command: 'attack' },
    targetId: enemy?.id ?? null,
    reason: 'no protocol matched — attack',
  }
}

/** The log/CSS family a maneuver belongs to (drives colour in the UI). */
export function maneuverKind(m: Maneuver): 'attack' | 'heal' | 'defend' | 'flee' {
  if (m.command === 'attack') return 'attack'
  if (m.command === 'flee') return 'flee'
  if (m.command === 'useItem') return 'heal'
  return m.skill === 'mend' ? 'heal' : 'defend'
}

// ---------------------------------------------------------------------------
// Game state + advancement
// ---------------------------------------------------------------------------

export type Outcome = 'ongoing' | 'victory' | 'defeat'

/** Log/CSS family. `counter` is the enemy's reactive punish, not a maneuver. */
export type LogKind = 'attack' | 'heal' | 'defend' | 'flee' | 'counter'

export interface LogEntry {
  turn: number
  round: number
  actorId: string
  actorName: string
  kind: LogKind
  targetName: string | null
  protocolIndex: number
  reason: string
  detail: string
}

export interface GameState {
  /** All combatants, heroes first then enemies, in fixed action order. */
  units: Combatant[]
  turn: number // total unit-actions taken
  round: number
  /** Index in `units` of the unit that acted last (-1 before the first action). */
  cursor: number
  log: LogEntry[]
  outcome: Outcome
}

// Enemies share one trivial Procedure: hit the nearest hero. Generic by side —
// from a slime's perspective "enemy" is the party.
const ENEMY_PROCEDURE: Procedure = [
  {
    state: { subject: { who: 'enemy', pick: 'first' }, predicate: { p: 'always' } },
    maneuver: { command: 'attack' },
    label: 'Enemy nearest · Always → Attack',
  },
]

/** A unit's defining fields (everything except the derived hp/maxHp/defending). */
type UnitSpec = Stats & {
  id: string
  name: string
  side: Side
  procedure: Procedure
  counterHeal?: number
  isBoss?: boolean
}

/** Build a Combatant from a stat block: maxHp derives from Fortitude, hp starts
 *  full. Keeps every builder honest about the stat → pool relationship. */
function makeUnit(base: UnitSpec): Combatant {
  const maxHp = poolFor(base.fortitude)
  return { ...base, hp: maxHp, maxHp, defending: false, strain: 0 }
}

// Slime: a feeble chip-attacker with no Ward — the unit Ward is designed to shrug.
export function makeEnemy(index: number): Combatant {
  return makeUnit({
    id: `enemy-${index}`,
    name: `Slime #${index}`,
    side: 'enemy',
    might: 3,
    ward: 0,
    fortitude: 4,
    attunement: 0,
    poise: 0,
    celerity: 4,
    procedure: ENEMY_PROCEDURE,
  })
}

/**
 * The slice-4 "wall": a single boss that punishes restorative magic. Every time
 * a hero is healed, the Warden strikes the healed unit for `counterHeal`, which
 * more than undoes the Mend — so the naive "Mend when an ally is low" Procedure
 * is a trap. The only fix in the shipped vocabulary is for the Mender to STOP
 * mending and add its damage to the race instead (the Sentinel tanks on its own
 * Self·HP<30%→Defend rule). Tuned so the mend-spam default genuinely wipes.
 */
export function makeWarden(): Combatant {
  return makeUnit({
    id: 'enemy-1',
    name: 'Hex Warden',
    side: 'enemy',
    // Off-balance and unbounded (monsters ignore the player's caps): a big
    // Fortitude pool so it survives the fast Mender's front-load, and a counter
    // that exceeds the Mender's heal so mend-spam is a net loss. Tuned against the
    // slice-4 discriminating tests under the CTB schedule.
    might: 6,
    ward: 1,
    fortitude: 18,
    attunement: 0,
    poise: 0,
    celerity: 4,
    procedure: ENEMY_PROCEDURE,
    counterHeal: 7,
    isBoss: true,
  })
}

/** Build a hero golem from an AUTHORED stat block + its Procedure — the generic,
 *  player-facing builder the point-buy editor feeds. (makeWarrior/makeHealer below
 *  are the fixed reference blocks used as test fixtures and the starting party.) */
export function makeGolem(spec: { id: string; name: string; stats: Stats; procedure: Procedure }): Combatant {
  return makeUnit({ id: spec.id, name: spec.name, side: 'hero', ...spec.stats, procedure: spec.procedure })
}

/** The two reference stat blocks (compact 0–12 scale): a Sentinel (Bulwark — Ward +
 *  Fortitude, tanks and hits) and a Mender (Channeler — Attunement + Poise, fragile,
 *  mends). The starting party authors these; the point-buy editor can re-spec them. */
export const SENTINEL_STATS: Stats = { might: 5, ward: 2, fortitude: 10, attunement: 0, poise: 0, celerity: 5 }
export const MENDER_STATS: Stats = { might: 3, ward: 0, fortitude: 5, attunement: 5, poise: 6, celerity: 6 }

export function makeWarrior(procedure: Procedure): Combatant {
  return makeGolem({ id: 'hero-1', name: 'Sentinel', stats: SENTINEL_STATS, procedure })
}

export function makeHealer(procedure: Procedure): Combatant {
  return makeGolem({ id: 'hero-2', name: 'Mender', stats: MENDER_STATS, procedure })
}

export type EncounterId = 'duo' | 'pack' | 'warden'

export interface Encounter {
  id: EncounterId
  name: string
  hint: string
}

export const ENCOUNTERS: Encounter[] = [
  { id: 'duo', name: 'Two Slimes', hint: 'A gentle opener.' },
  { id: 'pack', name: 'Slime Pack', hint: 'A naive Procedure clears it.' },
  { id: 'warden', name: 'Hex Warden', hint: 'Punishes healing — the first wall.' },
]

function encounterEnemies(id: EncounterId): Combatant[] {
  switch (id) {
    case 'warden':
      return [makeWarden()]
    case 'duo':
      return [makeEnemy(1), makeEnemy(2)]
    case 'pack':
      return [makeEnemy(1), makeEnemy(2), makeEnemy(3)]
  }
}

/**
 * Build an encounter from EXISTING hero Combatants (HP, deaths, Procedures and
 * Strain carry in — Strain is delve-scoped). What's reset to a clean slate is
 * battle-scoped: a fresh `defending` flag, a fresh CTB `charge`, and a fresh
 * log/cursor.
 */
export function makeBattle(heroes: Combatant[], encounter: EncounterId): GameState {
  const units = [...heroes.map((h) => ({ ...h })), ...encounterEnemies(encounter)].map((u) => ({
    ...u,
    defending: false,
    charge: recovery(u.celerity), // battle-scoped: every fight starts the cadence fresh
  }))
  return { units, turn: 0, round: 0, cursor: -1, log: [], outcome: 'ongoing' }
}

/** Convenience: a one-off encounter against a freshly-built default party. */
export function initialState(warriorProc: Procedure, healerProc: Procedure, encounter: EncounterId = 'pack'): GameState {
  return makeBattle([makeWarrior(warriorProc), makeHealer(healerProc)], encounter)
}


/** Apply a resolved maneuver to the cloned units; return the log detail string. */
/* eslint-disable no-param-reassign -- actor/target/units below are step()'s local
   CLONES (the agreed data-oriented sim core): mutating their fields is intentional,
   never touches the caller's objects, and step() reads them back into a fresh
   immutable GameState. The whole resolution cluster shares this contract. */

/** Resolve a Mend onto its target: heal by Attunement, then bite the caster's own
 *  Fortitude for any Strain past Poise (Mend is a Fortitude → heal converter — same
 *  path in combat and at rest, "c'est Mend pareil"). */
function applyMend(actor: Combatant, target: Combatant | null): string {
  if (target !== null && target.side === actor.side && target.hp > 0) {
    const before = target.hp
    target.hp = Math.min(target.maxHp, target.hp + healAmount(actor))
    const restored = target.hp - before
    const healedTo = target.hp // capture before any self-overdraw rewrites it
    const sBefore = actor.strain ?? 0
    const bite = overdraw(sBefore, actor.poise, MEND_STRAIN)
    actor.strain = sBefore + MEND_STRAIN
    if (bite > 0) actor.hp = Math.max(0, actor.hp - bite)
    let detail = `MEND +${restored} → ${target.name} (HP ${before} → ${healedTo})`
    if (bite > 0) detail += ` • OVERDRAW −${bite} → ${actor.name} (Strain ${actor.strain} > Poise ${actor.poise})`
    return detail
  }
  return `MEND has no valid target — no effect` // dead rule: State held, turn consumed
}

/** Resolve an Attack onto its target: damage = Might − Ward (floored, halved when
 *  the target Defends). */
function applyAttack(actor: Combatant, target: Combatant | null): string {
  if (target !== null && target.side !== actor.side && target.hp > 0) {
    const before = target.hp
    const dmg = attackDamage(actor, target)
    target.hp = Math.max(0, target.hp - dmg)
    let detail = `ATTACK −${dmg} → ${target.name} (HP ${before} → ${target.hp})`
    if (target.hp <= 0) detail += ` • ${target.name} defeated!`
    return detail
  }
  return `${actor.name}'s maneuver has no valid target — no effect`
}

function applyManeuver(actor: Combatant, target: Combatant | null, maneuver: Maneuver): string {
  if (maneuver.command === 'flee') return `FLEE — ${actor.name} tries to disengage (no effect yet)`
  if (maneuver.command === 'useSkill' && maneuver.skill === 'defend') {
    actor.defending = true
    return `DEFEND — incoming damage halved until next turn`
  }
  if (maneuver.command === 'useSkill' && maneuver.skill === 'mend') return applyMend(actor, target)
  if (maneuver.command === 'attack') return applyAttack(actor, target)
  // a useItem we haven't wired — treated as attack-less
  return `${actor.name}'s maneuver has no valid target — no effect`
}

/** CTB heartbeat: subtract the winner's charge from every living unit (so the winner
 *  reaches 0 = now), then the winner pays a fresh `recovery` to queue its next turn. */
function advanceCharges(units: Combatant[], actorIdx: number): void {
  const spent = chargeOf(units[actorIdx])
  for (const u of units) if (u.hp > 0) u.charge = chargeOf(u) - spent
  const actor = units[actorIdx]
  actor.defending = false // its protection window closes as it gets to act again
  actor.charge = recovery(actor.celerity)
}

/** The wall reaction: every opposing unit with a counter-heal trait punishes the
 *  just-healed target. A REACTION (shares the turn), so it returns log entries to
 *  append rather than advancing the clock. Mutates `healed.hp` in place. */
function counterReactions(units: Combatant[], healed: Combatant, turn: number, round: number): LogEntry[] {
  const entries: LogEntry[] = []
  for (const c of units) {
    if (healed.hp <= 0) break
    const counter = c.counterHeal ?? 0
    if (c.hp <= 0 || c.side === healed.side || counter <= 0) continue
    const before = healed.hp
    healed.hp = Math.max(0, healed.hp - counter)
    let punish = `COUNTER −${counter} → ${healed.name} (HP ${before} → ${healed.hp})`
    if (healed.hp <= 0) punish += ` • ${healed.name} defeated!`
    entries.push({
      turn, round, actorId: c.id, actorName: c.name, kind: 'counter',
      targetName: healed.name, protocolIndex: -1, reason: 'punishes the heal', detail: punish,
    })
  }
  return entries
}
/* eslint-enable no-param-reassign */

/** Find the targeted unit in the (cloned) roster by id, or null. */
function findTargetById(units: Combatant[], targetId: string | null): Combatant | null {
  if (targetId === null) return null
  return units.find((u) => u.id === targetId) ?? null
}

/** Judge the battle from who is still standing. */
function outcomeOf(units: Combatant[]): Outcome {
  const heroesAlive = units.some((u) => u.side === 'hero' && u.hp > 0)
  const enemiesAlive = units.some((u) => u.side === 'enemy' && u.hp > 0)
  return heroesAlive ? (enemiesAlive ? 'ongoing' : 'victory') : 'defeat'
}

/**
 * Advance the simulation by ONE unit-action (pure: returns a new state). The
 * next living unit in turn order acts per its Procedure; deaths are skipped, and
 * wrapping past the first living unit ticks the cosmetic round counter. Stepping a
 * finished battle is a no-op.
 */
export function step(state: GameState): GameState {
  if (state.outcome !== 'ongoing') return state

  const idx = nextActor(state.units)
  if (idx < 0) return state // no living units at all (defensive)

  const units = state.units.map((u) => ({ ...u }))
  advanceCharges(units, idx)
  const actor = units[idx]

  const turn = state.turn + 1
  // `round` is now a cosmetic counter (CTB has no clean wrap): tick it whenever the
  // first living unit takes a turn — a soft "the order came around" marker.
  const firstLiving = units.findIndex((u) => u.hp > 0)
  const round = state.round + (idx === firstLiving ? 1 : 0)

  const decision = decide(actor, units)
  const kind = maneuverKind(decision.maneuver)
  const target = findTargetById(units, decision.targetId)
  const hpBefore = target === null ? 0 : target.hp
  const detail = applyManeuver(actor, target, decision.maneuver)

  const mainEntry: LogEntry = {
    turn,
    round,
    actorId: actor.id,
    actorName: actor.name,
    kind,
    targetName: target === null ? null : target.name,
    protocolIndex: decision.protocolIndex,
    reason: decision.reason,
    detail,
  }

  // If this action actually healed a unit, opposing counter-heal traits punish it
  // before we judge the outcome (the slice-4 wall).
  const healed = kind === 'heal' && target !== null && target.hp > hpBefore ? target : null
  const entries = healed === null ? [mainEntry] : [mainEntry, ...counterReactions(units, healed, turn, round)]

  return {
    units,
    turn,
    round,
    cursor: idx,
    log: [...state.log, ...entries].slice(-50),
    outcome: outcomeOf(units),
  }
}

/**
 * A REST (exploration): the party tends itself off-combat by running each living
 * golem's OWN Procedure against the party alone — no enemies. Attack/flee rules
 * resolve to null with no foes, so only Mend rules fire — "c'est Mend pareil":
 * the same skill, the same Attunement potency, the same Poise/Strain budget as in
 * combat (so resting is bounded, and a party with no healer gets nothing). It runs
 * to CONVERGENCE — passes repeat until one casts nothing (everyone is back above
 * their Mend thresholds) — so a rest is a single recovery EVENT, not a metered
 * per-step trickle ("si c'est un repos, ce n'est pas un pas"). Strain accrued here
 * carries on into the next fight; it only cools at the tower. Pure: returns fresh
 * units + how many Mends were cast.
 */
export function restToConvergence(party: Combatant[]): { units: Combatant[]; mends: number } {
  const units = party.map((u) => ({ ...u }))
  let mends = 0
  const cap = Math.max(1, units.length) * 16 // insurance against a pathological loop
  for (let pass = 0; pass < cap; pass += 1) {
    let castThisPass = false
    for (const actor of units) {
      if (actor.hp <= 0) continue
      const d = decide(actor, units)
      if (d.maneuver.command === 'useSkill' && d.maneuver.skill === 'mend' && d.targetId !== null) {
        applyManeuver(actor, units.find((u) => u.id === d.targetId) ?? null, d.maneuver)
        mends += 1
        castThisPass = true
      }
    }
    if (!castThisPass) break
  }
  return { units, mends }
}
