import type { Option } from '../../registry'
import type { ExPredicate } from '../../../delve'

export default {
  id: 'php_lt_50',
  label: 'party HP < 50%',
  order: 30,
  make: () => ({ p: 'partyHpPctBelow', value: 50 }),
} satisfies Option<ExPredicate>
