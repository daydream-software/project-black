import type { SkillDef } from '../../sim'
import { healAmount, overdraw, MEND_STRAIN } from '../../combat-core'

// Restore Attunement HP to a living ally; the cast adds Strain, and any overflow past
// the caster's Poise bites its own Fortitude (overdraw). A dead rule (no valid ally)
// consumes the turn with no effect. Types come from sim (erased); the numeric
// primitives from combat-core, so this file never imports sim at runtime.
export default {
  id: 'mend',
  label: 'Mend',
  order: 10,
  kind: 'heal',
  effect: (actor, target) => {
    if (target !== null && target.side === actor.side && target.hp > 0) {
      const before = target.hp
      target.hp = Math.min(target.maxHp, target.hp + healAmount(actor))
      const restored = target.hp - before
      const healedTo = target.hp // capture before any self-overdraw rewrites it
      const sBefore = actor.strain ?? 0
      const bite = overdraw(sBefore, actor.poise, MEND_STRAIN)
      actor.strain = sBefore + MEND_STRAIN
      if (bite > 0) actor.hp = Math.max(0, actor.hp - bite)
      let detail = `MEND +${restored} → ${target.name} (HP ${before} → ${healedTo})`
      if (bite > 0) detail += ` • OVERDRAW −${bite} → ${actor.name} (Strain ${actor.strain} > Poise ${actor.poise})`
      return detail
    }
    return `MEND has no valid target — no effect` // dead rule: State held, turn consumed
  },
} satisfies SkillDef
