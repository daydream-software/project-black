import type { PredicateDef } from '../../sim'

export default {
  id: 'hp_lt_50',
  label: 'HP < 50%',
  order: 30,
  holds: (u) => (u.hp / u.maxHp) * 100 < 50,
} satisfies PredicateDef
