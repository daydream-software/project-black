import { describe, it, expect } from 'vitest'
import {
  decide,
  conditionHolds,
  step,
  initialState,
  HEAL_AMOUNT,
  type Program,
  type Combatant,
} from './sim'

// The same two-gambit program the game ships with.
const PROGRAM: Program = [
  { condition: { kind: 'selfHpPctBelow', value: 30 }, action: 'heal', label: 'heal' },
  { condition: { kind: 'always' }, action: 'attack', label: 'attack' },
]

const hero = (hp: number): Combatant => ({ name: 'h', hp, maxHp: 100, atk: 8 })
const slime = (hp = 24): Combatant => ({ name: 's', hp, maxHp: 24, atk: 7 })

describe('decide — the core logic, checked against hand-computed answers', () => {
  it('heals when self HP is below the 30% threshold', () => {
    const d = decide(hero(25), slime(), PROGRAM)
    expect(d.action).toBe('heal')
    expect(d.ruleIndex).toBe(0) // the FIRST gambit fired
  })

  it('attacks at full HP', () => {
    expect(decide(hero(100), slime(), PROGRAM).action).toBe('attack')
  })

  // The test that catches a broken implementation: the boundary. 30/100 = exactly
  // 30%, which is NOT "below 30%", so it must attack. An off-by-one (<=) flips
  // this and the test fails loudly.
  it('boundary: exactly 30% attacks; 29% heals', () => {
    expect(decide(hero(30), slime(), PROGRAM).action).toBe('attack')
    expect(decide(hero(29), slime(), PROGRAM).action).toBe('heal')
  })

  it('gambit order is priority order: first matching gambit wins', () => {
    const reversed: Program = [PROGRAM[1], PROGRAM[0]]
    expect(decide(hero(10), slime(), reversed).action).toBe('attack')
  })

  it('falls back to attack when no gambit matches', () => {
    const noMatch: Program = [{ condition: { kind: 'selfHpPctBelow', value: 0 }, action: 'heal', label: 'never' }]
    const d = decide(hero(50), slime(), noMatch)
    expect(d.action).toBe('attack')
    expect(d.ruleIndex).toBe(-1)
  })

  it('an enemy-targeting gambit reads the enemy, not the actor', () => {
    const finisher: Program = [
      { condition: { kind: 'enemyHpPctBelow', value: 30 }, action: 'attack', label: 'finish' },
      { condition: { kind: 'always' }, action: 'defend', label: 'turtle' },
    ]
    // Enemy at 6/24 = 25% -> finisher fires.
    expect(decide(hero(100), slime(6), finisher).ruleIndex).toBe(0)
    // Enemy healthy -> falls through to defend.
    expect(decide(hero(100), slime(24), finisher).action).toBe('defend')
  })
})

describe('conditionHolds', () => {
  it('always is always true', () => {
    expect(conditionHolds({ kind: 'always' }, hero(1), slime())).toBe(true)
  })
  it('selfHpFull is true only at max HP', () => {
    expect(conditionHolds({ kind: 'selfHpFull' }, hero(100), slime())).toBe(true)
    expect(conditionHolds({ kind: 'selfHpFull' }, hero(99), slime())).toBe(false)
  })
  it('hp percentage uses the ratio, not raw HP', () => {
    const tank: Combatant = { name: 't', hp: 40, maxHp: 200, atk: 1 }
    expect(conditionHolds({ kind: 'selfHpPctBelow', value: 30 }, tank, slime())).toBe(true)
  })
})

describe('step — one turn of the simulation', () => {
  it('attacking reduces enemy HP by the hero attack value', () => {
    const s1 = step(initialState(), PROGRAM) // hero at full HP -> attacks
    expect(s1.enemy.hp).toBe(24 - 8)
    expect(s1.turn).toBe(1)
  })

  it('healing raises hero HP and lets the enemy retaliate at full', () => {
    let s = initialState()
    s = { ...s, hero: { ...s.hero, hp: 20 } } // force a heal
    const before = s.enemy.hp
    const s1 = step(s, PROGRAM)
    expect(s1.hero.hp).toBe(20 + HEAL_AMOUNT - s.enemy.atk)
    expect(s1.enemy.hp).toBe(before) // enemy was not attacked this turn
  })

  it('defending halves the incoming retaliation', () => {
    const defendOnly: Program = [{ condition: { kind: 'always' }, action: 'defend', label: 'd' }]
    const s1 = step(initialState(), defendOnly)
    // slime atk 7 -> ceil(7/2) = 4 damage taken
    expect(s1.hero.hp).toBe(100 - Math.ceil(7 / 2))
  })

  it('a defeated slime is replaced and the counter increments', () => {
    let s = initialState()
    s = { ...s, enemy: { ...s.enemy, hp: 4 } } // one hit from death (hero atk 8)
    const s1 = step(s, PROGRAM)
    expect(s1.slimesDefeated).toBe(1)
    expect(s1.enemy.hp).toBe(s1.enemy.maxHp) // fresh slime
  })

  it('stepping a dead hero is a no-op', () => {
    const dead = { ...initialState(), hero: { ...initialState().hero, hp: 0 } }
    expect(step(dead, PROGRAM)).toBe(dead)
  })

  it('is deterministic: identical inputs produce identical outputs', () => {
    expect(step(initialState(), PROGRAM)).toEqual(step(initialState(), PROGRAM))
  })
})
