import type { PredicateDef } from '../../sim'

export default {
  id: 'always',
  label: 'Always',
  order: 10,
  holds: () => true,
} satisfies PredicateDef
