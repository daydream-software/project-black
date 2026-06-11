import { describe, it, expect } from 'vitest'
import {
  decide,
  resolveTarget,
  predicateHolds,
  step,
  initialState,
  makeWarrior,
  makeHealer,
  makeWarden,
  makeEnemy,
  type Combatant,
  type Procedure,
  type State,
} from './sim'

// --- Builders ---------------------------------------------------------------

let counter = 0
function unit(side: 'hero' | 'enemy', hp: number, maxHp: number, procedure: Procedure = []): Combatant {
  counter += 1
  return { id: `${side}-${counter}`, name: `${side}${counter}`, side, hp, maxHp, atk: 10, defending: false, procedure }
}

// Common Maneuvers / States, spelled out so tests read like the rule language.
const ATTACK = { command: 'attack' } as const
const CURE = { command: 'useSkill', skill: 'cure' } as const
const DEFEND = { command: 'useSkill', skill: 'defend' } as const

const enemyNearest: State = { subject: { who: 'enemy', pick: 'first' }, predicate: { p: 'always' } }
const allyLowestHurt: State = { subject: { who: 'ally', pick: 'lowestHp' }, predicate: { p: 'hpPctBelow', value: 50 } }
const selfLow: State = { subject: { who: 'self' }, predicate: { p: 'hpPctBelow', value: 30 } }

describe('predicateHolds', () => {
  it('always is unconditionally true', () => {
    expect(predicateHolds({ p: 'always' }, unit('hero', 1, 100))).toBe(true)
  })
  it('hpFull only at max HP', () => {
    expect(predicateHolds({ p: 'hpFull' }, unit('hero', 100, 100))).toBe(true)
    expect(predicateHolds({ p: 'hpFull' }, unit('hero', 99, 100))).toBe(false)
  })
  it('hpPctBelow uses the ratio, not raw HP, and the boundary is strict', () => {
    const tank = unit('hero', 40, 200) // 20%
    expect(predicateHolds({ p: 'hpPctBelow', value: 30 }, tank)).toBe(true)
    // Exactly 30% is NOT below 30% — an off-by-one (<=) flips this and fails.
    expect(predicateHolds({ p: 'hpPctBelow', value: 30 }, unit('hero', 30, 100))).toBe(false)
    expect(predicateHolds({ p: 'hpPctBelow', value: 30 }, unit('hero', 29, 100))).toBe(true)
  })
})

describe('resolveTarget — the subject IS the target', () => {
  it('Self resolves to the acting unit', () => {
    const me = unit('hero', 100, 100)
    expect(resolveTarget({ subject: { who: 'self' }, predicate: { p: 'always' } }, me, [me])?.id).toBe(me.id)
  })

  it('Enemy nearest = front of the list (lowest index)', () => {
    const me = unit('hero', 100, 100)
    const e1 = unit('enemy', 20, 30)
    const e2 = unit('enemy', 5, 30)
    expect(resolveTarget(enemyNearest, me, [me, e1, e2])?.id).toBe(e1.id)
  })

  it('Enemy lowest-HP picks the most-hurt by ratio, tie-broken by index', () => {
    const me = unit('hero', 100, 100)
    const e1 = unit('enemy', 9, 30) // 30%
    const e2 = unit('enemy', 3, 30) // 10% — most hurt
    const lowest: State = { subject: { who: 'enemy', pick: 'lowestHp' }, predicate: { p: 'always' } }
    expect(resolveTarget(lowest, me, [me, e1, e2])?.id).toBe(e2.id)
    // Tie at 10%: the earlier index wins.
    const e3 = unit('enemy', 3, 30)
    expect(resolveTarget(lowest, me, [me, e2, e3])?.id).toBe(e2.id)
  })

  it('Enemy most-HP picks the healthiest by ratio (focus the biggest threat)', () => {
    const me = unit('hero', 100, 100)
    const e1 = unit('enemy', 9, 30) // 30%
    const e2 = unit('enemy', 27, 30) // 90% — healthiest
    const highest: State = { subject: { who: 'enemy', pick: 'highestHp' }, predicate: { p: 'always' } }
    expect(resolveTarget(highest, me, [me, e1, e2])?.id).toBe(e2.id)
    // Tie at 90%: the earlier index wins.
    const e3 = unit('enemy', 27, 30)
    expect(resolveTarget(highest, me, [me, e2, e3])?.id).toBe(e2.id)
  })

  // The crux: FILTER then PICK. "lowest-HP ally that is ALSO below 50%" — not
  // "the lowest-HP ally, only if it happens to be below 50%".
  it('filter-then-pick: the most-hurt unit is ignored if it fails the predicate', () => {
    const me = unit('hero', 100, 100)
    const a1 = unit('hero', 90, 100) // 90% — above 50%, excluded
    const a2 = unit('hero', 40, 100) // 40% — qualifies, and is the lowest that does
    const a3 = unit('hero', 70, 100) // 70% — above 50%, excluded
    // a1/a3 are NOT the lowest; a2 is the only one under 50% so it must win.
    expect(resolveTarget(allyLowestHurt, me, [me, a1, a2, a3])?.id).toBe(a2.id)
  })

  it('allies include self, and a State with no qualifying unit resolves to null', () => {
    const me = unit('hero', 20, 100) // 20% — self qualifies as a hurt ally
    const ally = unit('hero', 100, 100)
    expect(resolveTarget(allyLowestHurt, me, [me, ally])?.id).toBe(me.id)
    // Nobody hurt -> null (State does not hold).
    const healthy = unit('hero', 100, 100)
    expect(resolveTarget(allyLowestHurt, healthy, [healthy, ally])).toBeNull()
  })

  it('dead units are never targeted', () => {
    const me = unit('hero', 100, 100)
    const corpse = unit('enemy', 0, 30)
    const alive = unit('enemy', 30, 30)
    expect(resolveTarget(enemyNearest, me, [me, corpse, alive])?.id).toBe(alive.id)
  })
})

