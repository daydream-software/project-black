// A small seeded PRNG (mulberry32) — the foundation for procedural dungeons and
// dice (slice 8+). PURE and deterministic: given a seed you always get the same
// sequence.
//
// The state is a single 32-bit integer carried in the `Rng` object. The whole
// point is that it is SERIALISABLE and RESUMABLE: store `rng.s` in game state,
// and `makeRng(storedState)` continues the exact same sequence. That is what
// keeps randomness reproducible across save/load and offline replay (catch-up
// replays the same rolls because it replays from the same stored state).
//
// The `Rng` is mutable for ergonomics (each draw advances `s`); callers keep the
// sim pure by capturing the final `s` back into the immutable game state.

export interface Rng {
  /** Current 32-bit state. Persist this; pass it to makeRng to resume. */
  s: number
}

/** Build an Rng from a seed (or a previously stored state). */
export function makeRng(seedOrState: number): Rng {
  return { s: seedOrState | 0 }
}

/** Next float in [0, 1). Advances the state. */
export function random(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) | 0
  let t = Math.imul(r.s ^ (r.s >>> 15), 1 | r.s)
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Integer in [0, maxExclusive). */
export function int(r: Rng, maxExclusive: number): number {
  return Math.floor(random(r) * maxExclusive)
}

/** Integer in [min, maxInclusive]. */
export function range(r: Rng, min: number, maxInclusive: number): number {
  return min + int(r, maxInclusive - min + 1)
}

/** Pick one element of a non-empty array. */
export function pick<T>(r: Rng, items: readonly T[]): T {
  return items[int(r, items.length)]
}

/** A fresh independent seed derived from this stream (for sub-streams). */
export function nextSeed(r: Rng): number {
  return (random(r) * 0x100000000) | 0
}
