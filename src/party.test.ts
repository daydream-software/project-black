import { describe, it, expect } from 'vitest'
import type { Stats } from './sim'
import {
  BUILD_BUDGET,
  CHASSIS_COST,
  STAT_CAP,
  statSum,
  buildCost,
  remaining,
  withinCaps,
  isLegalBuild,
} from './party'

const zero: Stats = { might: 0, ward: 0, fortitude: 0, attunement: 0, poise: 0, celerity: 0 }
const s = (over: Partial<Stats>): Stats => ({ ...zero, ...over })

describe('point-buy math', () => {
  it('statSum adds all six stats', () => {
    expect(statSum(s({ might: 5, fortitude: 10, celerity: 5 }))).toBe(20)
    // mutation check: dropping any field would change the sum
    expect(statSum(s({ might: 1, ward: 2, fortitude: 3, attunement: 4, poise: 5, celerity: 6 }))).toBe(21)
  })

  it('buildCost = chassis per golem + every stat point', () => {
    const golems = [s({ might: 4 }), s({ fortitude: 6 })]
    expect(buildCost(golems)).toBe(2 * CHASSIS_COST + 4 + 6) // 6 + 10 = 16
  })

  it('remaining is budget minus build cost (negative when overspent)', () => {
    // 4 swarm golems: 12 chassis, exactly 12 stat points left of the 24 budget.
    const four = [s({ might: 3 }), s({ might: 3 }), s({ might: 3 }), s({ might: 3 })]
    expect(remaining(four)).toBe(BUILD_BUDGET - (12 + 12)) // 0
    const over = [s({ might: STAT_CAP }), s({ might: STAT_CAP })]
    expect(remaining(over)).toBeLessThan(0)
  })

  it('withinCaps rejects out-of-range stats', () => {
    expect(withinCaps(s({ might: STAT_CAP }))).toBe(true)
    expect(withinCaps(s({ might: STAT_CAP + 1 }))).toBe(false)
    expect(withinCaps(s({ might: -1 }))).toBe(false)
  })

  it('isLegalBuild gates on count, caps and budget', () => {
    // A clean 2-golem build inside budget (chassis 6 + 18 stat points = 24).
    const duo = [s({ might: 5, ward: 2, fortitude: 10, celerity: 0 }), s({ might: 1 })] // 17 + 1 = 18
    expect(isLegalBuild(duo)).toBe(true)

    // Overspent: same duo + one more stat point over budget.
    const overspent = [s({ might: 6, ward: 2, fortitude: 10, celerity: 0 }), s({ might: 1 })] // 19 + 1 = 20, +6 chassis = 26
    expect(isLegalBuild(overspent)).toBe(false)

    // Empty team (0 golems) is illegal — must field at least one.
    expect(isLegalBuild([])).toBe(false)

    // Five golems exceeds the count cap even if cheap.
    expect(isLegalBuild([zero, zero, zero, zero, zero])).toBe(false)

    // A single stat over the cap is illegal even within budget.
    expect(isLegalBuild([s({ might: STAT_CAP + 1 })])).toBe(false)
  })
})
