import type { SubjectDef } from '../../sim'
import { livingEnemies, pickLowestHp } from '../combat/targeting'

export default {
  id: 'enemy_low',
  label: 'Enemy · low HP',
  order: 50,
  candidates: livingEnemies,
  pick: pickLowestHp,
} satisfies SubjectDef
