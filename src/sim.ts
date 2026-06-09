// Deterministic combat simulation.
//
// This module is PURE: no DOM, no canvas, no timers, no randomness. Given the
// same inputs it always produces the same outputs. That is what makes it
// testable in a way that genuinely fails when the logic breaks — and what will
// later make AFK offline-catch-up trivial (just replay `step` N times).
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

export interface Combatant {
  /** Stable identity used for targeting and the decision log. */
  id: string
  name: string
  side: Side
  hp: number
  maxHp: number
  atk: number
  /** Set when the unit Defends; halves incoming damage until its next turn. */
  defending: boolean
  /** This unit's own ordered rule list. */
  procedure: Procedure
  /**
   * Wall trait: when an enemy of this unit is healed, this unit strikes the
   * healed target for this much (it feeds on / punishes restorative magic).
   * Undefined / 0 = no counter. Drives the slice-4 "counter-heal" wall.
   */
  counterHeal?: number
  /** Render hint: draw larger / mark as a boss. */
  isBoss?: boolean
}

// --- State = Subject + Predicate -------------------------------------------

/**
 * How to pick one unit among those matching a Subject's class+predicate.
 * `first` covers "any" and "nearest" — there is no geometry yet, so "nearest"
 * is operationally the front of the list (lowest index). `lowestHp` picks the
 * most-hurt by HP ratio, tie-broken by index.
 */