describe('decide — first State that holds wins, and order is priority', () => {
  it('a higher protocol that does not resolve is skipped for the next that does', () => {
    const proc: Procedure = [
      { state: selfLow, maneuver: CURE, label: 'heal self when low' }, // self at full -> skipped
      { state: enemyNearest, maneuver: ATTACK, label: 'attack' },
    ]
    const me = { ...unit('hero', 100, 100, proc) }
    const enemy = unit('enemy', 30, 30)
    const d = decide(me, [me, enemy])
    expect(d.protocolIndex).toBe(1)
    expect(d.maneuver).toEqual(ATTACK)
    expect(d.targetId).toBe(enemy.id)
  })

  it('reordering changes the outcome (priority = order)', () => {
    const me = unit('hero', 20, 100) // low enough to heal
    const enemy = unit('enemy', 30, 30)
    const healFirst: Procedure = [
      { state: selfLow, maneuver: CURE, label: 'heal' },
      { state: enemyNearest, maneuver: ATTACK, label: 'attack' },
    ]
    const attackFirst: Procedure = [healFirst[1], healFirst[0]]
    expect(decide({ ...me, procedure: healFirst }, [me, enemy]).maneuver).toEqual(CURE)
    expect(decide({ ...me, procedure: attackFirst }, [me, enemy]).maneuver).toEqual(ATTACK)
  })

  it('falls back to attacking the nearest enemy when nothing matches', () => {
    const me = unit('hero', 100, 100, []) // empty procedure
    const enemy = unit('enemy', 30, 30)
    const d = decide(me, [me, enemy])
    expect(d.protocolIndex).toBe(-1)
    expect(d.targetId).toBe(enemy.id)
  })
})

