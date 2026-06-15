import type { SkillDef } from '../../sim'

// Brace: halve incoming damage until this unit's next turn (the `defending` flag is
// cleared by the scheduler when it acts again). No target, no Strain cost.
export default {
  id: 'defend',
  label: 'Defend',
  order: 20,
  kind: 'defend',
  effect: (actor) => {
    actor.defending = true
    return `DEFEND — incoming damage halved until next turn`
  },
} satisfies SkillDef
