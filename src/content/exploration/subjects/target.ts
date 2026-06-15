import type { ExSubjectDef } from '../../../delve'
import { isKnown, stepTowardRoom } from '../navigation'

// The boss room. Reachable once it's known (entered, or peeked from a connected room);
// steps toward it through explored rooms.
export default {
  id: 'target',
  label: 'Target',
  order: 10,
  reachable: (s) => isKnown(s, s.graph.bossId),
  stepToward: (s) => stepTowardRoom(s, s.graph.bossId),
} satisfies ExSubjectDef
