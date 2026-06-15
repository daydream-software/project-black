import type { BuffDef } from '../../../delve'

// Swift Wind — DOUBLE every golem's Celerity for the rest of the delve, so the party
// acts far more often (the CTB schedule reads Celerity when each battle is built).
// Persists for the run like the other party buffs.
export default {
  id: 'swift-wind',
  label: 'Swift Wind',
  order: 20,
  apply: (s) => ({ ...s, party: s.party.map((u) => ({ ...u, celerity: u.celerity * 2 })) }),
} satisfies BuffDef
