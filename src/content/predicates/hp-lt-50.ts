import type { Option } from '../registry'
import type { State } from '../../sim'

export default {
  id: 'hp_lt_50',
  label: 'HP < 50%',
  order: 30,
  make: () => ({ p: 'hpPctBelow', value: 50 }),
} satisfies Option<State['predicate']>
