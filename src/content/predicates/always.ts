import type { Option } from '../registry'
import type { State } from '../../sim'

export default {
  id: 'always',
  label: 'Always',
  order: 10,
  make: () => ({ p: 'always' }),
} satisfies Option<State['predicate']>
