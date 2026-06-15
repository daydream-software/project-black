import type { Option } from '../../registry'
import type { ExPredicate } from '../../../delve'

export default {
  id: 'known',
  label: 'known',
  order: 20,
  make: () => ({ p: 'known' }),
} satisfies Option<ExPredicate>
