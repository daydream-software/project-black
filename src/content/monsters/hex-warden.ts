import type { MonsterDef } from '../../sim'
import { attackNearest } from '../combat/procedures'
import { counterHeal } from '../combat/reactions/counter-heal'

// The slice-4 "wall", defined by its own intelligence (like a player's golem, but
// authored by us): it attacks the nearest enemy AND owns a counter-heal reaction —
// whenever a hero is healed it strikes the healed unit for 4, more than a Mend
// restores, so the naive "Mend when an ally is low" Procedure is a trap. Off-balance
// and unbounded (monsters ignore the player's caps): a big Fortitude pool so it
// survives the fast Mender's front-load. Tuned against the slice-4 discriminating
// tests under the CTB schedule.
export default {
  id: 'hex-warden',
  name: 'Hex Warden',
  might: 4,
  ward: 0,
  fortitude: 10,
  attunement: 0,
  poise: 0,
  celerity: 4,
  procedure: [attackNearest()],
  reactions: [counterHeal(4)],
  isBoss: true,
} satisfies MonsterDef
