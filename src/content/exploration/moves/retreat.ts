import type { ExMoveDef } from '../../../delve'
import exitSubject from '../subjects/exit'

// Fall back to the entrance, regardless of the rule's Subject — heads toward the exit.
export default {
  id: 'retreat',
  label: 'retreat',
  order: 20,
  resolve: (s) => exitSubject.stepToward(s),
} satisfies ExMoveDef
