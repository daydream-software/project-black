// The combat targeting primitives a Subject file composes: the candidate-class
// selectors (who a Subject looks at) and the pick strategies (how it narrows to one).
// These USED to be central switches in sim.ts (candidatesFor / pickOne); they now
// live in content so the engine never enumerates subject/pick variants — a Subject
// file declares which candidate set and which pick it uses, and a new pick strategy
// is a new export here, not an edit to the engine.

import type { Combatant } from '../../sim'

/** Just the actor, if alive (the `self` subject class). */
export function selfIfAlive(self: Combatant): Combatant[] {
  return self.hp > 0 ? [self] : []
}

/** Living units on the actor's own side (allies include self). */
export function livingAllies(self: Combatant, units: Combatant[]): Combatant[] {
  return units.filter((u) => u.hp > 0 && u.side === self.side)
}

/** Living units on the opposing side. */
export function livingEnemies(self: Combatant, units: Combatant[]): Combatant[] {
  return units.filter((u) => u.hp > 0 && u.side !== self.side)
}

/** First in list order ("nearest"). Null on an empty candidate set. */
export function pickFirst(list: Combatant[]): Combatant | null {
  return list[0] ?? null
}

/** By HP ratio; strict comparison keeps the earliest on a tie. */
function byHpRatio(list: Combatant[], want: 'low' | 'high'): Combatant | null {
  if (list.length === 0) return null
  let best = list[0]
  for (const u of list) {
    const r = u.hp / u.maxHp
    const b = best.hp / best.maxHp
    if (want === 'low' ? r < b : r > b) best = u
  }
  return best
}

/** The most-hurt candidate (lowest HP ratio). */
export function pickLowestHp(list: Combatant[]): Combatant | null {
  return byHpRatio(list, 'low')
}

/** The healthiest candidate (highest HP ratio) — focus-fire the biggest threat. */
export function pickHighestHp(list: Combatant[]): Combatant | null {
  return byHpRatio(list, 'high')
}
