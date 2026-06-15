import type { Option } from '../../registry'
import type { ExSubject } from '../../../delve'

export default {
  id: 'unexplored',
  label: 'Unexplored',
  order: 20,
  make: () => ({ what: 'unexplored' }),
} satisfies Option<ExSubject>
