import type { ExSubjectDef } from '../../../delve'
import { entranceCell, stepTowardKnown, knownIn } from '../navigation'

// The entrance — where a retreat heads. Always reachable (the entrance is known from
// the start); steps toward it through explored space.
export default {
  id: 'exit',
  label: 'Exit',
  order: 30,
  reachable: () => true,
  stepToward: (s) => stepTowardKnown(s.dungeon, s.pos, entranceCell(s.dungeon), knownIn(s)),
} satisfies ExSubjectDef
