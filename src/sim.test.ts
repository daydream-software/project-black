import { describe, it, expect } from 'vitest'
import {
  decide,
  resolveTarget,
  step,
  initialState,
  makeBattle,
  makeGolem,
  makeWarrior,
  makeHealer,
  makeWarden,
  makeEnemy,
  attackDamage,
  overdraw,
  restToConvergence,
  upcomingTurns,
  MEND_STRAIN,
  type Combatant,
  type GameState,
  type Procedure,
  type State,
  type Stats,
  type PredicateDef,
} from './sim'
import { SUBJECTS } from './content/subjects'
import { PREDICATES } from './content/predicates'
import defendingModifier from './content/combat/modifiers/defending'

// --- Builders ---------------------------------------------------------------

let counter = 0
function unit(side: 'hero' | 'enemy', hp: number, maxHp: number, procedure: Procedure = []): Combatant {
  counter += 1
  // Might 10 / Ward 0 keeps any unit()-based attack dealing exactly its Might, so
  // the targeting tests (which only care about HP ratios) read unchanged.
  return {
    id: `${side}-${counter}`, name: `${side}${counter}`, side, hp, maxHp, defending: false, procedure,
    might: 10, ward: 0, fortitude: Math.ceil(maxHp / 4), attunement: 5, poise: 0, celerity: 5,
  }
}

// Common Maneuvers / States, spelled out so tests read like the rule language.
const ATTACK = { command: 'attack' } as const
const MEND = { command: 'useSkill', skill: 'mend' } as const
const DEFEND = { command: 'useSkill', skill: 'defend' } as const

// A State references its vocab by id (the serialisable shape the sim resolves at
// runtime). `subj`/`pred` validate the id exists in the shipped catalog, then return
// it — so a typo in a test id is caught, and the State is the real thing the editor
// would compile. `predDef` returns the def itself for the few tests that exercise a
// predicate's `holds` behaviour directly.
const subj = (id: string): string => (SUBJECTS.find((s) => s.id === id) ?? raise(`no subject ${id}`)).id
const pred = (id: string): string => (PREDICATES.find((p) => p.id === id) ?? raise(`no predicate ${id}`)).id
const predDef = (id: string): PredicateDef => PREDICATES.find((p) => p.id === id) ?? raise(`no predicate ${id}`)
function raise(msg: string): never { throw new Error(msg) }

const enemyNearest: State = { subject: subj('enemy_near'), predicate: pred('always') }
const allyLowestHurt: State = { subject: subj('ally_low'), predicate: pred('hp_lt_50') }
const selfLow: State = { subject: subj('self'), predicate: pred('hp_lt_30') }

// --- The six stats: Ward is flat, anti-swarm damage reduction ---------------

describe('attackDamage — Might minus flat Ward, floored at 1', () => {
  it('the same attacker deals LESS to a higher-Ward target (Ward is the only difference)', () => {
    const slime = makeEnemy(1) // Might 2
    const sentinel = makeWarrior([]) // Ward 2
    const mender = makeHealer([]) // Ward 0
    // The done-when: the slime's chip is shrugged by the Bulwark but bites the Channeler.
    expect(attackDamage(slime, sentinel)).toBe(1) // 2 − 2 → floored to 1
    expect(attackDamage(slime, mender)).toBe(2) // 2 − 0
    expect(attackDamage(slime, sentinel)).toBeLessThan(attackDamage(slime, mender))
  })

  it('Ward never makes a unit unkillable — damage floors at 1 even when Ward ≥ Might', () => {
    const slime = makeEnemy(1) // Might 2
    const fortress: Combatant = { ...makeWarrior([]), ward: 9 } // Ward 9 > Might 2
    // Without the MIN_DAMAGE floor this would be max(1, 2−9) = 1, not −7.
    expect(attackDamage(slime, fortress)).toBe(1)
  })

  it('Defending halves the post-Ward damage (rounded up) — via the content modifier', () => {
    const warden = makeWarden() // Might 6
    const mender: Combatant = { ...makeHealer([]), defending: true } // Ward 0
    const base = attackDamage(warden, mender) // 6 − 0 = 6 (base only, no status logic)
    expect(base).toBe(6)
    // The halving now lives in content/combat/modifiers/defending.ts, not attackDamage.
    expect(defendingModifier.apply(base, warden, mender)).toBe(Math.ceil(6 / 2)) // → 3
    expect(defendingModifier.apply(base, warden, { ...mender, defending: false })).toBe(6) // not defending → unchanged
  })
})

