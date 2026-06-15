import type { ExSubjectDef } from '../../../delve'
import { knownRoomOfType, stepTowardRoom } from '../navigation'

// Route to a peeked-but-unentered BUFF room: "WHEN a buff room is in sight (and I'm
// healthy enough to detour) → head toward it". Same shape as the loot subject.
export default {
  id: 'room_buff',
  label: 'Buff room',
  order: 50,
  reachable: (s) => knownRoomOfType(s, 'buff') !== '',
  stepToward: (s) => {
    const goal = knownRoomOfType(s, 'buff')
    return goal === '' ? '' : stepTowardRoom(s, goal)
  },
} satisfies ExSubjectDef
