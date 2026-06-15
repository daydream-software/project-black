import type { ExSubjectDef } from '../../../delve'
import { stepTowardRoom } from '../navigation'

// The entrance — where a retreat heads. Always known (explored from the start); steps
// toward it through explored rooms.
export default {
  id: 'exit',
  label: 'Exit',
  order: 30,
  reachable: () => true,
  stepToward: (s) => stepTowardRoom(s, s.graph.entranceId),
} satisfies ExSubjectDef
