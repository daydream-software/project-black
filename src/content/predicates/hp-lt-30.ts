import type { PredicateDef } from '../../sim'

export default {
  id: 'hp_lt_30',
  label: 'HP < 30%',
  order: 20,
  holds: (u) => (u.hp / u.maxHp) * 100 < 30,
} satisfies PredicateDef
