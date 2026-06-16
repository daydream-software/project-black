import type { MonsterDef } from '../../sim'
import { attackNearest } from '../combat/procedures'

// The FIRST level's boss — a plain bruiser with NO counter mechanic (unlike the Hex
// Warden). It exists so a fresh player, with only the minimal language
// (`Engram.combat_turn:\n    return attack(...)`) and a single golem, can clear lvl-1
// attack-only and earn their first Insight. The teaching boss; the Warden moves to lvl-2.
// DELIBERATELY SLOW (Celerity 2, like the lvl-1 slimes): so even a golem that dumped
// every point away from Celerity — eff cadence 1 (0 authored + 1 golem base) — isn't
// lapped to death and can clear the tutorial. Celerity stays a real investment for the
// harder, faster levels; lvl-1 just doesn't gate on it. See memory combat-celerity-cliff.
export default {
  id: 'ruin-keeper',
  name: 'Ruin Keeper',
  might: 3,
  ward: 0,
  fortitude: 7,
  attunement: 0,
  poise: 0,
  celerity: 2,
  procedure: [attackNearest()],
  isBoss: true,
} satisfies MonsterDef
