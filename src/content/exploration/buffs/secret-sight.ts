import type { BuffDef } from '../../../delve'

// Secret Sight — uncover every HIDDEN room on the map: their ids join `revealed`, so a
// secret room becomes known (its type shows on the minimap) AND a routable one-step
// target where it adjoins explored ground — a "head for loot" rule can then make for it.
// It stays "revealed ≠ explored": the generic frontier explorer still won't wander in,
// so reaching a secret room remains a DELIBERATE, programmed choice.
export default {
  id: 'secret-sight',
  label: 'Secret Sight',
  order: 70,
  apply: (s) => {
    const hidden = s.graph.rooms.filter((r) => r.hidden === true).map((r) => r.id)
    return { ...s, revealed: [...new Set([...s.revealed, ...hidden])] }
  },
} satisfies BuffDef
