import type { ExPredicateDef } from '../../../delve'
import { partyHpPct } from '../navigation'

export default {
  id: 'php_lt_50',
  label: 'party HP < 50%',
  order: 30,
  holds: (s) => partyHpPct(s.party) < 50,
} satisfies ExPredicateDef
