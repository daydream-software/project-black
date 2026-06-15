import type { MonsterDef } from '../../sim'

// The slice-4 "wall": a single boss that punishes restorative magic. Every time a
// hero is healed, the Warden strikes the healed unit for `counterHeal`, which more
// than undoes the Mend — so the naive "Mend when an ally is low" Procedure is a trap.
// Off-balance and unbounded (monsters ignore the player's caps): a big Fortitude pool
// so it survives the fast Mender's front-load, and a counter that exceeds the Mender's
// heal so mend-spam is a net loss. Tuned against the slice-4 discriminating tests
// under the CTB schedule. The reaction LOGIC lives in sim.ts (counterReactions);
// `counterHeal` is only the value that drives it.
export default {
  id: 'hex-warden',
  name: 'Hex Warden',
  might: 4,
  ward: 0,
  fortitude: 10,
  attunement: 0,
  poise: 0,
  celerity: 4,
  counterHeal: 4,
  isBoss: true,
} satisfies MonsterDef
