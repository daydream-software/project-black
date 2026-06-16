import type { MonsterDef } from '../../sim'
import { attackNearest } from '../combat/procedures'

// The slice-4 "wall", defined by its own intelligence (like a player's golem, but
// authored by us): it attacks the nearest enemy AND owns a counter-heal reaction —
// whenever a hero is healed it strikes the healed unit for 4, more than a Mend
// restores, so the naive "Mend when an ally is low" Procedure is a trap. Off-balance
// and unbounded (monsters ignore the player's caps): a big Fortitude pool so it
// survives the front-load. Re-tuned UP (Might 4→6, Fortitude 10→12) when golems
// gained a base-HP/Celerity floor — the buff had let the naive mend-spam survive, so
// the wall needed to hit harder to keep "naive mend loses / attack wins" crisp
// (grid-searched). Tuned against the slice-4 discriminating tests under the CTB schedule.
export default {
  id: 'hex-warden',
  name: 'Hex Warden',
  might: 6,
  ward: 0,
  fortitude: 12,
  attunement: 0,
  poise: 0,
  celerity: 4,
  procedure: [attackNearest()],
  reactions: [{ id: 'counter-heal', value: 4 }], // it OWNS a counter-heal of strength 4 (a serialisable ref)
  isBoss: true,
} satisfies MonsterDef
