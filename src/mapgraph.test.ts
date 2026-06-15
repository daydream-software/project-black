import { describe, it, expect } from 'vitest'
import { generateGraph, type LevelSkeleton, type DungeonGraph, type RoomType } from './mapgraph'

// A "cross": entrance hub with four arms. The optional `e` (loot) is a LEAF, so a
// descent that drops it stays connected; `w` is a ??? (mystery) room.
const cross: LevelSkeleton = {
  id: 'test',
  name: 'Test',
  monsterPool: ['slime'],
  boss: 'hex-warden',
  topology: {
    slots: [
      { id: 'in', type: 'entrance' },
      { id: 'n', type: 'fight' },
      { id: 'e', type: 'loot', optional: true },
      { id: 'w', type: 'mystery' },
      { id: 's', type: 'boss' },
    ],
    edges: [['in', 'n'], ['in', 'e'], ['in', 'w'], ['in', 's']],
  },
}

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 123, 256, 7777]

/** Does generating this skeleton at this seed throw? (kept top-level to avoid deep
 *  callback nesting inside the `it`). */
function throwsAt(level: LevelSkeleton, seed: number): boolean {
  try {
    generateGraph(level, seed)
    return false
  } catch {
    return true
  }
}

/** BFS the GENERATED graph's own corridors — proves the result is connected. */
function reaches(g: DungeonGraph): Set<string> {
  const adj = new Map<string, string[]>()
  for (const { a, b } of g.corridors) {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  const seen = new Set([g.entranceId])
  const q = [g.entranceId]
  for (const cur of q) for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); q.push(nb) }
  return seen
}

describe('mapgraph — seeded hybrid generation of a room graph', () => {
  it('is deterministic in the seed (same seed → identical graph)', () => {
    expect(generateGraph(cross, 42)).toEqual(generateGraph(cross, 42))
    // a mutation-check anchor: a different seed differs somewhere across the set
    const differs = SEEDS.some((s) => JSON.stringify(generateGraph(cross, s)) !== JSON.stringify(generateGraph(cross, 42)))
    expect(differs).toBe(true)
  })

  it('always includes every MANDATORY room; entrance/boss are the right slots', () => {
    for (const s of SEEDS) {
      const g = generateGraph(cross, s)
      const ids = new Set(g.rooms.map((r) => r.id))
      expect(ids.has('in')).toBe(true)
      expect(ids.has('n')).toBe(true)
      expect(ids.has('w')).toBe(true)
      expect(ids.has('s')).toBe(true)
      expect(g.entranceId).toBe('in')
      expect(g.bossId).toBe('s')
    }
  })

  it('is CONNECTED — the entrance reaches every room, every seed', () => {
    for (const s of SEEDS) {
      const g = generateGraph(cross, s)
      const reached = reaches(g)
      expect(reached.size).toBe(g.rooms.length)
      for (const r of g.rooms) expect(reached.has(r.id)).toBe(true)
    }
  })

  it('the OPTIONAL room varies — present some descents, absent others', () => {
    const hasRoom = (seed: number, id: string): boolean => generateGraph(cross, seed).rooms.some((r) => r.id === id)
    const hasE = SEEDS.map((s) => hasRoom(s, 'e'))
    expect(hasE.some((x) => x)).toBe(true) // appears sometimes
    expect(hasE.some((x) => !x)).toBe(true) // and is dropped sometimes
  })

  it('the ??? room resolves to one of fight / loot / buff', () => {
    const allowed: RoomType[] = ['fight', 'loot', 'buff']
    for (const s of SEEDS) {
      const w = generateGraph(cross, s).rooms.find((r) => r.id === 'w')
      expect(w).toBeDefined()
      expect(allowed).toContain(w!.type)
    }
  })

  it('throws on a topology that disconnects the boss (an optional sole-bridge)', () => {
    // line: in — f — (buff, optional) — boss. The optional buff is the ONLY link to
    // the boss, so a descent that drops it would orphan the boss — an authoring error.
    const badLine: LevelSkeleton = {
      id: 'bad', name: 'Bad', monsterPool: [], boss: 'hex-warden',
      topology: {
        slots: [
          { id: 'in', type: 'entrance' },
          { id: 'f', type: 'fight' },
          { id: 'b', type: 'buff', optional: true },
          { id: 'boss', type: 'boss' },
        ],
        edges: [['in', 'f'], ['f', 'b'], ['b', 'boss']],
      },
    }
    // Some seed drops the optional 'b' (orphaning the boss) → generation throws then.
    expect(SEEDS.some((s) => throwsAt(badLine, s))).toBe(true)
  })

  it('throws on bad authoring — not exactly one entrance', () => {
    const twoEntrances: LevelSkeleton = {
      id: 'x', name: 'X', monsterPool: [], boss: 'hex-warden',
      topology: { slots: [{ id: 'a', type: 'entrance' }, { id: 'b', type: 'entrance' }], edges: [['a', 'b']] },
    }
    expect(() => generateGraph(twoEntrances, 1)).toThrow(/exactly one entrance/u)
  })
})
