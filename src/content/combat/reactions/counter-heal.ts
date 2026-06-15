import type { HealReaction, Combatant, LogEntry } from '../../../sim'

// The slice-4 "wall" reaction: when a unit is healed, every OPPOSING unit carrying a
// counterHeal trait value strikes the healed unit for that much (it feeds on / punishes
// restorative magic). A REACTION — it shares the turn, returning log entries to append
// rather than advancing the clock, and mutates `healed.hp` in place. The counterHeal
// VALUE is data on the monster def; this file owns the wall's LOGIC (sim.ts no longer
// hard-codes it). Tuned so the naive mend-spam Procedure genuinely wipes.
export default {
  id: 'counter-heal',
  order: 10,
  onHeal: (healed: Combatant, units: Combatant[], meta) => {
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
        turn: meta.turn,
        round: meta.round,
        actorId: c.id,
        actorName: c.name,
        kind: 'counter',
        targetName: healed.name,
        protocolIndex: -1,
        reason: 'punishes the heal',
        detail: punish,
      })
    }
    return entries
  },
} satisfies HealReaction
