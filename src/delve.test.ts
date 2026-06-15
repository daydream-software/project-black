import { describe, it, expect } from 'vitest'
import { startDelve, stepDelve, DEFAULT_EXPLORATION, type ExProcedure, type DelveState } from './delve'
import { makeWarrior, makeHealer, type Combatant, type Procedure } from './sim'
import type { LevelSkeleton } from './mapgraph'
import lootRoom from './content/exploration/subjects/loot-room'
import spikeTrap from './content/exploration/traps/spike-trap'

// States reference vocab by id (the serialisable shape the sim resolves at runtime).
const attack: Procedure = [
  { state: { subject: 'enemy_near', predicate: 'always' }, maneuver: { command: 'attack' }, label: 'attack' },
]

// A party that one-shots everything, so fights never stop the delve — lets us
// test the EXPLORATION loop in isolation from combat balance.
const strongParty = (): Combatant[] => [
  { ...makeWarrior(attack), might: 100 },
  { ...makeHealer(attack), might: 100 },
]

/** Step a delve to a terminal state (or a generous cap) — the headless way to run
 *  a whole delve in a test, now that production has no batch-step helper. */
const advance = (s: DelveState, n = 5000): DelveState => {
  let r = s
  for (let i = 0; i < n && r.status === 'delving'; i += 1) r = stepDelve(r)
  return r
}

const runToEnd = (seed: number, proto: ExProcedure = DEFAULT_EXPLORATION) =>
  advance(startDelve(strongParty(), seed, proto))

describe('delve — the party crawls and hunts the objective', () => {
  it('a strong party reaches and kills the objective (status: cleared)', () => {
    for (const seed of [1, 2, 3, 7, 11, 42, 99]) {
      const end = runToEnd(seed)
      expect(end.status).toBe('cleared')
      // the boss room was entered and cleared
      expect(end.cleared.includes(end.graph.bossId)).toBe(true)
      // the journal shows exploration decisions, not just moves
      expect(end.log.some((e) => e.reason.includes('→ head toward'))).toBe(true)
      expect(end.log.some((e) => e.kind === 'enter')).toBe(true)
    }
  })

  it('always terminates within the cap — never spins', () => {
    for (let seed = 0; seed < 120; seed += 1) {
      // a normal (mortal) party so some delves end in death — still terminal
      const party: Combatant[] = [makeWarrior(attack), makeHealer(attack)]
      const end = advance(startDelve(party, seed))
      expect(end.status).not.toBe('delving')
      expect(end.turn).toBeLessThan(4000)
    }
  })

  it('is deterministic: same seed + party → identical end state', () => {
    expect(runToEnd(2024)).toEqual(runToEnd(2024))
  })

  // The DISCRIMINATING test: swapping the protocol must change behaviour — proves
  // the delve is actually driven by the rules, not a hardcoded explorer.
  it('the exploration protocol drives the delve', () => {
    const seed = 7
    // an EMPTY protocol → the party cannot decide a move → stuck at once
    const stuck = stepDelve(startDelve(strongParty(), seed, []))
    expect(stuck.status).toBe('stuck')

    // "target-only" (the beeline rule WITHOUT the explore rule): the boss is unseen at
    // the start (not adjacent to the entrance), so `target · known` never fires and the
    // party gets stuck — it can't find an unseen boss. The default (which also explores)
    // clears the same seeds. Removing the explore rule decisively changes the outcome →
    // the authored Procedure genuinely drives the delve, not a hardcoded explorer.
    const targetOnly: ExProcedure = [
      { subject: 'target', predicate: 'known', move: 'head', label: 'Target · known → head toward' },
    ]
    for (const s of [1, 2, 3, 7, 11, 42, 99, 123, 256]) {
      expect(advance(startDelve(strongParty(), s, targetOnly)).status).not.toBe('cleared')
      expect(runToEnd(s).status).toBe('cleared')
    }
  })
})

