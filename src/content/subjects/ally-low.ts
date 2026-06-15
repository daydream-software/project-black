import type { SubjectDef } from '../../sim'
import { livingAllies, pickLowestHp } from '../combat/targeting'

export default {
  id: 'ally_low',
  label: 'Ally · low HP',
  order: 30,
  candidates: livingAllies,
  pick: pickLowestHp,
} satisfies SubjectDef
