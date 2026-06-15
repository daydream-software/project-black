import { describe, it, expect } from 'vitest'
import { startDelve, stepDelve, DEFAULT_EXPLORATION, type ExProcedure, type DelveState } from './delve'
import { makeWarrior, makeHealer, type Combatant, type Procedure } from './sim'

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
      // the objective room was entered and cleared
      expect(end.clearedRooms[end.dungeon.objectiveRoomId]).toBe(true)
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

    // "explore-only" (no beeline-to-target rule) still clears (the frontier walks
    // into every room, the objective included) but never FEWER steps than the
    // default, which beelines as soon as the objective is seen — and strictly
    // more on at least one seed. That proves the target rule changes navigation.
    const exploreOnly: ExProcedure = [
      { subject: 'unexplored', predicate: 'always', move: 'head', label: 'Unexplored · Always → head toward' },
    ]
    let strictlyFasterSomewhere = false
    for (const s of [1, 2, 3, 7, 11, 42, 99, 123, 256]) {
      const def = runToEnd(s)
      const slow = runToEnd(s, exploreOnly)
      expect(def.status).toBe('cleared')
      expect(slow.status).toBe('cleared')
      expect(def.turn).toBeLessThanOrEqual(slow.turn) // beelining is never worse
      if (def.turn < slow.turn) strictlyFasterSomewhere = true
    }
    expect(strictlyFasterSomewhere).toBe(true)
  })
})
