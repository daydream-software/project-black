import type { ExSubjectDef } from '../../../delve'
import { knownRoomOfType, stepTowardKnown } from '../navigation'

// Route to a known-but-unentered LOOT room: "WHEN a loot room is known → head toward it".
// Known = peeked (1-hop) OR revealed by a vision buff; the party feed-routes toward it,
// exploring the path even across the map (never teleporting). Once entered it's no longer
// a target.
export default {
  id: 'room_loot',
  label: 'Loot room',
  order: 40,
  reachable: (s) => knownRoomOfType(s, 'loot') !== '',
  stepToward: (s) => {
    const goal = knownRoomOfType(s, 'loot')
    return goal === '' ? '' : stepTowardKnown(s, goal)
  },
} satisfies ExSubjectDef
