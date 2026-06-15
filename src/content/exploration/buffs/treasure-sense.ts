import type { BuffDef } from '../../../delve'

// Treasure Sense — reveal every LOOT room's location (their types become known across
// the map, so a "head for loot if known" rule can route to them from anywhere). A
// narrower vision buff than the Cartographer's Eye: only loot rooms join `revealed`.
export default {
  id: 'treasure-sense',
  label: 'Treasure Sense',
  order: 50,
  apply: (s) => {
    const loot = s.graph.rooms.filter((r) => r.type === 'loot').map((r) => r.id)
    return { ...s, revealed: [...new Set([...s.revealed, ...loot])] }
  },
} satisfies BuffDef
