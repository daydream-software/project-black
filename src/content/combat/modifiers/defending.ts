import type { DamageModifier } from '../../../sim'

// The MEANING of the `defending` status: halve (round up) incoming damage. The flag
// itself is set by the Defend skill; this file owns what it does to damage, so the
// engine's attack resolution never branches on "defending" — it just folds whatever
// damage modifiers are registered.
export default {
  id: 'defending',
  order: 10,
  apply: (damage, _attacker, target) => (target.defending ? Math.ceil(damage / 2) : damage),
} satisfies DamageModifier
