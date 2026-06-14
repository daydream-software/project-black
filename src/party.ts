// The point-buy party model (the build space). There are no predefined golems:
// the player authors the whole team by spending a BUILD_BUDGET, which includes
// committing to how many golems to field — each golem costs a flat CHASSIS_COST
// that grants nothing, and the remainder is spent freely on stats (0..STAT_CAP,
// flat cost). See docs/COMBAT-SYSTEM.md "Authoring a party". Pure + headless:
// the editor (UI) and the sim both read these; tests pin the math.
//
// The numbers are a strawman tuned in-app (budget 24 fits 1–4 golems cleanly:
// 21/18/15/12 stat points left after chassis). Budget, caps and the golem-count
// range all grow via meta-progression (raid cycles) — not modelled here yet.

import type { Stats } from './sim'

export const BUILD_BUDGET = 24
export const CHASSIS_COST = 3
export const STAT_CAP = 12
export const GOLEM_MIN = 1
export const GOLEM_MAX = 4

/** The six stat fields, in canonical order (M·W·F·A·P·C). */
export const STAT_KEYS = ['might', 'ward', 'fortitude', 'attunement', 'poise', 'celerity'] as const

/** Total stat points a golem spends (every point is flat cost on the 0–12 scale). */
export function statSum(s: Stats): number {
  return STAT_KEYS.reduce((n, k) => n + s[k], 0)
}

/** The flat chassis cost of fielding `count` golems (pure cost, grants nothing). */
export function chassisCost(count: number): number {
  return count * CHASSIS_COST
}

/** Total budget a build consumes: chassis for every golem + all stat points. */
export function buildCost(golems: Stats[]): number {
  return chassisCost(golems.length) + golems.reduce((n, g) => n + statSum(g), 0)
}

/** Budget left to spend (negative = over budget). */
export function remaining(golems: Stats[], budget: number = BUILD_BUDGET): number {
  return budget - buildCost(golems)
}

/** Every stat is within [0, STAT_CAP]. */
export function withinCaps(s: Stats): boolean {
  return STAT_KEYS.every((k) => s[k] >= 0 && s[k] <= STAT_CAP)
}

/** A build is legal when the golem count is in range, every stat is within caps,
 *  and it does not overspend the budget. */
export function isLegalBuild(golems: Stats[], budget: number = BUILD_BUDGET): boolean {
  return (
    golems.length >= GOLEM_MIN &&
    golems.length <= GOLEM_MAX &&
    golems.every(withinCaps) &&
    remaining(golems, budget) >= 0
  )
}
