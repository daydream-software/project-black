import type { ReactionDef, LogEntry } from '../../../sim'

// The slice-4 "wall" reaction: whenever an ENEMY of the OWNER is healed, the owner
// strikes that healed unit for `ref.value` — more than a Mend restores, so the naive
// mend-spam Procedure is a net loss. Dispatched by id, runs AS the owner. The strength
// is a PARAMETER on the owner's reaction ref (data), so the monster owns both that it
// has this reaction and how strong — and it all survives a save (no closures).
export default {
  id: 'counter-heal',
  kind: 'heal',
  react: (event, owner, ref, meta): LogEntry[] => {
    if (event.kind !== 'heal') return [] // narrow the union (the engine only calls us for 'heal')
    const strength = ref.value ?? 0
    const { healed } = event
    if (strength <= 0 || healed.hp <= 0 || healed.side === owner.side) return []
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
} satisfies ReactionDef
