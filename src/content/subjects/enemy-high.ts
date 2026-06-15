import type { Option } from '../registry'
import type { State } from '../../sim'

// Locked until learned at the Trainer (slice 10b): focus-fire the biggest threat.
export default {
  id: 'enemy_high',
  label: 'Enemy · most HP',
  order: 60,
  make: () => ({ who: 'enemy', pick: 'highestHp' }),
  unlock: 'enemy-most-hp',
} satisfies Option<State['subject']>