describe('step — one unit-action of the simulation', () => {
  function freshBattle(): ReturnType<typeof initialState> {
    const warrior: Procedure = [{ state: enemyNearest, maneuver: ATTACK, label: 'attack nearest' }]
    const healer: Procedure = [
      { state: allyLowestHurt, maneuver: CURE, label: 'cure hurt ally' },
      { state: enemyNearest, maneuver: ATTACK, label: 'attack nearest' },
    ]
    return initialState(warrior, healer)
  }

  it('the Sentinel acts first and attacks the first slime', () => {
    const s = step(freshBattle())
    expect(s.turn).toBe(1)
    const slime1 = s.units.find((u) => u.id === 'enemy-1')
    expect(slime1?.hp).toBe(26 - 11) // Sentinel atk 11
    expect(s.log.at(-1)?.actorName).toBe('Sentinel')
    expect(s.log.at(-1)?.targetName).toBe('Slime #1')
  })

  it('turn order cycles heroes then enemies, then wraps to a new round', () => {
    let s = freshBattle()
    const actors: string[] = []
    for (let i = 0; i < 6; i++) {
      s = step(s)
      actors.push(s.log.at(-1)?.actorName ?? '?')
    }
    expect(actors.slice(0, 5)).toEqual(['Sentinel', 'Mender', 'Slime #1', 'Slime #2', 'Slime #3'])
    expect(actors[5]).toBe('Sentinel') // round 2 begins
    expect(s.round).toBe(1) // 0-based: the wrap incremented it once
  })

  it('Cure on an enemy is a dead rule: turn is consumed, nothing changes', () => {
    // A procedure that tries to Cure the nearest enemy — invalid, but composition is free.
    const bad: Procedure = [{ state: enemyNearest, maneuver: CURE, label: 'cure enemy (dead rule)' }]
    const me = makeWarrior(bad)
    const enemy = { ...makeHealer([]), side: 'enemy' as const, id: 'enemy-x', name: 'Foe' }
    const state = { ...initialState(bad, []), units: [me, enemy] }
    const s = step(state)
    expect(s.units.find((u) => u.id === 'enemy-x')?.hp).toBe(enemy.hp) // unhealed
    expect(s.log.at(-1)?.detail).toContain('no effect')
    expect(s.turn).toBe(1) // the turn was still consumed
  })

  it('Defend halves the damage the unit takes before its next turn', () => {
    // The Sentinel defends; a single slime then hits it for half.
    const warrior: Procedure = [{ state: { subject: { who: 'self' }, predicate: { p: 'always' } }, maneuver: DEFEND, label: 'defend' }]
    const w = makeWarrior(warrior)
    const slime = { ...makeWarrior([]), side: 'enemy' as const, id: 'enemy-1', name: 'Slime', hp: 26, maxHp: 26, atk: 8 }
    let s = { ...initialState(warrior, []), units: [w, slime] }
    s = step(s) // warrior defends
    expect(s.units[0].defending).toBe(true)
    s = step(s) // slime hits the defending warrior
    expect(s.units[0].hp).toBe(120 - Math.ceil(8 / 2)) // 8 -> 4
  })

  it('reaches victory when the party kills every enemy', () => {
    const warrior: Procedure = [{ state: enemyNearest, maneuver: ATTACK, label: 'attack' }]
    const w = { ...makeWarrior(warrior), atk: 100 } // one-shot
    const slime = { ...makeWarrior([]), side: 'enemy' as const, id: 'enemy-1', name: 'Slime', hp: 10, maxHp: 10, atk: 1 }
    let s = { ...initialState(warrior, []), units: [w, slime] }
    s = step(s)
    expect(s.outcome).toBe('victory')
    expect(step(s)).toBe(s) // a finished battle is a no-op
  })

  it('reaches defeat when every hero dies', () => {
    const w = { ...makeWarrior([]), hp: 5, maxHp: 100 }
    const slime = { ...makeWarrior([{ state: enemyNearest, maneuver: ATTACK, label: 'a' }]), side: 'enemy' as const, id: 'enemy-1', name: 'Slime', atk: 99 }
    // Enemy acts second; warrior (empty proc) attacks, then slime one-shots it.
    let s = { ...initialState([], []), units: [w, slime] }
    s = step(s) // warrior swings
    s = step(s) // slime kills warrior
    expect(s.outcome).toBe('defeat')
  })

  it('is deterministic: identical inputs produce identical outputs', () => {
    const a = step(freshBattle())
    const b = step(freshBattle())
    expect(a).toEqual(b)
  })

  it('healing is capped at maxHp', () => {
    const me = { ...makeHealer([]), hp: 70, maxHp: 80 }
    const proc: Procedure = [{ state: { subject: { who: 'self' }, predicate: { p: 'always' } }, maneuver: CURE, label: 'cure self' }]
    const healer = { ...me, procedure: proc }
    const dummyEnemy = { ...makeWarrior([]), side: 'enemy' as const, id: 'enemy-1', name: 'E' }
    const s = step({ ...initialState([], []), units: [healer, dummyEnemy] })
    expect(s.units[0].hp).toBe(80) // 70 + 24 capped at 80, not 94
  })
})

// --- Slice 4: the counter-heal wall ----------------------------------------

