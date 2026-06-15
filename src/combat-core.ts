// The pure combat PRIMITIVES — the small, self-contained stat→number functions and
// their tuning constants, factored out of sim.ts so that *content* (skill effect
// files under content/skills/) can import them WITHOUT importing sim.ts at runtime.
//
// Why this file exists: a skill's effect (Mend) needs `healAmount`/`overdraw`, but if
// it imported them from sim.ts we'd get a runtime cycle sim → skills → sim. These
// primitives depend only on the Combatant/Stats *types* (erased at runtime), so this
// module is a leaf: sim.ts and the skill files both import it, nothing imports them
// back at runtime. sim.ts re-exports everything here, so existing `from './sim'`
// imports keep working — this is an internal split, not a public-API change.

import type { Combatant } from './sim'

/** HP a single Fortitude point grants. The fortitude→pool factor (a free tuning
 *  knob, kept small so each point is a visible ~1–2 hits on the compact scale). */
export const HP_PER_FORTITUDE = 4

/** maxHp for a given Fortitude on the compact scale. */
export function poolFor(fortitude: number): number {
  return fortitude * HP_PER_FORTITUDE
}

/** Minimum damage of any landed hit — the Ward floor, so high Ward shaves chip
 *  damage to a trickle but can never make a unit literally unkillable. */
export const MIN_DAMAGE = 1

/**
 * Physical damage `attacker` deals to `target` with an Attack: Might minus the
 * target's flat Ward, floored at MIN_DAMAGE, then halved (round up) if the target
 * is Defending. Flat Ward is what makes it anti-swarm — it eats a 3-Might slime's
 * chip but barely dents a 6-Might boss.
 */
export function attackDamage(attacker: Combatant, target: Combatant): number {
  const base = Math.max(MIN_DAMAGE, attacker.might - target.ward)
  return target.defending ? Math.ceil(base / 2) : base
}

/** How much a unit's Mend restores — its Attunement (skill potency). */
export function healAmount(healer: Combatant): number {
  return healer.attunement
}

/** Strain a single Mend cast adds to its caster. Strawman — the whole
 *  Strain economy is tuned in play; this is the one knob to turn first. */
export const MEND_STRAIN = 2

/**
 * The overdraw a cast inflicts: adding `cost` Strain to a caster currently at
 * `strain` (cap `poise`), how much of THIS cast lands above Poise — that overflow
 * is paid in Fortitude (HP). Under Poise the cast is free (0). Pure + exported so
 * the Strain economy is unit-testable without driving a whole battle.
 */
export function overdraw(strain: number, poise: number, cost: number): number {
  return Math.max(0, strain + cost - Math.max(poise, strain))
}

/** CTB scheduler base — the "time" a Celerity-1 golem waits between turns. The
 *  whole turn order is FFX-style CTB (not round-robin, not a filling ATB bar):
 *  each unit's next turn comes back after `recovery(celerity)`, integer-quantised
 *  so the schedule never drifts and the journal stays trustworthy. */
export const SCHED_BASE = 120

/**
 * Time until a unit of this Celerity gets its next turn (smaller = sooner, so
 * higher Celerity acts more often). Floored at Celerity 1 — a Celerity-0 golem is
 * merely the slowest, never frozen. `recovery(12):recovery(10):recovery(8)` =
 * `10:12:15`, i.e. a `6:5:4` share of turns over time.
 */
export function recovery(celerity: number): number {
  return Math.round(SCHED_BASE / Math.max(1, celerity))
}
