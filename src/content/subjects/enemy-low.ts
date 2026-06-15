import type { Option } from '../registry'
import type { State } from '../../sim'

export default {
  id: 'enemy_low',
  label: 'Enemy · low HP',
  order: 50,
  make: () => ({ who: 'enemy', pick: 'lowestHp' }),
} satisfies Option<State['subject']>
