import { describe, it, expect } from 'vitest'
import mightSurge from './might-surge'
import swiftWind from './swift-wind'
import mendingTide from './mending-tide'
import cartographer from './cartographer'
import treasureSense from './treasure-sense'
import enfeeble from './enfeeble'
import { makeWarrior, type Combatant } from '../../../sim'
import { poolFor } from '../../../combat-core'
import type { DelveState } from '../../../delve'
import type { DungeonGraph, LevelSkeleton } from '../../../mapgraph'

// A minimal but real DelveState to drive a buff's `apply` in isolation (no full delve).
const graph: DungeonGraph = {
  rooms: [
    { id: 'in', type: 'entrance' },
    { id: 'l1', type: 'loot' },
    { id: 'l2', type: 'loot' },
    { id: 'f', type: 'fight' },
    { id: 'boss', type: 'boss' },
  ],
  corridors: [],
  entranceId: 'in',
  bossId: 'boss',
  rngState: 0,
}
const level: LevelSkeleton = {
  id: 'x', name: 'X', monsterPool: ['slime'], boss: 'hex-warden',
  topology: { slots: [{ id: 'in', type: 'entrance' }, { id: 'boss', type: 'boss' }], edges: [['in', 'boss']] },
}
const hurt = (over: Partial<Combatant>): Combatant => ({ ...makeWarrior([]), ...over })
const stateWith = (party: Combatant[], revealed: string[] = []): DelveState => ({
  seed: 1, levelId: 'x', level, rng: 0, graph, party, pos: 'in',
  explored: ['in'], cleared: [], resolved: [], revealed, buffs: [],
  exploration: [], battle: null, status: 'delving', turn: 0, log: [],
})

describe('buffs — each standalone boon transforms what it claims (and nothing else)', () => {
  it('Surge of Might DOUBLES every golem\'s Might (relative, persists on the party)', () => {
    const s = stateWith([hurt({ might: 5 }), hurt({ might: 8 })])
    const after = mightSurge.apply(s)
    expect(after.party.map((u) => u.might)).toEqual([10, 16])
    expect(s.party.map((u) => u.might)).toEqual([5, 8]) // pure — input untouched
  })

  it('Swift Wind DOUBLES Celerity', () => {
    const after = swiftWind.apply(stateWith([hurt({ celerity: 6 })]))
    expect(after.party[0].celerity).toBe(12)
  })

  it('Mending Tide is a free full heal — back to max HP, Strain cleared', () => {
    const after = mendingTide.apply(stateWith([hurt({ hp: 3, maxHp: 40, strain: 7 })]))
    expect(after.party[0].hp).toBe(40)
    expect(after.party[0].strain).toBe(0)
  })

  it('Cartographer\'s Eye reveals EVERY room', () => {
    const after = cartographer.apply(stateWith([]))
    expect(after.revealed).toEqual(['in', 'l1', 'l2', 'f', 'boss'])
  })

  it('Treasure Sense reveals only LOOT rooms (merged with prior reveals, de-duped)', () => {
    const after = treasureSense.apply(stateWith([], ['f']))
    expect([...after.revealed].sort()).toEqual(['f', 'l1', 'l2'])
  })

  it('Enfeeble HALVES an enemy\'s Fortitude on spawn and recomputes maxHp (no desync)', () => {
    const weakened = enfeeble.onSpawn(hurt({ side: 'enemy', fortitude: 8, maxHp: poolFor(8), hp: poolFor(8) }))
    expect(weakened.fortitude).toBe(4)
    expect(weakened.maxHp).toBe(poolFor(4)) // hp pool follows fortitude down
    expect(weakened.hp).toBe(poolFor(4)) // a full-HP spawn stays full at the new cap
    expect(weakened.fortitude).toBeGreaterThanOrEqual(1) // never floored below 1
  })
})