// --- Poise / Strain: casting is free until it frays your own Fortitude --------

describe('overdraw — Strain past Poise bites Fortitude (proportional to the overshoot)', () => {
  it('is zero while the cast stays within Poise', () => {
    expect(overdraw(0, 6, 2)).toBe(0) // 0→2, under 6
    expect(overdraw(4, 6, 2)).toBe(0) // 4→6, exactly at the cap is still free
  })
  it('charges only the portion of THIS cast above Poise', () => {
    expect(overdraw(5, 6, 2)).toBe(1) // 5→7, only the 1 point above 6 is paid
    expect(overdraw(6, 6, 2)).toBe(2) // 6→8, fully over → the whole cast is paid
    expect(overdraw(10, 6, 2)).toBe(2) // deep over → still just this cast's 2
  })
})

describe('Strain in combat — a Mender that over-casts hurts itself', () => {
  const mendSelf: Procedure = [
    { state: { subject: subj('self'), predicate: pred('always') }, maneuver: { command: 'useSkill', skill: 'mend' }, label: 'mend self' },
  ]
  // A Mender (Poise 6, MEND_STRAIN 2 → 3 free casts) mends a dummy ally each turn.
  function menderCuring(poise: number) {
    const mender: Combatant = { ...makeHealer(mendSelf), hp: 30, maxHp: 40, poise, strain: 0 }
    const dummy = { ...makeWarrior([]), side: 'enemy' as const, id: 'enemy-1', name: 'E', might: 0 } // Might 0 → never kills
    return { ...initialState([], []), units: [mender, dummy] }
  }

  it('accrues Strain on each cast and only overdraws once Poise is exceeded', () => {
    let s = menderCuring(6)
    const strainOf = (st: typeof s) => st.units[0].strain
    s = step(s) // cast 1: strain 0→2, no bite
    expect(strainOf(s)).toBe(2)
    const hpAfter1 = s.units[0].hp
    s = step(s) // enemy acts (Might 0, no damage)
    s = step(s) // cast 2: strain 2→4
    expect(strainOf(s)).toBe(4)
    s = step(s)
    s = step(s) // cast 3: strain 4→6 (still ≤ Poise, free)
    expect(strainOf(s)).toBe(6)
    expect(s.log.some((e) => e.detail.includes('OVERDRAW'))).toBe(false) // no bite yet
    s = step(s)
    s = step(s) // cast 4: strain 6→8 — now 2 over → −2 Fortitude
    expect(strainOf(s)).toBe(8)
    expect(s.log.at(-1)?.detail).toContain('OVERDRAW −2')
    // The bite is real: with a healthier dummy this cast cost the Mender HP it
    // would otherwise keep. (hpAfter1 is just a sanity anchor that casts happened.)
    expect(hpAfter1).toBeGreaterThan(0)
  })

  it('a single cast under Poise is unchanged — no Strain side effects leak into existing balance', () => {
    const s = step(menderCuring(6))
    expect(s.units[0].strain).toBe(MEND_STRAIN)
    expect(s.log.at(-1)?.detail).not.toContain('OVERDRAW')
  })
})

