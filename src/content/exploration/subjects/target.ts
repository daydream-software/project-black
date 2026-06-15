import type { ExSubjectDef } from '../../../delve'
import { knownObjectiveCell, stepTowardKnown, knownIn } from '../navigation'

// The objective room. Reachable once any of its cells is discovered; steps toward the
// nearest known objective cell through explored space.
export default {
  id: 'target',
  label: 'Target',
  order: 10,
  reachable: (s) => knownObjectiveCell(s) !== -1,
  stepToward: (s) => {
    const goal = knownObjectiveCell(s)
    return goal === -1 ? -1 : stepTowardKnown(s.dungeon, s.pos, goal, knownIn(s))
  },
} satisfies ExSubjectDef
