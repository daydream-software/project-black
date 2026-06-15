import type { ExSubjectDef } from '../../../delve'
import { isKnown, stepTowardKnown } from '../navigation'

// The boss room. Reachable once it's known (entered, peeked from a connected room, or
// revealed). The party feed-routes toward it — exploring the path, never teleporting —
// so a revealed-but-distant boss (a future hidden boss room) is a valid objective, while
// a boss only ever known by an adjacent peek behaves exactly as before (a single step in).
export default {
  id: 'target',
  label: 'Target',
  order: 10,
  reachable: (s) => isKnown(s, s.graph.bossId),
  stepToward: (s) => stepTowardKnown(s, s.graph.bossId),
} satisfies ExSubjectDef
