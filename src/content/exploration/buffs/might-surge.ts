import type { BuffDef } from '../../../delve'

// Surge of Might — a run-scoped boon: DOUBLE every golem's Might for the rest of the
// delve. Applied once on pickup; persists because the party is carried into every
// future encounter (makeBattleFrom reads these stats). A relative buff (×2), so it
// scales with whatever the build already is.
export default {
  id: 'might-surge',
  label: 'Surge of Might',
  order: 10,
  apply: (s) => ({ ...s, party: s.party.map((u) => ({ ...u, might: u.might * 2 })) }),
} satisfies BuffDef
