import type { Option } from '../registry'
import type { State } from '../../sim'

export default {
  id: 'ally_any',
  label: 'Ally · any',
  order: 20,
  make: () => ({ who: 'ally', pick: 'first' }),
} satisfies Option<State['subject']>
