import type { ExSubjectDef } from '../../../delve'
import { stepTowardFrontier } from '../navigation'

// The exploration frontier — the nearest edge of the known. Its "goal" is the moving
// frontier, not a fixed cell, so reachable and stepToward both resolve it on demand.
export default {
  id: 'unexplored',
  label: 'Unexplored',
  order: 20,
  reachable: (s) => stepTowardFrontier(s.dungeon, s.pos, s.explored) !== -1,
  stepToward: (s) => stepTowardFrontier(s.dungeon, s.pos, s.explored),
} satisfies ExSubjectDef
