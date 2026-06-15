import type { ExSubjectDef } from '../../../delve'
import { stepTowardFrontier } from '../navigation'

// The exploration frontier — the nearest unexplored room reachable through explored
// ones. Its "goal" is the moving frontier, resolved on demand.
export default {
  id: 'unexplored',
  label: 'Unexplored',
  order: 20,
  reachable: (s) => stepTowardFrontier(s) !== '',
  stepToward: (s) => stepTowardFrontier(s),
} satisfies ExSubjectDef
