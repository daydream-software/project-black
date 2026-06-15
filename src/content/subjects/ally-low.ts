import type { Option } from '../registry'
import type { State } from '../../sim'

export default {
  id: 'ally_low',
  label: 'Ally · low HP',
  order: 30,
  make: () => ({ who: 'ally', pick: 'lowestHp' }),
} satisfies Option<State['subject']>
