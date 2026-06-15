import type { SubjectDef } from '../../sim'
import { livingEnemies, pickFirst } from '../combat/targeting'

export default {
  id: 'enemy_near',
  label: 'Enemy · near',
  order: 40,
  candidates: livingEnemies,
  pick: pickFirst,
} satisfies SubjectDef
