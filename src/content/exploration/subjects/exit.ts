import type { Option } from '../../registry'
import type { ExSubject } from '../../../delve'

export default {
  id: 'exit',
  label: 'Exit',
  order: 30,
  make: () => ({ what: 'exit' }),
} satisfies Option<ExSubject>
