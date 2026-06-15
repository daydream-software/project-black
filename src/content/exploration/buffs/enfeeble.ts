import type { BuffDef } from '../../../delve'
import { poolFor } from '../../../combat-core'

// Enfeeble — HALVE the Fortitude of every enemy the party meets for the rest of the
// delve (the "remaining monsters on the map" boon). Unlike the party buffs, the foes
// don't exist yet when it's collected, so it carries no `apply`: it persists as a
// collected-buff id and its `onSpawn` hook rewrites each enemy as it's built (boss
// included). Fortitude stays an integer (≥1) and maxHp is recomputed so hp/maxHp can't
// desync; a freshly-built enemy starts full, so hp follows maxHp down.
export default {
  id: 'enfeeble',
  label: 'Enfeeble',
  order: 60,
  onSpawn: (enemy) => {
    const fortitude = Math.max(1, Math.floor(enemy.fortitude / 2))
    const maxHp = poolFor(fortitude)
    return { ...enemy, fortitude, maxHp, hp: Math.min(enemy.hp, maxHp) }
  },
} satisfies BuffDef
