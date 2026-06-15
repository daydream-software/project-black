// Levels — the re-playable, hybrid dungeons (see docs/DUNGEON-SYSTEM.md). A level is a
// LevelSkeleton: an authored TOPOLOGY (a forced shape — mandatory/optional slots +
// corridors) + a monster pool + a boss, instantiated into a fresh room graph per
// descent (seeded). The first clear of a level pays Insight (slice 10b). The real
// progression content (the set/order/gating) is still deferred — these two are
// placeholders to build the system on.

import type { LevelSkeleton } from './mapgraph'

export const LEVELS: LevelSkeleton[] = [
  {
    id: 'lvl-1',
    name: 'The Ruin',
    monsterPool: ['slime'],
    boss: 'hex-warden',
    // A short spine in → f1 → f2 → boss, with an optional loot room branching off f1.
    topology: {
      slots: [
        { id: 'in', type: 'entrance' },
        { id: 'f1', type: 'fight' },
        { id: 'loot', type: 'loot', optional: true },
        { id: 'f2', type: 'fight' },
        { id: 'boss', type: 'boss' },
      ],
      edges: [['in', 'f1'], ['f1', 'loot'], ['f1', 'f2'], ['f2', 'boss']],
    },
  },
  {
    id: 'lvl-2',
    name: 'The Vault',
    monsterPool: ['slime'],
    boss: 'hex-warden',
    // A hub off f1: optional loot + buff leaves, a ??? room, then f2 → boss.
    topology: {
      slots: [
        { id: 'in', type: 'entrance' },
        { id: 'f1', type: 'fight' },
        { id: 'loot', type: 'loot', optional: true },
        { id: 'buff', type: 'buff', optional: true },
        { id: 'q', type: 'mystery' },
        { id: 'f2', type: 'fight' },
        { id: 'boss', type: 'boss' },
      ],
      edges: [['in', 'f1'], ['f1', 'loot'], ['f1', 'buff'], ['f1', 'q'], ['f1', 'f2'], ['f2', 'boss']],
    },
  },
]

/** The level with this id, or the first level as a safe fallback. */
export function levelById(id: string): LevelSkeleton {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0]
}

/** Has this profile cleared the level at least once? */
export function hasCleared(cleared: readonly string[], id: string): boolean {
  return cleared.includes(id)
}

/** Record a level's clear — idempotent, so re-clearing never double-adds (the
 *  "first clear only" rule lives here: the set just gains the id the first time). */
export function recordClear(cleared: readonly string[], id: string): string[] {
  return cleared.includes(id) ? [...cleared] : [...cleared, id]
}

export interface ClearResult {
  clearedLevels: string[]
  insight: number
  firstClear: boolean
}

/** Apply a level clear to the profile's meta: the **first** clear of a level adds
 *  it to the set and pays **+1 Insight**; a re-clear changes nothing. This is the
 *  "Insight only on a first clear, never farmed" rule, made pure & testable. */
export function applyClear(cleared: readonly string[], insight: number, id: string): ClearResult {
  const firstClear = !hasCleared(cleared, id)
  return {
    clearedLevels: recordClear(cleared, id),
    insight: firstClear ? insight + 1 : insight,
    firstClear,
  }
}
