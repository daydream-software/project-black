import type { TrapDef } from '../../../delve'

// A spike trap: each LIVING golem takes `ref.value` (default 3) damage as the party
// traverses the corridor. Owned by the corridor (placed by generation), resolved by id.
export default {
  id: 'spike-trap',
  trigger: (party, ref) => {
    const dmg = ref.value ?? 3
    const hurt = party.map((u) => (u.hp > 0 ? { ...u, hp: Math.max(0, u.hp - dmg) } : u))
    return { party: hurt, detail: `a spike trap springs — −${dmg} to each golem` }
  },
} satisfies TrapDef
