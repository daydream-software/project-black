import type { SubjectDef } from '../../sim'
import { selfIfAlive, pickFirst } from '../combat/targeting'

export default {
  id: 'self',
  label: 'Self',
  order: 10,
  candidates: (self) => selfIfAlive(self),
  pick: pickFirst,
} satisfies SubjectDef
