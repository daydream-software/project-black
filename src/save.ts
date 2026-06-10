// Save / load + offline catch-up wiring.
//
// localStorage persistence for the town roster (the editor's rows) AND the
// current delve, stamped with a timestamp so that on the NEXT page load we can
// fast-forward an in-progress delve by the elapsed wall-clock (offline progress).
//
// This module owns all the time/storage I/O; the pure layers (sim.ts, delve.ts)
// never see a clock. Loading is defensive: a stale-schema or corrupt blob is
// ignored (start fresh), never throws — a bad save must not brick the game.

import type { DelveState, DelveStatus } from './delve'
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

/** One row of the party's exploration Protocol (Subject · Predicate → Move). */
export interface ExProtocolRow {
  subjectId: string
  predId: string
  moveId: string
  enabled: boolean
}

export type Mode = 'camp' | 'delve'

export interface SaveData {
  version: number
  savedAt: number // ms epoch when this snapshot was taken
  roster: Hero[]
  activeHero: number
  // The party-wide exploration Protocol rows. Optional in the blob: saves written
  // before slice 8c lack it, and load defaults them — so this stays additive (no
  // version bump, no wiping a live player's authored combat Procedure).
  exploration?: ExProtocolRow[]
  mode: Mode
  delve: DelveState | null
}

/** Must match the delve loop's tick interval in main.ts (offline replay uses it). */
export const STEP_MS = 450

// The slot keys derive from this; KEY itself is now only the *legacy* single-save
// blob that importLegacy migrates into slot 0 (slice 9). Kept as the legacy key.
const KEY = 'project-black/save'
const VERSION = 3 // bumped: run (gauntlet) replaced by delve (slice 8b); older blobs ignored

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
    (x.exploration === undefined || Array.isArray(x.exploration)) &&
    (x.mode === 'camp' || x.mode === 'delve') &&
    (x.delve === null || isDelveState(x.delve))
  )
}

/** How many run-steps elapsed between a save and now (for offline catch-up). */
export function elapsedSteps(savedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - savedAt) / STEP_MS))
}

// --- Save slots (slice 9) ---------------------------------------------------
// Multiple independent roguelite profiles, one localStorage key each. The store
// is injected (defaulting to localStorage) so the slot logic is unit-testable in
// node without a DOM — pass a tiny in-memory fake in tests. ADDITIVE: the legacy
// single-save saveGame/loadGame above stay until main.ts is rewired (slice 9b).

/** The localStorage subset the slot layer needs (so tests can fake it). */
export interface KVStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const SLOT_COUNT = 3
const slotKey = (index: number): string => `${KEY}/slot/${index}`

/** A peek at a slot for the slot-select screen — never runs offline catch-up. */
export interface SlotInfo {
  index: number
  savedAt: number | null // null = empty slot
  mode: Mode | null
  delveStatus: DelveStatus | null
  heroCount: number
}

/** Persist a snapshot into one slot, stamped with `version` + `savedAt = now`. */
export function saveSlot(
  index: number,
  snapshot: Omit<SaveData, 'version' | 'savedAt'>,
  store: KVStore = localStorage,
): void {
  const data: SaveData = { version: VERSION, savedAt: Date.now(), ...snapshot }
  try {
    store.setItem(slotKey(index), JSON.stringify(data))
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

/** Load one slot, or null if empty / corrupt / stale. Never throws. */
export function loadSlot(index: number, store: KVStore = localStorage): SaveData | null {
  let raw: string | null
  try {
    raw = store.getItem(slotKey(index))
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

/** Erase one slot (the player chose to delete that profile). */
export function deleteSlot(index: number, store: KVStore = localStorage): void {
  try {
    store.removeItem(slotKey(index))
  } catch {
    /* non-fatal */
  }
}

/** Metadata for every slot — drives the slot-select cards. */
export function listSlots(store: KVStore = localStorage): SlotInfo[] {
  const slots: SlotInfo[] = []
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = loadSlot(i, store)
    slots.push({
      index: i,
      savedAt: s?.savedAt ?? null,
      mode: s?.mode ?? null,
      delveStatus: s?.delve?.status ?? null,
      heroCount: s?.roster.length ?? 0,
    })
  }
  return slots
}

/**
 * One-shot migration: if slot 0 is empty and a legacy single-save blob exists,
 * move it into slot 0 *verbatim* (preserving its `savedAt`, so offline catch-up
 * still measures from the real moment of leaving) and drop the legacy key.
 */
export function importLegacy(store: KVStore = localStorage): void {
  if (loadSlot(0, store) !== null) return // slot 0 already in use — don't clobber
  let raw: string | null
  try {
    raw = store.getItem(KEY)
  } catch {
    return
  }
  if (raw === null) return
  try {
    if (!isSaveData(JSON.parse(raw))) return // only migrate a blob we'd actually load
    store.setItem(slotKey(0), raw)
    store.removeItem(KEY)
  } catch {
    /* non-fatal — leave the legacy blob alone */
  }
}