describe('counter-heal — the wall reacts to restorative magic', () => {
  const cureSelf: Procedure = [
    { state: { subject: { who: 'self' }, predicate: { p: 'always' } }, maneuver: CURE, label: 'cure self' },
  ]

  function healerVsWarden(healerProc: Procedure, warden: Partial<Combatant> = {}) {
    const h = { ...makeHealer(healerProc), hp: 40 } // hurt, so a self-cure restores HP
    const boss = { ...makeWarden(), ...warden }
    return { ...initialState([], healerProc, 'warden'), units: [h, boss] }
  }

  it('a heal that restores HP draws a counter on the SAME turn (no extra turn taken)', () => {
    const s = step(healerVsWarden(cureSelf))
    const log = s.log
    expect(log.at(-2)?.kind).toBe('heal') // the cure
    expect(log.at(-1)?.kind).toBe('counter') // the punish, same turn
    expect(log.at(-1)?.turn).toBe(log.at(-2)?.turn)
    expect(s.turn).toBe(1) // the reaction did not consume a turn
    // 40 + 24 (cure) − 30 (counter) = 34
    expect(s.units[0].hp).toBe(34)
  })

  it('no counter when the heal restored nothing (a full-HP cure is a dead heal)', () => {
    const s = step(healerVsWarden(cureSelf, {}))
    // Re-run with a full-HP healer: cure restores 0, so the Warden must not react.
    const full = { ...makeHealer(cureSelf), hp: 80, maxHp: 80 }
    const boss = makeWarden()
    const s2 = step({ ...initialState([], cureSelf, 'warden'), units: [full, boss] })
    expect(s2.log.some((e) => e.kind === 'counter')).toBe(false)
    expect(s.log.some((e) => e.kind === 'counter')).toBe(true) // (the hurt-healer case still counters)
  })

  it('an Attack never draws a counter — only healing does', () => {
    const attackProc: Procedure = [{ state: { subject: { who: 'enemy', pick: 'first' }, predicate: { p: 'always' } }, maneuver: ATTACK, label: 'attack' }]
    const s = step(healerVsWarden(attackProc))
    expect(s.log.some((e) => e.kind === 'counter')).toBe(false)
  })

  it('the counter is applied before the outcome check — a lethal counter ends the battle this step', () => {
    const fragile: Combatant = { ...makeHealer(cureSelf), hp: 5, maxHp: 200 } // low; cure 5→29 (+24), counter 29→0 (−30) -> dies
    const boss = makeWarden()
    const s = step({ ...initialState([], cureSelf, 'warden'), units: [fragile, boss] })
    expect(s.units[0].hp).toBe(0)
    expect(s.outcome).toBe('defeat') // judged AFTER the counter, same step
  })

  it('the counter is side-relative: a normal slime never punishes a heal', () => {
    const slime = makeEnemy(1)
    const h = { ...makeHealer(cureSelf), hp: 40 }
    const s = step({ ...initialState([], cureSelf, 'pack'), units: [h, slime] })
    expect(s.log.some((e) => e.kind === 'counter')).toBe(false)
    expect(s.units[0].hp).toBe(64) // 40 + 24, no counter
  })

  // The done-when, encoded: SAME boss, the discriminating edit on the HEALER.
  function runToEnd(start: ReturnType<typeof initialState>, cap = 400): ReturnType<typeof initialState> {
    let s = start
    for (let i = 0; i < cap && s.outcome === 'ongoing'; i++) s = step(s)
    return s
  }

  const warriorTank: Procedure = [
    { state: { subject: { who: 'self' }, predicate: { p: 'hpPctBelow', value: 30 } }, maneuver: DEFEND, label: 'defend when low' },
    { state: { subject: { who: 'enemy', pick: 'first' }, predicate: { p: 'always' } }, maneuver: ATTACK, label: 'attack' },
  ]
  const healerCures: Procedure = [
    { state: { subject: { who: 'ally', pick: 'lowestHp' }, predicate: { p: 'hpPctBelow', value: 50 } }, maneuver: CURE, label: 'cure hurt ally' },
    { state: { subject: { who: 'enemy', pick: 'first' }, predicate: { p: 'always' } }, maneuver: ATTACK, label: 'attack' },
  ]
  const healerAttacks: Procedure = [
    { state: { subject: { who: 'enemy', pick: 'first' }, predicate: { p: 'always' } }, maneuver: ATTACK, label: 'attack' },
  ]

  it('the naive cure-when-low Procedure LOSES to the Warden', () => {
    const s = runToEnd(initialState(warriorTank, healerCures, 'warden'))
    expect(s.outcome).toBe('defeat')
  })

  it('the SAME party WINS once the Healer stops curing and joins the race', () => {
    const s = runToEnd(initialState(warriorTank, healerAttacks, 'warden'))
    expect(s.outcome).toBe('victory')
  })
})
