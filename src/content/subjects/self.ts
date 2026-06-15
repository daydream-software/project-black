import type { Option } from '../registry'
import type { State } from '../../sim'

export default {
  id: 'self',
  label: 'Self',
  order: 10,
  make: () => ({ who: 'self' }),
} satisfies Option<State['subject']>
