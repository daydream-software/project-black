import { describe, it, expect } from 'vitest'
import { UNLOCKABLES, buy, canAfford, isOwned, unlockableById } from './shop'

const ITEM = UNLOCKABLES[0].id // the placeholder unlockable
const COST = UNLOCKABLES[0].cost

describe('shop — the Trainer catalogue + buy', () => {
  it('every unlockable has a unique id and a positive cost', () => {
    const ids = UNLOCKABLES.map((u) => u.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const u of UNLOCKABLES) expect(u.cost).toBeGreaterThan(0)
  })

  it('buy spends Insight and adds the id when affordable and unowned', () => {
    const r = buy(ITEM, COST + 2, [])
    expect(r.bought).toBe(true)
    expect(r.insight).toBe(2)
    expect(r.unlocked).toEqual([ITEM])
  })

  it('buy is a no-op when unaffordable', () => {
    const r = buy(ITEM, COST - 1, [])
    expect(r).toEqual({ insight: COST - 1, unlocked: [], bought: false })
  })

  it('buy is a no-op when already owned (no double-spend)', () => {
    const r = buy(ITEM, 99, [ITEM])
    expect(r).toEqual({ insight: 99, unlocked: [ITEM], bought: false })
  })

  it('buy is a no-op for an unknown id', () => {
    const r = buy('nope', 99, [])
    expect(r.bought).toBe(false)
    expect(r.insight).toBe(99)
  })

  it('canAfford / isOwned reflect state', () => {
    expect(canAfford(COST, ITEM)).toBe(true)
    expect(canAfford(COST - 1, ITEM)).toBe(false)
    expect(isOwned([ITEM], ITEM)).toBe(true)
    expect(isOwned([], ITEM)).toBe(false)
    expect(unlockableById(ITEM)?.id).toBe(ITEM)
  })
})
