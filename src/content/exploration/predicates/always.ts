import type { Option } from '../../registry'
import type { ExPredicate } from '../../../delve'

export default {
  id: 'always',
  label: 'Always',
  order: 10,
  make: () => ({ p: 'always' }),
} satisfies Option<ExPredicate>
