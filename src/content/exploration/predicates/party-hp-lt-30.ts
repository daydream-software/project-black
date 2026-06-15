import type { ExPredicateDef } from '../../../delve'
import { partyHpPct } from '../navigation'

export default {
  id: 'php_lt_30',
  label: 'party HP < 30%',
  order: 40,
  holds: (s) => partyHpPct(s.party) < 30,
} satisfies ExPredicateDef
