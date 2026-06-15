import type { Option } from '../../registry'
import type { ExMove } from '../../../delve'

export default {
  id: 'rest',
  label: 'rest',
  order: 30,
  make: () => 'rest',
} satisfies Option<ExMove>
