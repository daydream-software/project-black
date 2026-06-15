import type { ExPredicateDef } from '../../../delve'

export default {
  id: 'always',
  label: 'Always',
  order: 10,
  holds: () => true,
} satisfies ExPredicateDef
