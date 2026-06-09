// Save / load + offline catch-up wiring.
//
// localStorage persistence for the camp roster (the editor's rows) AND the
// current run, stamped with a timestamp so that on the NEXT page load we can
// fast-forward an in-progress run by the elapsed wall-clock (offline progress).
//
// This module owns all the time/storage I/O; the pure layers (sim.ts, run.ts)
// never see a clock. Loading is defensive: a stale-schema or corrupt blob is
// ignored (start fresh), never throws — a bad save must not brick the game.

import type { RunState } from './run'
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

export type Mode = 'camp' | 'run'

export interface SaveData {
  version: number
  savedAt: number // ms epoch when this snapshot was taken
  roster: Hero[]
  activeHero: number
  mode: Mode
  run: RunState | null
}

/** Must match the run loop's tick interval in main.ts (offline replay uses it). */
export const STEP_MS = 450

const KEY = 'project-black/save'
const VERSION = 2 // bumped: RunState gained `seed` (slice 7); older blobs are ignored

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

function isRunState(x: unknown): x is RunState {
  return (
    isObj(x) &&
    (x.status === 'fighting' || x.status === 'cleared' || x.status === 'dead') &&
    typeof x.depth === 'number' &&
    Array.isArray(x.gauntlet) &&
    Array.isArray(x.party) &&
    isObj(x.battle)
  )
}

function isSaveData(x: unknown): x is SaveData {
  return (
    isObj(x) &&
    x.version === VERSION &&
    typeof x.savedAt === 'number' &&
    Array.isArray(x.roster) &&
    typeof x.activeHero === 'number' &&
    (x.mode === 'camp' || x.mode === 'run') &&
    (x.run === null || isRunState(x.run))
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
