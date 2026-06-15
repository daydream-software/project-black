import type { ExSubjectDef } from '../../../delve'
import { knownRoomOfType, stepTowardKnown } from '../navigation'

// Route to a known-but-unentered BUFF room: "WHEN a buff room is known → head toward it".
// Same shape as the loot subject: known = peeked OR revealed, and the party feed-routes
// toward it across unexplored ground.
export default {
  id: 'room_buff',
  label: 'Buff room',
  order: 50,
  reachable: (s) => knownRoomOfType(s, 'buff') !== '',
  stepToward: (s) => {
    const goal = knownRoomOfType(s, 'buff')
    return goal === '' ? '' : stepTowardKnown(s, goal)
  },
} satisfies ExSubjectDef
