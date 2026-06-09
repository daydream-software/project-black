// Deterministic combat simulation.
//
// This module is PURE: no DOM, no canvas, no timers, no randomness. Given the
// same inputs it always produces the same outputs. That is what makes it
// testable in a way that genuinely fails when the logic breaks — and what will
// later make AFK offline-catch-up trivial (just replay `step` N times).

export type ActionKind = 'attack' | 'heal' | 'defend'

export interface Combatant {
  name: string
  hp: number
  maxHp: number
  atk: number
}

// A condition for a protocol (inspired by FF12 gambits). Conditions can inspect
// either the actor itself or its current enemy.
export type Condition =
  | { kind: 'selfHpPctBelow'; value: number }
  | { kind: 'enemyHpPctBelow'; value: number }
  | { kind: 'selfHpFull' }
  | { kind: 'always' }

/** One protocol: "if <condition> then <action>". */
export interface Protocol {
  condition: Condition
  action: ActionKind
  /** Human-readable text shown in the editor and the decision log. */
  label: string
}

/** A unit's ordered list of protocols. */
export type Procedure = Protocol[]

export interface Decision {
  action: ActionKind
  /** Index of the protocol that fired, or -1 if none matched (default behaviour). */
  ruleIndex: number
  reason: string
}

/** Does this condition hold given the actor and its current enemy? */
export function conditionHolds(cond: Condition, self: Combatant, enemy: Combatant): boolean {
  switch (cond.kind) {
    case 'always':
      return true
    case 'selfHpFull':
      return self.hp >= self.maxHp
    case 'selfHpPctBelow':
      return (self.hp / self.maxHp) * 100 < cond.value
    case 'enemyHpPctBelow':
      return (enemy.hp / enemy.maxHp) * 100 < cond.value
  }
}

/**
 * THE core function: the rule engine running a unit's procedure (inspired by FF12
 * gambits). Scan the protocols top-to-bottom; the first whose condition holds
 * wins. Priority order is the whole game: the player programs by ordering protocols.
 */
export function decide(self: Combatant, enemy: Combatant, procedure: Procedure): Decision {
  for (let i = 0; i < procedure.length; i++) {
    const protocol = procedure[i]
    if (conditionHolds(protocol.condition, self, enemy)) {
      return { action: protocol.action, ruleIndex: i, reason: protocol.label }
    }
  }
  return { action: 'attack', ruleIndex: -1, reason: 'no protocol matched — default attack' }
}

// ---------------------------------------------------------------------------
// Game state + advancement
// ---------------------------------------------------------------------------

export interface LogEntry {
  turn: number
  hpBefore: number
  maxHp: number
  decision: Decision
  detail: string
}

export interface GameState {
  hero: Combatant
  enemy: Combatant
  turn: number
  slimesDefeated: number
  log: LogEntry[]
}

export const HEAL_AMOUNT = 20

export function makeSlime(index: number): Combatant {
  return { name: `Slime #${index}`, hp: 24, maxHp: 24, atk: 7 }
}

export function initialState(): GameState {
  return {
    hero: { name: 'Adventurer', hp: 100, maxHp: 100, atk: 8 },
    enemy: makeSlime(1),
    turn: 0,
    slimesDefeated: 0,
    log: [],
  }
}

/**
 * Advance the simulation by one turn (pure: returns a new state).
 * Turn order: the hero acts per its protocols, then — if still alive — the enemy
 * retaliates (halved if the hero defended). A defeated slime is replaced by a
 * fresh one (endless loop). Once the hero is dead, stepping is a no-op.
 */
export function step(state: GameState, procedure: Procedure): GameState {
  if (state.hero.hp <= 0) return state

  const turn = state.turn + 1
  const hero = { ...state.hero }
  let enemy = { ...state.enemy }
  let slimesDefeated = state.slimesDefeated
  const hpBefore = hero.hp

  const decision = decide(hero, enemy, procedure)
  let detail: string
  let defending = false

  if (decision.action === 'heal') {
    const before = hero.hp
    hero.hp = Math.min(hero.maxHp, hero.hp + HEAL_AMOUNT)
    detail = `HEAL +${hero.hp - before} (HP ${before} → ${hero.hp})`
  } else if (decision.action === 'defend') {
    defending = true
    detail = `DEFEND (incoming damage halved)`
  } else {
    const before = enemy.hp
    enemy.hp = Math.max(0, enemy.hp - hero.atk)
    detail = `ATTACK −${hero.atk} → ${enemy.name} (HP ${before} → ${enemy.hp})`
  }

  if (enemy.hp <= 0) {
    slimesDefeated += 1
    detail += ` • ${enemy.name} defeated!`
    enemy = makeSlime(slimesDefeated + 1)
  } else {
    const dmg = defending ? Math.ceil(enemy.atk / 2) : enemy.atk
    const before = hero.hp
    hero.hp = Math.max(0, hero.hp - dmg)
    detail += ` • retaliates −${dmg} (HP ${before} → ${hero.hp})`
    if (hero.hp <= 0) detail += ` • ${hero.name} is defeated!`
  }

  const entry: LogEntry = { turn, hpBefore, maxHp: hero.maxHp, decision, detail }
  const log = [...state.log, entry].slice(-50)

  return { hero, enemy, turn, slimesDefeated, log }
}
