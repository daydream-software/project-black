import type { Option } from '../../registry'
import type { ExMove } from '../../../delve'

export default {
  id: 'retreat',
  label: 'retreat',
  order: 20,
  make: () => 'retreat',
} satisfies Option<ExMove>
