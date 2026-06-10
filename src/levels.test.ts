import { describe, it, expect } from 'vitest'
import { LEVELS, levelById, hasCleared, recordClear, applyClear } from './levels'
import { generateDungeon } from './dungeon'

describe('levels — config-driven, well-formed', () => {
  it('every level has a unique id and sane ranges', () => {
    const ids = LEVELS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const l of LEVELS) {
      expect(l.width).toBeGreaterThan(0)
      expect(l.height).toBeGreaterThan(0)
      expect(l.rooms[0]).toBeLessThanOrEqual(l.rooms[1])
      expect(l.rooms[0]).toBeGreaterThanOrEqual(2) // need at least entrance + target
      expect(l.packs[0]).toBeLessThanOrEqual(l.packs[1])
      expect(l.packs[0]).toBeGreaterThanOrEqual(0)
    }
  })

  it("every level's grid actually fits its room range (generation stays in range)", () => {
    for (const l of LEVELS) {
      for (let seed = 0; seed < 150; seed++) {
        const n = generateDungeon(seed, l).dungeon.rooms.length
        expect(n).toBeGreaterThanOrEqual(l.rooms[0])
        expect(n).toBeLessThanOrEqual(l.rooms[1])
      }
    }
  })

  it('levelById finds a level, and falls back to the first for an unknown id', () => {
    expect(levelById(LEVELS[1].id)).toBe(LEVELS[1])
    expect(levelById('nope')).toBe(LEVELS[0])
  })
})

describe('levels — first-clear tracking', () => {
  it('recordClear adds a level on the first clear and is idempotent on a re-clear', () => {
    const once = recordClear([], 'lvl-1')
    expect(once).toEqual(['lvl-1'])
    expect(recordClear(once, 'lvl-1')).toEqual(['lvl-1']) // re-run never double-adds
    expect(recordClear(once, 'lvl-2')).toEqual(['lvl-1', 'lvl-2'])
  })

  it('recordClear does not mutate its input', () => {
    const before = ['lvl-1']
    recordClear(before, 'lvl-2')
    expect(before).toEqual(['lvl-1'])
  })

  it('hasCleared reflects the set', () => {
    expect(hasCleared(['lvl-1'], 'lvl-1')).toBe(true)
    expect(hasCleared(['lvl-1'], 'lvl-2')).toBe(false)
  })

  it('applyClear pays +1 Insight on a first clear, nothing on a re-clear', () => {
    const first = applyClear([], 3, 'lvl-1')
    expect(first).toEqual({ clearedLevels: ['lvl-1'], insight: 4, firstClear: true })

    const again = applyClear(first.clearedLevels, first.insight, 'lvl-1')
    expect(again).toEqual({ clearedLevels: ['lvl-1'], insight: 4, firstClear: false }) // re-run pays nothing

    const second = applyClear(first.clearedLevels, first.insight, 'lvl-2')
    expect(second).toEqual({ clearedLevels: ['lvl-1', 'lvl-2'], insight: 5, firstClear: true })
  })
})
