import type { Option } from '../registry'
import type { State } from '../../sim'

export default {
  id: 'enemy_near',
  label: 'Enemy · near',
  order: 40,
  make: () => ({ who: 'enemy', pick: 'first' }),
} satisfies Option<State['subject']>
