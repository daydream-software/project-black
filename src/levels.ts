// Levels — the re-playable, config-driven dungeons (slice 10a). A level is a
// GenConfig (size + room/pack ranges) plus an id + name. Each descent into a level
// is a FRESH seed within its config, so layouts vary every run; the **first clear**
// of a level is what pays Insight (slice 10b). The actual progression content (the
// real set of levels, their order / gating / costs) is deferred — these two are
// placeholders to build the system on, not a progression decision.

import type { GenConfig } from './dungeon'

export interface LevelConfig extends GenConfig {
  id: string
  name: string
}

export const LEVELS: LevelConfig[] = [
  { id: 'lvl-1', name: 'Level 1', width: 21, height: 15, rooms: [3, 7], packs: [1, 2] },
  { id: 'lvl-2', name: 'Level 2', width: 31, height: 23, rooms: [6, 9], packs: [2, 3] },
]

/** The level with this id, or the first level as a safe fallback. */
export function levelById(id: string): LevelConfig {
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
