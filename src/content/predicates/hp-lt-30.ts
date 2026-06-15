import type { Option } from '../registry'
import type { State } from '../../sim'

export default {
  id: 'hp_lt_30',
  label: 'HP < 30%',
  order: 20,
  make: () => ({ p: 'hpPctBelow', value: 30 }),
} satisfies Option<State['predicate']>