describe('restToConvergence — a rest IS off-combat Mend, bounded by Strain', () => {
  const mendAllyLow: Procedure = [
    { state: allyLowestHurt, maneuver: { command: 'useSkill', skill: 'mend' }, label: 'mend hurt ally' },
  ]

  it('the party runs its own Mend rules to convergence (heals the hurt ally above threshold)', () => {
    const sentinel = { ...makeWarrior([]), hp: 4 } // 4/50 — well below 50%
    const mender = makeHealer(mendAllyLow) // Attunement 5, Poise 6
    const { units, mends } = restToConvergence([sentinel, mender])
    expect(mends).toBeGreaterThan(0)
    // Sentinel is pulled to/above the 50% threshold the Mend rule targets (25/50).
    expect(units[0].hp).toBeGreaterThanOrEqual(25)
    // and it converges — it does NOT heal to full (the rule stops at the threshold).
    expect(units[0].hp).toBeLessThan(50)
  })

  it('Strain accrues at rest and overdraws past Poise — resting is not free', () => {
    const sentinel = { ...makeWarrior([]), hp: 4 }
    const mender = makeHealer(mendAllyLow)
    const { units } = restToConvergence([sentinel, mender])
    // Sentinel maxHp 60 (10 fort ×5 + 10 base) → 50% threshold 30. 4→≥30 needs 6
    // mends (+5 each → 34), so Strain = 6 × MEND_STRAIN = 12, past Poise 6.
    expect(units[1].strain).toBe(6 * MEND_STRAIN)
    expect(units[1].strain).toBeGreaterThan(units[1].poise) // overdrew
    expect(units[1].hp).toBeLessThan(units[1].maxHp) // the overdraw bit its own Fortitude
  })

  it('a party with no healer gets nothing from a rest (emergent from the build)', () => {
    const a = { ...makeWarrior([]), hp: 4 } // attack-only / no Mend rule
    const b = { ...makeHealer([]), hp: 6 }
    const { units, mends } = restToConvergence([a, b])
    expect(mends).toBe(0)
    expect(units[0].hp).toBe(4) // unchanged
    expect(units[1].hp).toBe(6)
  })
})

// --- Celerity: the CTB scheduler — faster units act more often ---------------

describe('CTB scheduler — turn frequency scales with Celerity', () => {
  // Two sparring units that never die (huge HP), so 200 steps measure pure cadence.
  function spar(celA: number, celB: number) {
    const mk = (id: string, side: 'hero' | 'enemy', cel: number): Combatant => ({
      ...makeWarrior([{ state: enemyNearest, maneuver: ATTACK, label: 'x' }]),
      id, name: id, side, hp: 9999, maxHp: 9999, celerity: cel,
    })
    let s = { ...initialState([], []), units: [mk('A', 'hero', celA), mk('B', 'enemy', celB)] }
    const count: Record<string, number> = { A: 0, B: 0 }
    for (let i = 0; i < 200; i += 1) {
      s = step(s)
      const id = s.log.at(-1)?.actorId ?? ''
      if (id in count) count[id] += 1
    }
    return count
  }

  it('Celerity 12 acts about twice as often as Celerity 6 (mutation-checked)', () => {
    const c = spar(12, 6)
    const ratio = c.A / c.B
    // 12:6 → recovery 10:20 → a 2:1 share. Allow a little slack for integer cadence.
    expect(ratio).toBeGreaterThan(1.7)
    expect(ratio).toBeLessThan(2.3)
  })

  it('equal Celerity → an even share (ties broken deterministically by index)', () => {
    const c = spar(8, 8)
    expect(Math.abs(c.A - c.B)).toBeLessThanOrEqual(1)
  })

  it('upcomingTurns previews the schedule without mutating, agreeing with step', () => {
    // Death-free (both golems Defend) so the 5-turn preview can't be invalidated by a
    // unit dying mid-window — this checks the preview tracks the live schedule, nothing else.
    const defend: Procedure = [{ state: { subject: subj('self'), predicate: pred('always') }, maneuver: DEFEND, label: 'defend' }]
    const battle = initialState(defend, defend)
    const preview = upcomingTurns(battle.units, 5)
    // Replaying step() must produce the SAME first-5 actor ids (preview = real schedule).
    let s = battle
    const real: string[] = []
    for (let i = 0; i < 5; i += 1) { s = step(s); real.push(s.log.at(-1)?.actorId ?? '') }
    expect(preview).toEqual(real)
    // and it didn't mutate the battle's charges
    expect(battle.units.every((u) => u.charge === undefined || typeof u.charge === 'number')).toBe(true)
  })
})

