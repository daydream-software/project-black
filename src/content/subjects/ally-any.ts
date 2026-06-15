import type { SubjectDef } from '../../sim'
import { livingAllies, pickFirst } from '../combat/targeting'

export default {
  id: 'ally_any',
  label: 'Ally · any',
  order: 20,
  candidates: livingAllies,
  pick: pickFirst,
} satisfies SubjectDef
