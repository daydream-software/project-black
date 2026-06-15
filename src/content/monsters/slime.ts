import type { MonsterDef } from '../../sim'

// A feeble chip-attacker with no Ward — the unit Ward is designed to shrug it.
// Compact scale (24-budget pass): a 3-pack is ~36 HP of trash a competent build
// clears, while staying lethal to a careless one. The factory templates the runtime
// id/name per pack member (`enemy-N` / `Slime #N`).
export default {
  id: 'slime',
  name: 'Slime',
  might: 2,
  ward: 0,
  fortitude: 3,
  attunement: 0,
  poise: 0,
  celerity: 4,
} satisfies MonsterDef
