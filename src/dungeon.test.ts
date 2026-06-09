import { describe, it, expect } from 'vitest'
import { generateDungeon, bfsDistances, cellIndex, roomCenter, type Dungeon } from './dungeon'

const centerCell = (d: Dungeon, roomId: number): number => {
  const c = roomCenter(d.rooms[roomId])
  return cellIndex(d, c.x, c.y)
}

const floorCount = (d: Dungeon): number => d.cells.filter(Boolean).length

describe('dungeon generation — seeded & connected', () => {
  it('is deterministic: same seed → identical dungeon (and advanced rng state)', () => {
    expect(generateDungeon(42)).toEqual(generateDungeon(42))
  })

  it('different seeds give different dungeons', () => {
    const a = JSON.stringify(generateDungeon(1).dungeon)
    const b = JSON.stringify(generateDungeon(2).dungeon)
    const c = JSON.stringify(generateDungeon(3).dungeon)
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('generation advances the rng stream (so the delve can keep rolling)', () => {
    expect(generateDungeon(7).rngState).not.toBe(7)
  })

  // The load-bearing invariant: across many seeds the dungeon is fully connected,
  // the objective is reachable from the entrance, and they are distinct rooms.
  it('every floor cell — and the objective — is reachable from the entrance', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { dungeon } = generateDungeon(seed)
      expect(dungeon.rooms.length).toBeGreaterThanOrEqual(2)
      expect(dungeon.entranceRoomId).not.toBe(dungeon.objectiveRoomId)

      const dist = bfsDistances(dungeon, centerCell(dungeon, dungeon.entranceRoomId))
      // objective reachable
      expect(dist[centerCell(dungeon, dungeon.objectiveRoomId)]).not.toBe(Infinity)
      // NO isolated floor: reachable floor cells == all floor cells
      const reachable = dist.filter((d) => d !== Infinity).length
      expect(reachable).toBe(floorCount(dungeon))
    }
  })

  it('exactly one entrance and one target; rooms in bounds and non-overlapping', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { dungeon: d } = generateDungeon(seed)
      expect(d.rooms.filter((r) => r.type === 'entrance')).toHaveLength(1)
      expect(d.rooms.filter((r) => r.type === 'target')).toHaveLength(1)
      for (const r of d.rooms) {
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(d.width)
        expect(r.y + r.h).toBeLessThanOrEqual(d.height)
      }
      for (let i = 0; i < d.rooms.length; i++) {
        for (let j = i + 1; j < d.rooms.length; j++) {
          const a = d.rooms[i]
          const b = d.rooms[j]
          const disjoint = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
          expect(disjoint).toBe(true)
        }
      }
    }
  })
})
