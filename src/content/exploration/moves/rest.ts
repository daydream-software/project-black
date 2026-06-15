import type { ExMoveDef } from '../../../delve'

// Stay put — resolving to the party's own cell signals a rest (off-combat Mend),
// not a movement step ("si c'est un repos, ce n'est pas un pas").
export default {
  id: 'rest',
  label: 'rest',
  order: 30,
  resolve: (s) => s.pos,
} satisfies ExMoveDef
