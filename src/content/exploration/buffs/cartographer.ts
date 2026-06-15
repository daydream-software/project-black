import type { BuffDef } from '../../../delve'

// Cartographer's Eye — reveal the WHOLE map: every room's type becomes known (without
// entering it), so the exploration Procedure can route by type across the entire level,
// not just the 1-hop peek. A vision buff: it fills `revealed`, which isKnown + the
// minimap both consult. Does NOT mark rooms explored (no free clears).
export default {
  id: 'cartographer',
  label: "Cartographer's Eye",
  order: 40,
  apply: (s) => ({ ...s, revealed: s.graph.rooms.map((r) => r.id) }),
} satisfies BuffDef
