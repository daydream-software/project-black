import type { PredicateDef } from '../../sim'

export default {
  id: 'hp_full',
  label: 'HP = 100%',
  order: 40,
  holds: (u) => u.hp >= u.maxHp,
} satisfies PredicateDef
