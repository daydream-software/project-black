import type { Option } from '../../registry'
import type { ExPredicate } from '../../../delve'

export default {
  id: 'php_lt_30',
  label: 'party HP < 30%',
  order: 40,
  make: () => ({ p: 'partyHpPctBelow', value: 30 }),
} satisfies Option<ExPredicate>
