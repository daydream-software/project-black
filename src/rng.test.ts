import { describe, it, expect } from 'vitest'
import { makeRng, random, int, range, pick, nextSeed } from './rng'

const seq = (seed: number, n: number): number[] => {
  const r = makeRng(seed)
  return Array.from({ length: n }, () => random(r))
}

describe('rng — seeded, deterministic, resumable', () => {
  it('the same seed reproduces the identical sequence', () => {
    expect(seq(12345, 10)).toEqual(seq(12345, 10))
  })

  it('different seeds give different sequences', () => {
    expect(seq(1, 8)).not.toEqual(seq(2, 8))
  })

  it('floats are in [0, 1)', () => {
    const r = makeRng(99)
    for (let i = 0; i < 1000; i += 1) {
      const v = random(r)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  // THE property that makes save/load + offline replay reproducible: store the
  // state mid-stream, rebuild from it, and the sequence continues identically.
  it('is resumable from a stored state', () => {
    const a = makeRng(777)
    for (let i = 0; i < 5; i += 1) random(a) // advance
    const stored = a.s
    const continuedA = [random(a), random(a), random(a)]
    const b = makeRng(stored) // resume from the stored state
    const continuedB = [random(b), random(b), random(b)]
    expect(continuedB).toEqual(continuedA)
  })

  it('int stays in [0, max) and covers the whole range', () => {
    const r = makeRng(5)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i += 1) {
      const v = int(r, 4)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(4)
      seen.add(v)
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3])) // all buckets hit
  })

  it('range is inclusive of both ends', () => {
    const r = makeRng(42)
    const vals = Array.from({ length: 500 }, () => range(r, 3, 6))
    expect(Math.min(...vals)).toBe(3)
    expect(Math.max(...vals)).toBe(6)
  })

  it('pick returns an element and is deterministic per seed', () => {
    const items = ['a', 'b', 'c', 'd'] as const
    const draw = (seed: number): string => pick(makeRng(seed), items)
    expect(items).toContain(draw(1))
    expect(draw(123)).toBe(draw(123))
  })

  it('nextSeed yields a stable, seed-derived sub-seed', () => {
    expect(nextSeed(makeRng(8))).toBe(nextSeed(makeRng(8)))
    expect(nextSeed(makeRng(8))).not.toBe(nextSeed(makeRng(9)))
  })
})
