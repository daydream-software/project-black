import type { SubjectDef } from '../../sim'
import { livingEnemies, pickHighestHp } from '../combat/targeting'

// Locked until learned at the Trainer (slice 10b): focus-fire the biggest threat.
export default {
  id: 'enemy_high',
  label: 'Enemy · most HP',
  order: 60,
  candidates: livingEnemies,
  pick: pickHighestHp,
  unlock: 'enemy-most-hp',
} satisfies SubjectDef
