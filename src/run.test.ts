import { describe, it, expect } from 'vitest'
import { startRun, stepRun, catchUp, type RunState } from './run'
import { makeWarrior, makeHealer, type Combatant, type Procedure } from './sim'

// Procedures spelled out so the tests read like the rule language.
const ATTACK = { command: 'attack' } as const
const enemyNearest = { subject: { who: 'enemy', pick: 'first' }, predicate: { p: 'always' } } as const

const attackOnly: Procedure = [{ state: enemyNearest, maneuver: ATTACK, label: 'attack nearest' }]

function runToEnd(run: RunState, cap = 2000): RunState {
  let r = run
  for (let i = 0; i < cap && r.status === 'fighting'; i++) r = stepRun(r)
  return r
}

describe('run — the gauntlet plays itself', () => {
  it('a winning party clears every encounter and the run ends "cleared"', () => {
    // One-shot warrior so the clear is fast and deterministic.
    const party: Combatant[] = [{ ...makeWarrior(attackOnly), atk: 100 }, makeHealer(attackOnly)]
    const run = runToEnd(startRun(party, ['duo', 'pack', 'warden']))
    expect(run.status).toBe('cleared')
    expect(run.depth).toBe(2) // reached and cleared the last encounter
  })

  it('hero HP and identity carry across encounters (attrition)', () => {
    const party: Combatant[] = [makeWarrior(attackOnly), makeHealer(attackOnly)]
    let r = startRun(party, ['duo', 'pack'])
    // Step until the first encounter is cleared and the second has begun.
    for (let i = 0; i < 2000 && r.depth === 0 && r.status === 'fighting'; i++) r = stepRun(r)
    expect(r.depth).toBe(1) // advanced
    expect(r.status).toBe('fighting')
    const warrior = r.battle.units.find((u) => u.id === 'hero-1')
    expect(warrior?.name).toBe('Warrior') // same hero, not a fresh one
    expect(warrior?.hp).toBeLessThan(120) // it took damage in encounter 1 and kept it
    expect(warrior?.hp ?? 0).toBeGreaterThan(0)
    // Fresh enemies for the new encounter, full HP, clean log.
    expect(r.battle.turn).toBe(0)
    expect(r.battle.units.filter((u) => u.side === 'enemy')).toHaveLength(3) // 'pack'
  })

  it('a party that cannot survive ends the run "dead" at the encounter it lost', () => {
    const weak: Combatant[] = [
      { ...makeWarrior(attackOnly), hp: 8, maxHp: 8, atk: 1 },
      { ...makeHealer(attackOnly), hp: 8, maxHp: 8, atk: 1 },
    ]
    const run = runToEnd(startRun(weak, ['duo', 'pack', 'warden']))
    expect(run.status).toBe('dead')
    expect(run.depth).toBe(0) // never got past the opener
    expect(run.battle.outcome).toBe('defeat')
  })

  it('stepping a finished run is a no-op (cleared or dead)', () => {
    const cleared = runToEnd(startRun([{ ...makeWarrior(attackOnly), atk: 100 }, makeHealer(attackOnly)], ['duo']))
    expect(cleared.status).toBe('cleared')
    expect(stepRun(cleared)).toBe(cleared)
  })

  it('is deterministic: identical runs produce identical end states', () => {
    const mk = (): Combatant[] => [makeWarrior(attackOnly), makeHealer(attackOnly)]
    const a = runToEnd(startRun(mk(), ['duo', 'pack']))
    const b = runToEnd(startRun(mk(), ['duo', 'pack']))
    expect(a).toEqual(b)
  })
})

describe('catchUp — offline fast-forward by N steps', () => {
  const mk = (): RunState => startRun([makeWarrior(attackOnly), makeHealer(attackOnly)], ['duo', 'pack', 'warden'])

  it('replaying N steps equals N live stepRun calls (deterministic catch-up)', () => {
    let live = mk()
    for (let i = 0; i < 25; i++) live = stepRun(live)
    expect(catchUp(mk(), 25)).toEqual(live)
  })

  it('0 steps is a no-op', () => {
    const r = mk()
    expect(catchUp(r, 0)).toBe(r)
  })

  it('stops at resolution: a huge step count fast-forwards only to the run end', () => {
    const ended = catchUp(mk(), 1_000_000) // "reopened a week later"
    expect(ended.status === 'cleared' || ended.status === 'dead').toBe(true)
    // and once resolved it stays put — catching up further changes nothing
    expect(catchUp(ended, 1_000_000)).toBe(ended)
  })

  it('a partial catch-up that does not resolve leaves the run still fighting', () => {
    const r = catchUp(mk(), 3)
    expect(r.status).toBe('fighting')
    expect(r.battle.turn).toBe(3) // 3 unit-actions happened in the first encounter
  })
})
