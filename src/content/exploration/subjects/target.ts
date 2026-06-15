import type { Option } from '../../registry'
import type { ExSubject } from '../../../delve'

export default {
  id: 'target',
  label: 'Target',
  order: 10,
  make: () => ({ what: 'target' }),
} satisfies Option<ExSubject>
