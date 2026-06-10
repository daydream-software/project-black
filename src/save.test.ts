import { describe, it, expect } from 'vitest'
import {
  saveSlot,
  loadSlot,
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
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
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

  it('importLegacy moves an old single-save blob into slot 0, preserving savedAt', () => {
    const legacy: SaveData = { version: 3, savedAt: 12345, roster: [], activeHero: 0, mode: 'camp', delve: null }
    const store = fakeStore({ 'project-black/save': JSON.stringify(legacy) })
    importLegacy(store)
    expect(loadSlot(0, store)?.savedAt).toBe(12345) // verbatim — not re-stamped
    expect(store.map.has('project-black/save')).toBe(false) // legacy key dropped
  })

  it('importLegacy does not clobber an occupied slot 0', () => {
    const legacy: SaveData = { version: 3, savedAt: 12345, roster: [], activeHero: 0, mode: 'camp', delve: null }
    const store = fakeStore({ 'project-black/save': JSON.stringify(legacy) })
    saveSlot(0, snap(5), store) // slot 0 already has a profile
    importLegacy(store)
    expect(loadSlot(0, store)?.roster).toHaveLength(5) // untouched
    expect(store.map.has('project-black/save')).toBe(true) // legacy left alone
  })
})
