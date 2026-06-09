// The RUN layer — the outer loop above a single encounter.
//
// A run is a gauntlet of escalating encounters that plays itself. This module is
// PURE (like sim.ts): `stepRun` advances the inner battle one unit-action and,
// when an encounter resolves, transitions the run — carrying the surviving party
// (HP and deaths persist: attrition is the run's pressure) into the next
// encounter, declaring the run cleared after the last, or dead on a loss.
//
// Design rule #2 (no rescue): the player does not act during a run; they author
// Procedures at camp, launch, and live with the result — then learn from the
// journal and try again. See docs/VISION.md.

import { makeBattle, step, type Combatant, type EncounterId, type GameState } from './sim'

export type RunStatus = 'fighting' | 'cleared' | 'dead'

export interface RunState {
  /** Hero units carried across encounters (HP and deaths persist within a run). */
  party: Combatant[]
  /** The ordered encounters this run must clear. */
  gauntlet: EncounterId[]
  /** Index of the current encounter in the gauntlet. */
  depth: number
  /** The current encounter. */
  battle: GameState
  status: RunStatus
}

/** The default gauntlet: a gentle opener, a pack, then the first wall. */
export const DEFAULT_GAUNTLET: EncounterId[] = ['duo', 'pack', 'warden']

export function startRun(party: Combatant[], gauntlet: EncounterId[] = DEFAULT_GAUNTLET): RunState {
  return { party, gauntlet, depth: 0, battle: makeBattle(party, gauntlet[0]), status: 'fighting' }
}

/** Snapshot the hero units (winners and corpses) coming out of an encounter. */
function carryParty(battle: GameState): Combatant[] {
  return battle.units.filter((u) => u.side === 'hero').map((u) => ({ ...u }))
}

/**
 * Advance the run by one unit-action. Stepping a finished run is a no-op.
 * When the inner battle resolves: a defeat ends the run; a victory either
 * advances to the next encounter (carrying the party) or, if it was the last,
 * clears the run.
 */
export function stepRun(run: RunState): RunState {
  if (run.status !== 'fighting') return run

  const battle = step(run.battle)
  if (battle.outcome === 'ongoing') return { ...run, battle }

  const party = carryParty(battle)
  if (battle.outcome === 'defeat') return { ...run, battle, party, status: 'dead' }

  // victory
  const next = run.depth + 1
  if (next >= run.gauntlet.length) return { ...run, battle, party, status: 'cleared' }
  return { ...run, party, depth: next, battle: makeBattle(party, run.gauntlet[next]), status: 'fighting' }
}
