// Save / load + offline catch-up wiring.
//
// localStorage persistence for the town roster (the editor's rows) AND the
// current delve, stamped with a timestamp so that on the NEXT page load we can
// fast-forward an in-progress delve by the elapsed wall-clock (offline progress).
//
// This module owns all the time/storage I/O; the pure layers (sim.ts, delve.ts)
// never see a clock. Loading is defensive: a stale-schema or corrupt blob is
// ignored (start fresh), never throws — a bad save must not brick the game.

import type { DelveState } from './delve'
import type { SkillId } from './sim'

// --- Persisted shapes (also the editor's row types) ------------------------

export interface ProtocolRow {
  subjectId: string
  predId: string
  command: 'attack' | 'useSkill' | 'flee'
  skillId: SkillId // only used when command === 'useSkill'
  enabled: boolean
}

export interface Hero {
  simId: string // matches the id sim.ts assigns (hero-1 = Warrior, hero-2 = Healer)
  name: string
  rows: ProtocolRow[]
}

export type Mode = 'camp' | 'delve'

export interface SaveData {
  version: number
  savedAt: number // ms epoch when this snapshot was taken
  roster: Hero[]
  activeHero: number
  mode: Mode
  delve: DelveState | null
}

/** Must match the delve loop's tick interval in main.ts (offline replay uses it). */
export const STEP_MS = 450

const KEY = 'project-black/save'
const VERSION = 3 // bumped: run (gauntlet) replaced by delve (slice 8b); older blobs ignored

/** Persist the current state, stamped with `version` and `savedAt = now`. */
export function saveGame(snapshot: Omit<SaveData, 'version' | 'savedAt'>): void {
  const data: SaveData = { version: VERSION, savedAt: Date.now(), ...snapshot }
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* storage full or unavailable — non-fatal, just skip this save */
  }
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function isDelveState(x: unknown): x is DelveState {
  return (
    isObj(x) &&
    (x.status === 'delving' || x.status === 'cleared' || x.status === 'dead' || x.status === 'stuck') &&
    typeof x.pos === 'number' &&
    typeof x.turn === 'number' &&
    isObj(x.dungeon) &&
    Array.isArray(x.party) &&
    Array.isArray(x.explored) &&
    Array.isArray(x.exploration)
  )
}

function isSaveData(x: unknown): x is SaveData {
  return (
    isObj(x) &&
    x.version === VERSION &&
    typeof x.savedAt === 'number' &&
    Array.isArray(x.roster) &&
    typeof x.activeHero === 'number' &&
    (x.mode === 'camp' || x.mode === 'delve') &&
    (x.delve === null || isDelveState(x.delve))
  )
}

/** Load the saved game, or null if there is nothing valid. Never throws. */
export function loadGame(): SaveData | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isSaveData(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** How many run-steps elapsed between a save and now (for offline catch-up). */
export function elapsedSteps(savedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - savedAt) / STEP_MS))
}
