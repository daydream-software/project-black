// Save / load wiring.
//
// localStorage persistence for the town roster (the editor's rows) AND the
// current delve, stamped with a timestamp. There is no offline progress: an
// in-progress delve resumes in real time exactly where it was saved (the timestamp
// is just metadata for the slot-select screen's "x ago").
//
// This module owns all the storage I/O; the pure layers (sim.ts, delve.ts) never
// see a clock. Loading is defensive: a corrupt blob is ignored (start fresh) and a
// stale-version blob keeps only its meta — never throws, a bad save must not brick
// the game.

import type { DelveState, DelveStatus } from './delve'
import type { SkillId, Stats } from './sim'

// --- Persisted shapes (also the editor's row types) ------------------------

export interface ProtocolRow {
  subjectId: string
  predId: string
  command: 'attack' | 'useSkill' | 'flee'
  skillId: SkillId // only used when command === 'useSkill'
  enabled: boolean
}

export interface Hero {
  simId: string // matches the id sim.ts assigns (hero-1 = Sentinel, hero-2 = Mender)
  name: string
  // The authored point-buy stat block (M·W·F·A·P·C). Optional/additive: pre-point-buy
  // saves lack it, and party() falls back to the reference blocks — so this stays a
  // no-version-bump field that never wipes a live player's authored Procedures.
  stats?: Stats
  // The FROZEN point-buy floor: the allocation committed on a past Descend. Stats can
  // be raised above it with fresh points but never lowered below — spent points are
  // permanent. Absent = never frozen (a golem added this town visit, fully refundable
  // and removable). Set by descend(); additive (legacy/pending golems lack it).
  committed?: Stats
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
  // Levels this profile has cleared at least once (slice 10a) — the meta that
  // survives a wipe and (slice 10b) gates Insight to first clears. Optional/additive:
  // pre-10a saves lack it and default to empty.
  clearedLevels?: string[]
  // Insight: the rare unlock currency, +1 per first level clear (slice 10b).
  // Additive/optional; pre-10b saves default to 0.
  insight?: number
  // Vocabulary ids learned at the Trainer (slice 10b) — gates the editor. Additive.
  unlocked?: string[]
  mode: Mode
  delve: DelveState | null
}

// The slot keys derive from this; KEY itself is now only the *legacy* single-save
// blob that importLegacy migrates into slot 0 (slice 9). Kept as the legacy key.
const KEY = 'project-black/save'
const VERSION = 3 // bumped: run (gauntlet) replaced by delve (slice 8b); older blobs ignored

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

/** A persisted hero must carry a rows array — `party()`/`procedureFor` index into
 *  it, so a malformed entry would crash on the first frame. */
function isHero(x: unknown): x is Hero {
  return isObj(x) && Array.isArray(x.rows)
}

function isDelveStatus(x: unknown): x is DelveStatus {
  return x === 'delving' || x === 'cleared' || x === 'dead' || x === 'stuck'
}

function isDelveState(x: unknown): x is DelveState {
  return (
    isObj(x) &&
    isDelveStatus(x.status) &&
    typeof x.pos === 'number' &&
    typeof x.turn === 'number' &&
    isObj(x.dungeon) &&
    Array.isArray(x.party) &&
    Array.isArray(x.explored) &&
    Array.isArray(x.exploration)
  )
}

/** An optional field that, when present, must be an array (drops out of the
 *  complexity of the big validator while reading the same). */
function isOptArray(v: unknown): boolean {
  return v === undefined || Array.isArray(v)
}

/** The optional/additive meta fields + the mode/delve pair — validated apart so
 *  `isSaveData` stays under the complexity bar. */
function isAuxFields(x: Record<string, unknown>): boolean {
  return (
    isOptArray(x.exploration) &&
    isOptArray(x.clearedLevels) &&
    (x.insight === undefined || typeof x.insight === 'number') &&
    isOptArray(x.unlocked) &&
    (x.mode === 'camp' || x.mode === 'delve') &&
    (x.delve === null || isDelveState(x.delve))
  )
}

function isSaveData(x: unknown): x is SaveData {
  return (
    isObj(x) &&
    x.version === VERSION &&
    typeof x.savedAt === 'number' &&
    Array.isArray(x.roster) &&
    x.roster.length >= 1 && // ≥1 golem: the point-buy model allows a 1-golem "titan" build
    x.roster.every(isHero) &&
    typeof x.activeHero === 'number' &&
    isAuxFields(x)
  )
}

// --- Save slots (slice 9) ---------------------------------------------------
// Multiple independent roguelite profiles, one localStorage key each. The store
// is injected (defaulting to localStorage) so the slot logic is unit-testable in
// node without a DOM — pass a tiny in-memory fake in tests. ADDITIVE: the legacy
// single-save saveGame/loadGame above stay until main.ts is rewired (slice 9b).