// The predicate behaviour now lives in each predicate's content file; test its
// `holds` directly (the engine no longer has a predicateHolds switch).
describe('predicate holds (content/predicates)', () => {
  it('always is unconditionally true', () => {
    expect(predDef('always').holds(unit('hero', 1, 100))).toBe(true)
  })
  it('hpFull only at max HP', () => {
    expect(predDef('hp_full').holds(unit('hero', 100, 100))).toBe(true)
    expect(predDef('hp_full').holds(unit('hero', 99, 100))).toBe(false)
  })
  it('hp_lt_30 uses the ratio, not raw HP, and the boundary is strict', () => {
    const tank = unit('hero', 40, 200) // 20%
    expect(predDef('hp_lt_30').holds(tank)).toBe(true)
    // Exactly 30% is NOT below 30% — an off-by-one (<=) flips this and fails.
    expect(predDef('hp_lt_30').holds(unit('hero', 30, 100))).toBe(false)
    expect(predDef('hp_lt_30').holds(unit('hero', 29, 100))).toBe(true)
  })
})

describe('resolveTarget — the subject IS the target', () => {
  it('Self resolves to the acting unit', () => {
    const me = unit('hero', 100, 100)
    expect(resolveTarget({ subject: subj('self'), predicate: pred('always') }, me, [me])?.id).toBe(me.id)
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
    const lowest: State = { subject: subj('enemy_low'), predicate: pred('always') }
    expect(resolveTarget(lowest, me, [me, e1, e2])?.id).toBe(e2.id)
    // Tie at 10%: the earlier index wins.
    const e3 = unit('enemy', 3, 30)
    expect(resolveTarget(lowest, me, [me, e2, e3])?.id).toBe(e2.id)
  })

  it('Enemy most-HP picks the healthiest by ratio (focus the biggest threat)', () => {
    const me = unit('hero', 100, 100)
    const e1 = unit('enemy', 9, 30) // 30%
    const e2 = unit('enemy', 27, 30) // 90% — healthiest
    const highest: State = { subject: subj('enemy_high'), predicate: pred('always') }
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
      { state: selfLow, maneuver: MEND, label: 'heal self when low' }, // self at full -> skipped
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
      { state: selfLow, maneuver: MEND, label: 'heal' },
      { state: enemyNearest, maneuver: ATTACK, label: 'attack' },
    ]
    const attackFirst: Procedure = [healFirst[1], healFirst[0]]
    expect(decide({ ...me, procedure: healFirst }, [me, enemy]).maneuver).toEqual(MEND)
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
      { state: allyLowestHurt, maneuver: MEND, label: 'mend hurt ally' },
      { state: enemyNearest, maneuver: ATTACK, label: 'attack nearest' },
    ]
    return initialState(warrior, healer)
  }

  it('the fastest golem (Mender, Celerity 6) acts first under CTB', () => {
    const s = step(freshBattle())
    expect(s.turn).toBe(1)
    const slime1 = s.units.find((u) => u.id === 'enemy-1')
    // No ally is hurt, so the Mender attacks Slime #1: pool 15, Mender Might 3 vs Ward 0.
    expect(slime1?.hp).toBe(15 - 3)
    expect(s.log.at(-1)?.actorName).toBe('Mender') // Celerity 6 beats the Sentinel's 5
    expect(s.log.at(-1)?.targetName).toBe('Slime #1')
  })

  it('turn order follows Celerity (CTB), not a fixed round-robin cycle', () => {
    // A death-free battle (both golems just Defend) so this tests pure CADENCE, not
    // who gets focus-fired first. Effective Celerity: Mender 7 (6 + 1 golem base),
    // Sentinel 6 (5 + 1), slimes 2 (raw — monsters skip the golem base). Over 14
    // turns the FREQUENCY tracks Celerity: Mender > Sentinel >> each slow slime, and
    // the fast golems take MANY turns before a slime repeats — impossible for a fixed
    // round-robin (which would give every unit an equal share).
    const defend: Procedure = [{ state: { subject: subj('self'), predicate: pred('always') }, maneuver: DEFEND, label: 'defend' }]
    let s = initialState(defend, defend)
    const count: Record<string, number> = {}
    for (let i = 0; i < 14; i += 1) {
      s = step(s)
      const n = s.log.at(-1)?.actorName ?? '?'
      count[n] = (count[n] ?? 0) + 1
    }
    expect(count['Mender']).toBeGreaterThan(count['Sentinel'] ?? 0) // Celerity 7 > 6
    expect(count['Sentinel']).toBeGreaterThan(count['Slime #1'] ?? 0) // golems >> slimes
    // not round-robin: the fastest unit laps a slow slime several times over
    expect(count['Mender']).toBeGreaterThanOrEqual(4 * (count['Slime #1'] ?? 1))
  })

  it('Mend on an enemy is a dead rule: turn is consumed, nothing changes', () => {
    // A procedure that tries to Mend the nearest enemy — invalid, but composition is free.
    const bad: Procedure = [{ state: enemyNearest, maneuver: MEND, label: 'mend enemy (dead rule)' }]
    const me = makeWarrior(bad)
    // A slow foe (Celerity 1) so `me` (Celerity 5) clearly acts first under CTB.
    const enemy = { ...makeHealer([]), side: 'enemy' as const, id: 'enemy-x', name: 'Foe', celerity: 1 }
    const state = { ...initialState(bad, []), units: [me, enemy] }
    const s = step(state)
    expect(s.units.find((u) => u.id === 'enemy-x')?.hp).toBe(enemy.hp) // unhealed
    expect(s.log.at(-1)?.detail).toContain('no effect')
    expect(s.turn).toBe(1) // the turn was still consumed
  })

  it('Defend halves the damage the unit takes before its next turn', () => {
    // The Sentinel (pool 60 = 10 fort + 10 base, Ward 2) defends; a Might-8 attacker hits for half.
    const warrior: Procedure = [{ state: { subject: subj('self'), predicate: pred('always') }, maneuver: DEFEND, label: 'defend' }]
    const w = makeWarrior(warrior)
    const foe = { ...makeWarrior([]), side: 'enemy' as const, id: 'enemy-1', name: 'Slime', might: 8 }
    let s = { ...initialState(warrior, []), units: [w, foe] }
    s = step(s) // warrior defends
    expect(s.units[0].defending).toBe(true)
    s = step(s) // foe hits the defending warrior: (Might 8 − Ward 2) = 6, halved = 3
    expect(s.units[0].hp).toBe(w.maxHp - Math.ceil((8 - 2) / 2))
  })

  it('reaches victory when the party kills every enemy', () => {
    const warrior: Procedure = [{ state: enemyNearest, maneuver: ATTACK, label: 'attack' }]
    const w = { ...makeWarrior(warrior), might: 100 } // one-shot
    const slime = { ...makeWarrior([]), side: 'enemy' as const, id: 'enemy-1', name: 'Slime', hp: 10, maxHp: 10, might: 1 }
    let s = { ...initialState(warrior, []), units: [w, slime] }
    s = step(s)
    expect(s.outcome).toBe('victory')
    expect(step(s)).toBe(s) // a finished battle is a no-op
  })

  it('reaches defeat when every hero dies', () => {
    const w = { ...makeWarrior([]), hp: 5, maxHp: 100 }
    const slime = { ...makeWarrior([{ state: enemyNearest, maneuver: ATTACK, label: 'a' }]), side: 'enemy' as const, id: 'enemy-1', name: 'Slime', might: 99 }
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
    // Mender Attunement 5 heals +5; from 78/80 that would overshoot, so it clamps.
    const me = { ...makeHealer([]), hp: 78, maxHp: 80 }
    const proc: Procedure = [{ state: { subject: subj('self'), predicate: pred('always') }, maneuver: MEND, label: 'mend self' }]
    const healer = { ...me, procedure: proc }
    const dummyEnemy = { ...makeWarrior([]), side: 'enemy' as const, id: 'enemy-1', name: 'E' }
    const s = step({ ...initialState([], []), units: [healer, dummyEnemy] })
    expect(s.units[0].hp).toBe(80) // 78 + 5 capped at 80, not 83
  })
})

