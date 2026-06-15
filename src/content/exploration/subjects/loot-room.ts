import type { ExSubjectDef } from '../../../delve'
import { knownRoomOfType, stepTowardRoom } from '../navigation'

// Route to a peeked-but-unentered LOOT room (the 1-hop type peek made actionable):
// "WHEN a loot room is in sight → head toward it". Reachable only while such a room is
// known and pathable; once entered it's no longer a target.
export default {
  id: 'room_loot',
  label: 'Loot room',
  order: 40,
  reachable: (s) => knownRoomOfType(s, 'loot') !== '',
  stepToward: (s) => {
    const goal = knownRoomOfType(s, 'loot')
    return goal === '' ? '' : stepTowardRoom(s, goal)
  },
} satisfies ExSubjectDef
