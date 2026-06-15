import { describe, it, expect } from 'vitest'
import { LEVELS, levelById, hasCleared, recordClear, applyClear } from './levels'
import { generateGraph } from './mapgraph'
import { BUFFS_BY_ID } from './content/exploration/buffs'

describe('levels — well-formed skeletons', () => {
  it('every level has a unique id and exactly one entrance + boss slot', () => {
    const ids = LEVELS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const l of LEVELS) {
      const types = l.topology.slots.map((s) => s.type)
      expect(types.filter((t) => t === 'entrance')).toHaveLength(1)
      expect(types.filter((t) => t === 'boss')).toHaveLength(1)
      expect(l.boss.length).toBeGreaterThan(0)
      expect(l.monsterPool.length).toBeGreaterThan(0)
    }
  })

  it('every authored buffPool id resolves in the buff registry (no typos)', () => {
    for (const l of LEVELS) {
      for (const id of l.buffPool ?? []) expect(BUFFS_BY_ID.has(id)).toBe(true)
    }
  })

  it("every level's skeleton generates a connected graph across seeds (no throw)", () => {
    for (const l of LEVELS) {
      for (let seed = 0; seed < 100; seed += 1) {
        const g = generateGraph(l, seed)
        // entrance + boss always present; generateGraph guarantees connectivity/asserts.
        expect(g.rooms.some((r) => r.id === g.entranceId)).toBe(true)
        expect(g.rooms.some((r) => r.id === g.bossId)).toBe(true)
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
