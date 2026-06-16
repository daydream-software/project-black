import type { MonsterDef } from '../../sim'
import { attackNearest } from '../combat/procedures'

// The FIRST level's boss — a plain bruiser with NO counter mechanic (unlike the Hex
// Warden). It exists so a fresh player, with only the minimal language
// (`Engram.combat_turn:\n    return attack(...)`) and a single golem, can clear lvl-1
// attack-only and earn their first Insight. The teaching boss; the Warden moves to lvl-2.
// Compact 24-budget scale: a modest pool a focused single-golem build out-damages.
export default {
  id: 'ruin-keeper',
  name: 'Ruin Keeper',
  might: 3,
  ward: 0,
  fortitude: 7,
  attunement: 0,
  poise: 0,
  celerity: 5,
  procedure: [attackNearest()],
  isBoss: true,
} satisfies MonsterDef
