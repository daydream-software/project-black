import type { Reaction, LogEntry } from '../../../sim'

// A counter-heal reaction (a reusable factory): whenever an ENEMY of the OWNER is
// healed, the owner strikes that healed unit for `strength` — more than a Mend
// restores, so the naive mend-spam Procedure is a net loss (the slice-4 wall). It's a
// factory so any monster can OWN one at its chosen strength; the Hex Warden composes
// `counterHeal(4)` in its definition. The reaction runs AS the owner (no global scan
// of a magic stat) — this is the monster's own intelligence.
export function counterHeal(strength: number): Reaction {
  return {
    id: 'counter-heal',
    order: 10,
    kind: 'heal',
    react: (event, owner, meta): LogEntry[] => {
      if (event.kind !== 'heal') return [] // narrow the union (the engine only calls us for 'heal')
      const { healed } = event
      if (healed.hp <= 0 || healed.side === owner.side) return [] // only an enemy's heal, only if it lived
      const before = healed.hp
      healed.hp = Math.max(0, healed.hp - strength)
      let detail = `COUNTER −${strength} → ${healed.name} (HP ${before} → ${healed.hp})`
      if (healed.hp <= 0) detail += ` • ${healed.name} defeated!`
      return [
        {
          turn: meta.turn,
          round: meta.round,
          actorId: owner.id,
          actorName: owner.name,
          kind: 'counter',
          targetName: healed.name,
          protocolIndex: -1,
          reason: 'punishes the heal',
          detail,
        },
      ]
    },
  }
}
