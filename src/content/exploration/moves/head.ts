import type { Option } from '../../registry'
import type { ExMove } from '../../../delve'

export default {
  id: 'head',
  label: 'head toward',
  order: 10,
  make: () => 'headToward',
} satisfies Option<ExMove>