// Slice 3 — the 1-hop type peek made programmable: a Subject can target a connected
// room of a given TYPE (loot/buff), so a Procedure can route by room type.
describe('routing by room type (the peek made actionable)', () => {
  const withLoot: LevelSkeleton = {
    id: 't-loot', name: 'T', monsterPool: ['slime'], boss: 'hex-warden',
    topology: {
      slots: [{ id: 'in', type: 'entrance' }, { id: 'loot', type: 'loot' }, { id: 'boss', type: 'boss' }],
      edges: [['in', 'loot'], ['in', 'boss']],
    },
  }
  const noLoot: LevelSkeleton = {
    id: 't-noloot', name: 'T', monsterPool: ['slime'], boss: 'hex-warden',
    topology: {
      slots: [{ id: 'in', type: 'entrance' }, { id: 'f', type: 'fight' }, { id: 'boss', type: 'boss' }],
      edges: [['in', 'f'], ['f', 'boss']],
    },
  }

  it('the Loot-room subject targets a peeked, unentered loot room and routes into it', () => {
    const s = startDelve(strongParty(), 1, DEFAULT_EXPLORATION, withLoot)
    // at the entrance, the adjacent loot room is peeked (type known) but not entered
    expect(lootRoom.reachable(s)).toBe(true)
    expect(lootRoom.stepToward(s)).toBe('loot') // one hop in → loot
  })

  it('is inert when no loot room is in sight', () => {
    const s = startDelve(strongParty(), 1, DEFAULT_EXPLORATION, noLoot)
    expect(lootRoom.reachable(s)).toBe(false)
    expect(lootRoom.stepToward(s)).toBe('')
  })
})

// Slice 4 — buff rooms grant a run-scoped boon on entry: the buff is rolled from the
// level's pool, applied once, and recorded (idempotent — re-entry never re-grants).
describe('buff rooms grant a run-scoped boon', () => {
  // in → buff → boss line; the only pool buff doubles Might, so we can read it off the
  // party. The party must pass THROUGH the buff room to reach the boss.
  const surgeLine: LevelSkeleton = {
    id: 't-buff', name: 'T', monsterPool: ['slime'], boss: 'hex-warden', buffPool: ['might-surge'],
    topology: {
      slots: [{ id: 'in', type: 'entrance' }, { id: 'buff', type: 'buff' }, { id: 'boss', type: 'boss' }],
      edges: [['in', 'buff'], ['buff', 'boss']],
    },
  }

  it('collects the boon once: Might doubled (100→200, not 400), buff + room recorded', () => {
    const end = advance(startDelve(strongParty(), 1, DEFAULT_EXPLORATION, surgeLine))
    expect(end.status).toBe('cleared')
    expect(end.buffs).toContain('might-surge')
    expect(end.resolved).toContain('buff') // the room is spent → can't re-grant
    // exactly-once: a second application would read 400. The resolved gate holds even as
    // the party crosses back through on its way to the boss.
    expect(end.party.every((u) => u.might === 200)).toBe(true)
    expect(end.log.some((e) => e.kind === 'boon')).toBe(true)
  })

  it('an enemy-spawn boon (Enfeeble) folds onto future foes without breaking the delve', () => {
    const enfeebleLine: LevelSkeleton = { ...surgeLine, id: 't-enf', buffPool: ['enfeeble'] }
    const end = advance(startDelve(strongParty(), 1, DEFAULT_EXPLORATION, enfeebleLine))
    expect(end.status).toBe('cleared') // onSpawn fold ran on the boss; the delve still resolves
    expect(end.buffs).toContain('enfeeble')
  })
})

// Slice 5 — corridor traps: a trap is OWNED by a corridor and springs on the party as
// it traverses (the delve twin of a combat reaction, dispatched by id).
describe('corridor traps', () => {
  it('a spike trap hits each LIVING golem; a downed one is untouched', () => {
    const party: Combatant[] = [{ ...makeWarrior([]), hp: 30 }, { ...makeHealer([]), hp: 0 }]
    const fired = spikeTrap.trigger(party, { id: 'spike-trap', value: 5 })
    expect(fired.party[0].hp).toBe(25) // living golem −5
    expect(fired.party[1].hp).toBe(0) // already down → unchanged
    expect(fired.detail).toContain('5')
  })
})