export type Pick = 'first' | 'lowestHp'

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
export type SkillId = 'cure' | 'defend'

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
  // lowestHp: smallest HP ratio; strict `<` keeps the earliest on a tie.
  let best = list[0]
  for (const u of list) {
    if (u.hp / u.maxHp < best.hp / best.maxHp) best = u
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
  for (let i = 0; i < self.procedure.length; i++) {
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
  return m.skill === 'cure' ? 'heal' : 'defend'
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

export const HEAL_AMOUNT = 24

// Enemies share one trivial Procedure: hit the nearest hero. Generic by side —
// from a slime's perspective "enemy" is the party.
const ENEMY_PROCEDURE: Procedure = [
  {
    state: { subject: { who: 'enemy', pick: 'first' }, predicate: { p: 'always' } },
    maneuver: { command: 'attack' },
    label: 'Enemy nearest · Always → Attack',
  },
]

export function makeEnemy(index: number): Combatant {
  return {
    id: `enemy-${index}`,
    name: `Slime #${index}`,
    side: 'enemy',
    hp: 26,
    maxHp: 26,
    atk: 9,
    defending: false,
    procedure: ENEMY_PROCEDURE,
  }
}

/**
 * The slice-4 "wall": a single boss that punishes restorative magic. Every time
 * a hero is healed, the Warden strikes the healed unit for `counterHeal`, which
 * more than undoes the Cure — so the naive "Cure when an ally is low" Procedure
 * is a trap. The only fix in the shipped vocabulary is for the Healer to STOP
 * curing and add its damage to the race instead (the Warrior tanks on its own
 * Self·HP<30%→Defend rule). Tuned so the cure-spam default genuinely wipes.
 */
export function makeWarden(): Combatant {
  return {
    id: 'enemy-1',
    name: 'Hex Warden',
    side: 'enemy',
    hp: 120,
    maxHp: 120,
    atk: 14,
    defending: false,
    procedure: ENEMY_PROCEDURE,
    counterHeal: 30,
    isBoss: true,
  }
}

/** Default party: a Warrior (tanky, hits hard) and a Healer (fragile, cures). */
export function makeWarrior(procedure: Procedure): Combatant {
  return { id: 'hero-1', name: 'Warrior', side: 'hero', hp: 120, maxHp: 120, atk: 11, defending: false, procedure }
}

export function makeHealer(procedure: Procedure): Combatant {
  return { id: 'hero-2', name: 'Healer', side: 'hero', hp: 80, maxHp: 80, atk: 6, defending: false, procedure }
}

export type EncounterId = 'pack' | 'warden'

export interface Encounter {
  id: EncounterId
  name: string
  hint: string
}

export const ENCOUNTERS: Encounter[] = [
  { id: 'pack', name: 'Slime Pack', hint: 'A naive Procedure clears it.' },
  { id: 'warden', name: 'Hex Warden', hint: 'Punishes healing — the first wall.' },
]

function encounterEnemies(id: EncounterId): Combatant[] {
  return id === 'warden' ? [makeWarden()] : [makeEnemy(1), makeEnemy(2), makeEnemy(3)]
}

/** Build a fresh encounter: the 2-hero party vs the chosen enemy group. */
export function initialState(warriorProc: Procedure, healerProc: Procedure, encounter: EncounterId = 'pack'): GameState {
  return {
    units: [makeWarrior(warriorProc), makeHealer(healerProc), ...encounterEnemies(encounter)],
    turn: 0,
    round: 0,
    cursor: -1,
    log: [],
    outcome: 'ongoing',
  }
}

/** The next living unit to act after `cursor`, and whether we wrapped (new round). */
function nextLivingAfter(units: Combatant[], cursor: number): { idx: number; wrapped: boolean } | null {
  for (let i = cursor + 1; i < units.length; i++) if (units[i].hp > 0) return { idx: i, wrapped: false }
  for (let i = 0; i <= cursor; i++) if (units[i].hp > 0) return { idx: i, wrapped: true }
  return null
}

/** Apply a resolved maneuver to the cloned units; return the log detail string. */
function applyManeuver(actor: Combatant, target: Combatant | null, maneuver: Maneuver): string {
  if (maneuver.command === 'flee') {
    return `FLEE — ${actor.name} tries to disengage (no effect yet)`
  }

  const cure = maneuver.command === 'useSkill' && maneuver.skill === 'cure'
  const defend = maneuver.command === 'useSkill' && maneuver.skill === 'defend'

  if (defend) {
    actor.defending = true
    return `DEFEND — incoming damage halved until next turn`
  }

  if (cure) {
    if (target !== null && target.side === actor.side && target.hp > 0) {
      const before = target.hp
      target.hp = Math.min(target.maxHp, target.hp + HEAL_AMOUNT)
      return `CURE +${target.hp - before} → ${target.name} (HP ${before} → ${target.hp})`
    }
    return `CURE has no valid target — no effect` // dead rule: State held, turn consumed
  }

  // attack (the default command, or a useItem we haven't wired — treated as attack-less)
  if (maneuver.command === 'attack' && target !== null && target.side !== actor.side && target.hp > 0) {
    const before = target.hp
    const dmg = target.defending ? Math.ceil(actor.atk / 2) : actor.atk
    target.hp = Math.max(0, target.hp - dmg)
    let detail = `ATTACK −${dmg} → ${target.name} (HP ${before} → ${target.hp})`
    if (target.hp <= 0) detail += ` • ${target.name} defeated!`
    return detail
  }

  return `${actor.name}'s maneuver has no valid target — no effect`
}

/**
 * Advance the simulation by ONE unit-action (pure: returns a new state). The
 * next living unit in turn order acts per its Procedure; deaths are skipped, and
 * wrapping past the last unit starts a new round. Stepping a finished battle is
 * a no-op.
 */
export function step(state: GameState): GameState {
  if (state.outcome !== 'ongoing') return state

  const next = nextLivingAfter(state.units, state.cursor)
  if (next === null) return state // no living units at all (defensive)

  const units = state.units.map((u) => ({ ...u }))
  const actor = units[next.idx]
  actor.defending = false // its protection window closes as it gets to act again

  const turn = state.turn + 1
  const round = state.round + (next.wrapped ? 1 : 0)

  const decision = decide(actor, units)
  const target = decision.targetId !== null ? (units.find((u) => u.id === decision.targetId) ?? null) : null
  const hpBefore = target?.hp ?? 0
  const detail = applyManeuver(actor, target, decision.maneuver)

  const entries: LogEntry[] = [
    {
      turn,
      round,
      actorId: actor.id,
      actorName: actor.name,
      kind: maneuverKind(decision.maneuver),
      targetName: target?.name ?? null,
      protocolIndex: decision.protocolIndex,
      reason: decision.reason,
      detail,
    },
  ]

  // The wall: if this action actually healed a unit, every opposing unit with a
  // counter-heal trait punishes the healed target — a REACTION, so it shares the
  // turn (does not advance turn/cursor) and lands before we judge the outcome.
  const healed = target !== null && maneuverKind(decision.maneuver) === 'heal' && target.hp > hpBefore ? target : null
  if (healed !== null) {
    for (const c of units) {
      if (healed.hp <= 0) break
      const counter = c.counterHeal ?? 0
      if (c.hp <= 0 || c.side === healed.side || counter <= 0) continue
      const before = healed.hp
      healed.hp = Math.max(0, healed.hp - counter)
      let punish = `COUNTER −${counter} → ${healed.name} (HP ${before} → ${healed.hp})`
      if (healed.hp <= 0) punish += ` • ${healed.name} defeated!`
      entries.push({
        turn,
        round,
        actorId: c.id,
        actorName: c.name,
        kind: 'counter',
        targetName: healed.name,
        protocolIndex: -1,
        reason: 'punishes the heal',
        detail: punish,
      })
    }
  }

  const heroesAlive = units.some((u) => u.side === 'hero' && u.hp > 0)
  const enemiesAlive = units.some((u) => u.side === 'enemy' && u.hp > 0)
  const outcome: Outcome = !heroesAlive ? 'defeat' : !enemiesAlive ? 'victory' : 'ongoing'

  return {
    units,
    turn,
    round,
    cursor: next.idx,
    log: [...state.log, ...entries].slice(-50),
    outcome,
  }
}