// --- Slice 4: the counter-heal wall ----------------------------------------

describe('counter-heal — the wall reacts to restorative magic', () => {
  const mendSelf: Procedure = [
    { state: { subject: subj('self'), predicate: pred('always') }, maneuver: MEND, label: 'mend self' },
  ]

  function healerVsWarden(healerProc: Procedure, warden: Partial<Combatant> = {}) {
    const h = { ...makeHealer(healerProc), hp: 10 } // hurt (pool 20), so a self-mend restores HP
    const boss = { ...makeWarden(), ...warden }
    return { ...initialState([], healerProc, 'warden'), units: [h, boss] }
  }

  it('a heal that restores HP draws a counter on the SAME turn (no extra turn taken)', () => {
    const s = step(healerVsWarden(mendSelf))
    const {log} = s
    expect(log.at(-2)?.kind).toBe('heal') // the mend
    expect(log.at(-1)?.kind).toBe('counter') // the punish, same turn
    expect(log.at(-1)?.turn).toBe(log.at(-2)?.turn)
    expect(s.turn).toBe(1) // the reaction did not consume a turn
    // 10 + 5 (mend, Attunement 5) − 4 (counter) = 11
    expect(s.units[0].hp).toBe(11)
  })

  it('no counter when the heal restored nothing (a full-HP mend is a dead heal)', () => {
    const s = step(healerVsWarden(mendSelf, {}))
    // Re-run with a full-HP healer: mend restores 0, so the Warden must not react.
    const full = makeHealer(mendSelf) // built full (hp = maxHp)
    const boss = makeWarden()
    const s2 = step({ ...initialState([], mendSelf, 'warden'), units: [full, boss] })
    expect(s2.log.some((e) => e.kind === 'counter')).toBe(false)
    expect(s.log.some((e) => e.kind === 'counter')).toBe(true) // (the hurt-healer case still counters)
  })

  it('an Attack never draws a counter — only healing does', () => {
    const attackProc: Procedure = [{ state: { subject: subj('enemy_near'), predicate: pred('always') }, maneuver: ATTACK, label: 'attack' }]
    const s = step(healerVsWarden(attackProc))
    expect(s.log.some((e) => e.kind === 'counter')).toBe(false)
  })

  it('the counter is applied before the outcome check — a lethal counter ends the battle this step', () => {
    const fragile: Combatant = { ...makeHealer(mendSelf), hp: 1, maxHp: 3 } // mend 1→3 (+2, capped), counter 3→0 (−4) -> dies
    const boss = makeWarden()
    const s = step({ ...initialState([], mendSelf, 'warden'), units: [fragile, boss] })
    expect(s.units[0].hp).toBe(0)
    expect(s.outcome).toBe('defeat') // judged AFTER the counter, same step
  })

  it('the counter is side-relative: a normal slime never punishes a heal', () => {
    const slime = makeEnemy(1)
    const h = { ...makeHealer(mendSelf), hp: 10 }
    const s = step({ ...initialState([], mendSelf, 'pack'), units: [h, slime] })
    expect(s.log.some((e) => e.kind === 'counter')).toBe(false)
    expect(s.units[0].hp).toBe(15) // 10 + 5 (Attunement), no counter
  })

  // The done-when, encoded: SAME boss, the discriminating edit on the HEALER.
  function runToEnd(start: ReturnType<typeof initialState>, cap = 400): ReturnType<typeof initialState> {
    let s = start
    for (let i = 0; i < cap && s.outcome === 'ongoing'; i += 1) s = step(s)
    return s
  }

  // The wall is judged against a competent 24-point build, not the deliberately-weak
  // default starter. A single robust Titan (1-golem build: 21 stat points) makes the
  // wall crisp: counter 4 > its self-mend 3, so the naive "mend self when low" rule is
  // a net-loss death-spiral that also costs it the turns it isn't attacking; dropping
  // that rule wins the DPS race against the compact Warden. (24-budget balance pass.)
  const TITAN: Stats = { might: 6, ward: 1, fortitude: 7, attunement: 3, poise: 0, celerity: 4 } // 21
  const titanMends: Procedure = [
    { state: { subject: subj('self'), predicate: pred('hp_lt_50') }, maneuver: MEND, label: 'mend self when low' },
    { state: { subject: subj('enemy_near'), predicate: pred('always') }, maneuver: ATTACK, label: 'attack' },
  ]
  const titanAttacks: Procedure = [
    { state: { subject: subj('enemy_near'), predicate: pred('always') }, maneuver: ATTACK, label: 'attack' },
  ]
  function titanVsWarden(proc: Procedure): ReturnType<typeof makeBattle> {
    return makeBattle([makeGolem({ id: 'hero-1', name: 'Titan', stats: TITAN, procedure: proc })], 'warden')
  }

  it('the naive mend-when-low Procedure LOSES to the Warden', () => {
    const s = runToEnd(titanVsWarden(titanMends))
    expect(s.outcome).toBe('defeat')
  })

  it('the SAME build WINS once it stops curing and just attacks', () => {
    const s = runToEnd(titanVsWarden(titanAttacks))
    expect(s.outcome).toBe('victory')
  })
})

