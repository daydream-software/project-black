import type { BuffDef } from '../../../delve'

// Mending Tide — a free, instant full heal: every golem back to max HP and clear of
// Strain. One-shot (no lasting hook); the cost is the detour to reach the room.
export default {
  id: 'mending-tide',
  label: 'Mending Tide',
  order: 30,
  apply: (s) => ({ ...s, party: s.party.map((u) => ({ ...u, hp: u.maxHp, strain: 0 })) }),
} satisfies BuffDef
