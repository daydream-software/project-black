import type { Option } from '../registry'
import type { State } from '../../sim'

export default {
  id: 'hp_full',
  label: 'HP = 100%',
  order: 40,
  make: () => ({ p: 'hpFull' }),
} satisfies Option<State['predicate']>
