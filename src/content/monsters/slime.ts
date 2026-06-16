import type { MonsterDef } from '../../sim'
import { attackNearest } from '../combat/procedures'

// A feeble chip-attacker with no Ward — the unit Ward is designed to shrug it. Its
// whole intelligence is "attack the nearest enemy"; no reactions. Slow trash
// (Celerity 2): kept gentle so a low-Celerity golem isn't ground out by a pack before
// it can swing (the lvl-1 softlock fix — see memory combat-celerity-cliff). The factory
// templates the runtime id/name per pack member (`enemy-N` / `Slime #N`).
export default {
  id: 'slime',
  name: 'Slime',
  might: 2,
  ward: 0,
  fortitude: 3,
  attunement: 0,
  poise: 0,
  celerity: 2,
  procedure: [attackNearest()],
} satisfies MonsterDef