/** The localStorage subset the slot layer needs (so tests can fake it). */
export interface KVStore {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export const SLOT_COUNT = 3
const slotKey = (index: number): string => `${KEY}/slot/${index}`

/** A peek at a slot for the slot-select screen (no full load of the delve state). */
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

/** The meta-progression that survives a wipe (and must survive a save-format
 *  change too): levels first-cleared, Insight, and learned vocabulary. */
export interface SalvagedMeta {
  clearedLevels: string[]
  insight: number
  unlocked: string[]
}

/**
 * Rescue the meta-progression off a slot blob that `loadSlot` *rejected* (a stale
 * version, or a run-state shape we no longer understand), so a save-format change
 * never silently wipes a player's unlocks. We deliberately salvage only the
 * primitive, format-stable meta — never the roster / Procedures / delve, which are
 * the parts that churn and could brick. The caller rebuilds a fresh run around it.
 * Returns null when there's nothing worth carrying (empty/corrupt/no-meta blob).
 */
export function salvageMeta(index: number, store: KVStore = localStorage): SalvagedMeta | null {
  const raw = tryGet(store, slotKey(index))
  if (raw === null) return null
  const parsed = tryParseJson(raw)
  if (!isObj(parsed)) return null
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  const clearedLevels = strings(parsed.clearedLevels)
  const insight = typeof parsed.insight === 'number' && parsed.insight >= 0 ? parsed.insight : 0
  const unlocked = strings(parsed.unlocked)
  if (clearedLevels.length === 0 && insight === 0 && unlocked.length === 0) return null
  return { clearedLevels, insight, unlocked }
}

/** An in-progress delve persists live `Combatant` objects. One saved BEFORE the
 *  six-stat model carries `atk`/`hp` but no `might`/`ward`/… — resuming its next
 *  fight would compute `NaN` damage. We can't migrate a live combatant mid-fight,
 *  so we drop the stale delve back to town (roster + meta are untouched, and the
 *  town party is always rebuilt fresh with stats). Non-destructive, in the spirit
 *  of the defensive load: a format change never bricks a profile. */
function dropStaleDelve(data: SaveData): SaveData {
  if (data.delve === null) return data
  const partyHasStats = data.delve.party.every((u) => isObj(u) && typeof u.might === 'number' && typeof u.ward === 'number')
  if (partyHasStats) return data
  return { ...data, delve: null, mode: 'camp' }
}

/** Read a key, returning null if storage is unavailable/blocked (never throws). */
function tryGet(store: KVStore, key: string): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

/** Parse JSON, returning undefined on malformed input (never throws). */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Load one slot, or null if empty / corrupt / stale. Never throws. */
export function loadSlot(index: number, store: KVStore = localStorage): SaveData | null {
  const raw = tryGet(store, slotKey(index))
  if (raw === null) return null
  const parsed = tryParseJson(raw)
  return isSaveData(parsed) ? dropStaleDelve(parsed) : null
}

/** Erase one slot (the player chose to delete that profile). */
export function deleteSlot(index: number, store: KVStore = localStorage): void {
  try {
    store.removeItem(slotKey(index))
  } catch {
    /* non-fatal */
  }
}

/** One slot's card metadata (empty slot → all-null). Split out of `listSlots` so
 *  the optional-chain fan-out doesn't blow the per-function complexity bar. */
function toSlotInfo(index: number, s: SaveData | null): SlotInfo {
  if (s === null) return { index, savedAt: null, mode: null, delveStatus: null, heroCount: 0 }
  return {
    index,
    savedAt: s.savedAt,
    mode: s.mode,
    delveStatus: s.delve?.status ?? null,
    heroCount: s.roster.length,
  }
}

/** Metadata for every slot — drives the slot-select cards. */
export function listSlots(store: KVStore = localStorage): SlotInfo[] {
  const slots: SlotInfo[] = []
  for (let i = 0; i < SLOT_COUNT; i += 1) slots.push(toSlotInfo(i, loadSlot(i, store)))
  return slots
}

/**
 * One-shot migration: if slot 0 is empty and a legacy single-save blob exists,
 * move it into slot 0 *verbatim* (preserving its `savedAt`) and drop the legacy
 * key.
 */
export function importLegacy(store: KVStore = localStorage): void {
  if (loadSlot(0, store) !== null) return // slot 0 already in use — don't clobber
  const raw = tryGet(store, KEY)
  if (raw === null) return
  if (!isSaveData(tryParseJson(raw))) return // only migrate a blob we'd actually load
  try {
    store.setItem(slotKey(0), raw)
    store.removeItem(KEY)
  } catch {
    /* non-fatal — leave the legacy blob alone */
  }
}
