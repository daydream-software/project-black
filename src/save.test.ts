import { describe, it, expect } from 'vitest'
import {
  saveSlot,
  loadSlot,
  salvageMeta,
  deleteSlot,
  listSlots,
  importLegacy,
  SLOT_COUNT,
  type KVStore,
  type SaveData,
} from './save'

/** A tiny in-memory KVStore so the slot layer is testable in node (no DOM). */
function fakeStore(seed: Record<string, string> = {}): KVStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
    removeItem: (k) => { map.delete(k) },
  }
}

/** A minimal snapshot that passes isSaveData (roster is the only array we care about). */
function snap(heroCount: number): Omit<SaveData, 'version' | 'savedAt'> {
  const roster = Array.from({ length: heroCount }, (_, i) => ({ simId: `hero-${i}`, name: 'X', rows: [] }))
  return { roster, activeHero: 0, exploration: [], mode: 'camp', delve: null }
}

describe('save — slots', () => {
  it('round-trips a snapshot through one slot', () => {
    const store = fakeStore()
    saveSlot(1, snap(2), store)
    const loaded = loadSlot(1, store)
    expect(loaded?.roster).toHaveLength(2)
    expect(loaded?.version).toBe(3)
    expect(typeof loaded?.savedAt).toBe('number')
  })

  it('round-trips the unlock meta (clearedLevels + insight + unlocked)', () => {
    const store = fakeStore()
    saveSlot(0, { ...snap(2), clearedLevels: ['lvl-1', 'lvl-3'], insight: 5, unlocked: ['enemy-most-hp'] }, store)
    expect(loadSlot(0, store)?.clearedLevels).toEqual(['lvl-1', 'lvl-3'])
    expect(loadSlot(0, store)?.insight).toBe(5)
    expect(loadSlot(0, store)?.unlocked).toEqual(['enemy-most-hp'])
    // a pre-10a/10b blob (no clearedLevels / insight / unlocked) still loads — fields are additive
    saveSlot(1, snap(2), store)
    expect(loadSlot(1, store)?.clearedLevels).toBeUndefined()
    expect(loadSlot(1, store)?.insight).toBeUndefined()
    expect(loadSlot(1, store)?.unlocked).toBeUndefined()
  })

  it('keeps slots independent — writing one does not touch the others', () => {
    const store = fakeStore()
    saveSlot(1, snap(2), store)
    expect(loadSlot(0, store)).toBeNull()
    expect(loadSlot(2, store)).toBeNull()
    saveSlot(0, snap(4), store)
    expect(loadSlot(0, store)?.roster).toHaveLength(4) // unchanged by slot 1
    expect(loadSlot(1, store)?.roster).toHaveLength(2)
  })

  it('deleteSlot erases only its own slot', () => {
    const store = fakeStore()
    saveSlot(0, snap(2), store)
    saveSlot(1, snap(2), store)
    deleteSlot(0, store)
    expect(loadSlot(0, store)).toBeNull()
    expect(loadSlot(1, store)).not.toBeNull() // survivor untouched
  })

  it('listSlots reports empty vs filled metadata for every slot', () => {
    const store = fakeStore()
    saveSlot(1, snap(3), store)
    const slots = listSlots(store)
    expect(slots).toHaveLength(SLOT_COUNT)
    expect(slots[0]).toMatchObject({ index: 0, savedAt: null, mode: null, heroCount: 0 })
    expect(slots[1]).toMatchObject({ index: 1, mode: 'camp', heroCount: 3 })
    expect(slots[1].savedAt).toEqual(expect.any(Number))
  })

  it('a corrupt slot blob loads as null (defensive — never throws)', () => {
    const store = fakeStore({ 'project-black/save/slot/0': '{not json' })
    expect(loadSlot(0, store)).toBeNull()
    expect(listSlots(store)[0].savedAt).toBeNull()
  })

  it('salvages meta-progression from a stale-version blob that loadSlot rejects', () => {
    // A future/old save format we can no longer fully load: loadSlot returns null,
    // but the player's unlocks/insight/cleared levels must not be silently wiped.
    const stale = {
      version: 999, // unknown format → isSaveData rejects it
      savedAt: 1,
      roster: [{ simId: 'a', name: 'X', rows: [] }],
      somethingWeNoLongerUnderstand: true,
      clearedLevels: ['lvl-1', 'lvl-2'],
      insight: 4,
      unlocked: ['enemy-most-hp'],
    }
    const store = fakeStore({ 'project-black/save/slot/0': JSON.stringify(stale) })
    expect(loadSlot(0, store)).toBeNull() // we can't load the run state...
    expect(salvageMeta(0, store)).toEqual({ clearedLevels: ['lvl-1', 'lvl-2'], insight: 4, unlocked: ['enemy-most-hp'] })
  })

  it('salvageMeta returns null when there is nothing worth carrying', () => {
    const store = fakeStore({
      'project-black/save/slot/0': '{not json',
      'project-black/save/slot/1': JSON.stringify({ version: 1, roster: [], insight: 0 }), // no meta
    })
    expect(salvageMeta(0, store)).toBeNull() // corrupt
    expect(salvageMeta(1, store)).toBeNull() // parseable but empty meta
    expect(salvageMeta(2, store)).toBeNull() // empty slot
  })

  it('rejects a malformed roster (empty, or a hero with no rows array) but allows a 1-golem build', () => {
    // party() maps the roster and reads each .rows — an empty or shapeless roster
    // must not load and crash on the first frame; it loads as null instead. A
    // 1-golem "titan" roster IS legal under point-buy (the >=1 floor), so it loads.
    const empty = { version: 3, savedAt: 1, roster: [], activeHero: 0, mode: 'camp', delve: null }
    const noRows = { version: 3, savedAt: 1, roster: [{ simId: 'a' }, { simId: 'b' }], activeHero: 0, mode: 'camp', delve: null }
    const titan = { version: 3, savedAt: 1, roster: [{ simId: 'h', name: 'Titan', rows: [] }], activeHero: 0, mode: 'camp', delve: null }
    const store = fakeStore({
      'project-black/save/slot/0': JSON.stringify(empty),
      'project-black/save/slot/1': JSON.stringify(noRows),
      'project-black/save/slot/2': JSON.stringify(titan),
    })
    expect(loadSlot(0, store)).toBeNull()
    expect(loadSlot(1, store)).toBeNull()
    expect(loadSlot(2, store)?.roster).toHaveLength(1) // single golem accepted
  })

  it('drops an in-progress delve saved before the six-stat model, keeping roster + meta', () => {
    // A pre-six-stat delve persists Combatants with atk/hp but no might/ward — its
    // next fight would compute NaN damage. loadSlot resets it to town (Design:
    // "a delve saved before this refactor — just reset it"), profile preserved.
    const staleParty = [{ id: 'hero-1', name: 'Sentinel', side: 'hero', hp: 90, maxHp: 120, atk: 11, defending: false, procedure: [] }]
    const blob = {
      version: 3,
      savedAt: 1,
      roster: [{ simId: 'hero-1', name: 'Sentinel', rows: [] }, { simId: 'hero-2', name: 'Mender', rows: [] }],
      activeHero: 0,
      mode: 'delve',
      insight: 3,
      unlocked: ['enemy-most-hp'],
      delve: { status: 'delving', pos: 5, turn: 9, dungeon: {}, party: staleParty, explored: [], exploration: [] },
    }
    const store = fakeStore({ 'project-black/save/slot/0': JSON.stringify(blob) })
    const loaded = loadSlot(0, store)
    expect(loaded?.delve).toBeNull() // the stale delve is dropped...
    expect(loaded?.mode).toBe('camp') // ...and we land in town
    expect(loaded?.roster).toHaveLength(2) // roster preserved
    expect(loaded?.insight).toBe(3) // meta preserved
    expect(loaded?.unlocked).toEqual(['enemy-most-hp'])

    // A delve whose party DOES carry stats is left intact (not over-eagerly dropped).
    const freshParty = [{ ...staleParty[0], might: 5, ward: 2, fortitude: 10, attunement: 0, poise: 0, celerity: 5 }]
    const fresh = { ...blob, delve: { ...blob.delve, party: freshParty } }
    const store2 = fakeStore({ 'project-black/save/slot/0': JSON.stringify(fresh) })
    expect(loadSlot(0, store2)?.delve).not.toBeNull()
    expect(loadSlot(0, store2)?.mode).toBe('delve')
  })

  it('importLegacy moves an old single-save blob into slot 0, preserving savedAt', () => {
    const legacy: SaveData = { version: 3, savedAt: 12345, ...snap(2) }
    const store = fakeStore({ 'project-black/save': JSON.stringify(legacy) })
    importLegacy(store)
    expect(loadSlot(0, store)?.savedAt).toBe(12345) // verbatim — not re-stamped
    expect(store.map.has('project-black/save')).toBe(false) // legacy key dropped
  })

  it('importLegacy does not clobber an occupied slot 0', () => {
    const legacy: SaveData = { version: 3, savedAt: 12345, ...snap(2) }
    const store = fakeStore({ 'project-black/save': JSON.stringify(legacy) })
    saveSlot(0, snap(5), store) // slot 0 already has a profile
    importLegacy(store)
    expect(loadSlot(0, store)?.roster).toHaveLength(5) // untouched
    expect(store.map.has('project-black/save')).toBe(true) // legacy left alone
  })
})
