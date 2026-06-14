import { describe, it, expect } from 'vitest'
import { generateDungeon, bfsDistances, cellIndex, roomCenter, type Dungeon, type GenConfig } from './dungeon'

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
    for (let seed = 0; seed < 200; seed += 1) {
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

  // --- slice 10a: a level config drives the size, room count and pack count ---

  const LVL: GenConfig = { width: 21, height: 15, rooms: [3, 7], packs: [1, 2] }

  it('the grid comes from the config (bigger config → bigger grid)', () => {
    const big: GenConfig = { width: 33, height: 25, rooms: [3, 7], packs: [1, 2] }
    const a = generateDungeon(1, LVL).dungeon
    const b = generateDungeon(1, big).dungeon
    expect([a.width, a.height]).toEqual([21, 15])
    expect([b.width, b.height]).toEqual([33, 25])
    expect(b.cells.length).toBe(33 * 25)
  })

  it('same seed + same config is deterministic; the config changes the layout', () => {
    expect(generateDungeon(42, LVL)).toEqual(generateDungeon(42, LVL))
    const other: GenConfig = { ...LVL, rooms: [6, 9], width: 31, height: 23 }
    expect(JSON.stringify(generateDungeon(42, LVL))).not.toBe(JSON.stringify(generateDungeon(42, other)))
  })

  it('room count stays within the config range (across seeds)', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const n = generateDungeon(seed, LVL).dungeon.rooms.length
      expect(n).toBeGreaterThanOrEqual(LVL.rooms[0])
      expect(n).toBeLessThanOrEqual(LVL.rooms[1])
    }
  })

  it('pack count = a chosen number, clamped to the interior rooms (not a coin flip)', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const d = generateDungeon(seed, LVL).dungeon
      const interior = d.rooms.length - 2 // minus entrance + target
      const packs = d.rooms.filter((r) => r.type === 'monster').length
      expect(packs).toBeGreaterThanOrEqual(Math.min(LVL.packs[0], interior))
      expect(packs).toBeLessThanOrEqual(Math.min(LVL.packs[1], interior))
    }
  })

  it('exactly one entrance and one target; rooms in bounds and non-overlapping', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const { dungeon: d } = generateDungeon(seed)
      expect(d.rooms.filter((r) => r.type === 'entrance')).toHaveLength(1)
      expect(d.rooms.filter((r) => r.type === 'target')).toHaveLength(1)
      for (const r of d.rooms) {
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(d.width)
        expect(r.y + r.h).toBeLessThanOrEqual(d.height)
      }
      for (let i = 0; i < d.rooms.length; i += 1) {
        for (let j = i + 1; j < d.rooms.length; j += 1) {
          const a = d.rooms[i]
          const b = d.rooms[j]
          const disjoint = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
          expect(disjoint).toBe(true)
        }
      }
    }
  })
})