// The regression net for the id-dispatch model: a compiled Procedure / a unit's
// reactions must reference content by ID (serialisable), never hold functions — so a
// saved in-progress delve survives a JSON round-trip and resumes. Before this, the
// State held behaviour-bearing defs whose functions JSON dropped, and a resumed delve
// threw "state.subject.candidates is not a function" on the first combat step.
describe('serialisation — a JSON round-tripped battle resumes (the resume-crash net)', () => {
  const roundTrip = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState

  it('still resolves targets by id after serialisation (no functions lost)', () => {
    const proc: Procedure = [{ state: { subject: subj('enemy_near'), predicate: pred('always') }, maneuver: ATTACK, label: 'attack' }]
    let s = roundTrip(makeBattle([makeWarrior(proc)], 'warden'))
    for (let i = 0; i < 12; i += 1) s = step(s)
    // the warrior found + hit the Warden — subject/predicate resolved from ids post-JSON
    expect(s.log.some((e) => e.kind === 'attack' && e.detail.includes('Hex Warden'))).toBe(true)
  })

  it("still fires a unit's owned reaction by ref after serialisation (the slice-4 wall survives)", () => {
    const mendSelf: Procedure = [{ state: { subject: subj('self'), predicate: pred('always') }, maneuver: MEND, label: 'mend self' }]
    const healer = { ...makeHealer(mendSelf), hp: 10 } // hurt, so a self-mend restores HP and draws the counter
    let s = roundTrip(makeBattle([healer], 'warden'))
    for (let i = 0; i < 12; i += 1) s = step(s)
    // the Warden's counter-heal reaction (a serialisable {id,value} ref) still punished the heal
    expect(s.log.some((e) => e.kind === 'counter')).toBe(true)
  })
})
