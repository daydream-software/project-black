import { describe, it, expect, beforeAll } from 'vitest'
import {
  startDelve, stepDelve, decideExploration, setExplorationProgramDecider,
  DEFAULT_EXPLORATION, type DelveState,
} from '../delve'
import { decideExplorationFromProgram } from './explore'
import { decideCombatFromProgram } from './combat'
import { makeWarrior, makeHealer, makeGolem, setProgramDecider, ProgramError } from '../sim'
import { setUnlocked } from './gate'
import { LEVELS } from '../levels'
import { neighbours } from '../content/exploration/navigation'

beforeAll(() => {
  setExplorationProgramDecider(decideExplorationFromProgram)
  setProgramDecider(decideCombatFromProgram)
  setUnlocked(['lang-if', 'lang-loops', 'lang-comprehensions', 'lang-def', 'lang-import', 'skill-mend'])
})

const TIER1 =
  'def exploration_turn(senses):\n' +
  '    nxt = senses.unexplored_exit\n' +
  '    if nxt:\n' +
  '        return move(nxt)\n' +
  '    return retreat()\n'

const TIER2_DFS =
  'def exploration_turn(senses):\n' +
  '    seen = Memory.setdefault("seen", set())\n' +
  '    seen.add(senses.room.sigil)\n' +
  '    for ex in senses.exits:\n' +
  '        if ex.beyond not in seen:\n' +
  '            return move(ex)\n' +
  '    return retreat()\n'

function fresh(program: string): DelveState {
  return startDelve([makeWarrior([]), makeHealer([])], 1234, DEFAULT_EXPLORATION, LEVELS[0], program)
}

describe('exploration program navigator', () => {
  it('tier-1 (unexplored_exit) steps into a neighbouring room', () => {
    const s = fresh(TIER1)
    const d = decideExploration(s)
    expect(d.reason).toBe('inscription')
    expect(neighbours(s.graph, s.pos)).toContain(d.step)
  })

  it('tier-2 DFS picks an unseen exit and records the room in Memory', () => {
    const s = fresh(TIER2_DFS)
    const d = decideExploration(s)
    expect(neighbours(s.graph, s.pos)).toContain(d.step)
    // the returned memory holds a "seen" set with the entrance sigil recorded
    const mem = JSON.stringify(d.memory)
    expect(mem).toContain('__set')
  })

  it('a code navigator drives a full delve to a terminal state (no infinite loop)', () => {
    let s = fresh(TIER2_DFS)
    for (let i = 0; i < 5000 && s.status === 'delving'; i += 1) s = stepDelve(s)
    expect(s.status).not.toBe('delving')
    expect(s.explored.length).toBeGreaterThan(1) // it actually crawled
  })

  it('a broken navigator throws ProgramError (caught at stepDelve → stuck, loud)', () => {
    const s = fresh('def wrong(senses):\n    return None\n') // no exploration_turn entry
    expect(() => decideExploration(s)).toThrow(ProgramError)
    // and a full delve with a broken navigator ends STUCK, not silently
    let d = startDelve([makeWarrior([]), makeHealer([])], 7, undefined, LEVELS[0], 'def wrong(senses):\n    return None\n')
    d = stepDelve(d)
    expect(d.status).toBe('stuck')
    expect(d.log.at(-1)?.reason).toBe('program error')
  })

  it('retreat() at the entrance WITHDRAWS (status left) instead of resting', () => {
    // the party starts at the entrance; retreat has nowhere to fall back → it leaves.
    let s = startDelve([makeWarrior([]), makeHealer([])], 1234, undefined, LEVELS[0],
      'def exploration_turn(senses):\n    return retreat()\n')
    s = stepDelve(s)
    expect(s.status).toBe('left')
    expect(s.log.at(-1)?.detail).toMatch(/withdrew/)
  })

  it('a single decent golem clears lvl-1 attack-only with the MINIMAL language', () => {
    // the progression's load-bearing claim: a fresh player (no `if`, no Mend) can clear
    // lvl-1 with `return attack(...)` + `return explore()` and earn their first Insight.
    const stats = { might: 7, ward: 1, fortitude: 10, attunement: 0, poise: 0, celerity: 3 }
    const COMBAT = 'Engram.combat_turn:\n    return attack(senses.enemies.lowest_hp)\n'
    const EXPLORE = 'Engram.exploration_turn:\n    return explore()\n'
    const tally: Record<string, number> = {}
    for (let seed = 1; seed <= 20; seed += 1) {
      const g = makeGolem({ id: 'hero-1', name: 'Solo', stats, procedure: [], program: COMBAT })
      let s = startDelve([g], seed, undefined, LEVELS[0], EXPLORE)
      for (let i = 0; i < 4000 && s.status === 'delving'; i += 1) s = stepDelve(s)
      tally[s.status] = (tally[s.status] ?? 0) + 1
    }
    expect(tally.cleared ?? 0).toBeGreaterThanOrEqual(18) // reliably clears lvl-1 attack-only
  })

  it('record(...) in an exploration brain surfaces as journal note entries', () => {
    const RECORDING =
      'Engram.exploration_turn:\n' +
      '    record("at", senses.room.sigil)\n' +
      '    return explore()\n'
    const s = fresh(RECORDING)
    const d = decideExploration(s)
    expect(d.notes?.length).toBe(1)
    expect(d.notes?.[0]).toMatch(/^at /)
    // stepping folds the recorded line into the journal as a `note` entry
    const after = stepDelve(s)
    expect(after.log.some((e) => e.kind === 'note' && e.detail.startsWith('at '))).toBe(true)
  })

  it('an explicit leave() ends the delve as left', () => {
    let s = startDelve([makeWarrior([]), makeHealer([])], 1234, undefined, LEVELS[0],
      'def exploration_turn(senses):\n    return leave()\n')
    s = stepDelve(s)
    expect(s.status).toBe('left')
  })

  // Regression: a fragile, NON-HEALING party (0 Attunement) that drops below 30% HP and
  // retreats to the entrance used to rest forever ("nothing to mend") — the tier-1 guard
  // kept firing and a 0-mend rest changes nothing. The idle-rest cap must terminate it.
  it('a no-progress rest loop ends as stuck — never rests forever', () => {
    const TIER1 = 'def exploration_turn(senses):\n    if party.hp_pct < 30:\n        return retreat()\n    nxt = senses.unexplored_exit\n    if nxt:\n        return move(nxt)\n    return retreat()\n'
    const COMBAT = 'def combat_turn(senses):\n    if me.hp_pct < 30:\n        return use(Skills.Mend, me)\n    return attack(senses.enemies.lowest_hp)\n'
    const stats = { might: 5, ward: 0, fortitude: 3, attunement: 0, poise: 0, celerity: 4 }
    const fragile = (id: string): ReturnType<typeof makeGolem> =>
      makeGolem({ id, name: id, stats, procedure: [], program: COMBAT })
    const lvl2 = LEVELS.find((l) => l.id === 'lvl-2') ?? LEVELS[0]
    let s: DelveState = startDelve([fragile('hero-1'), fragile('hero-2')], 28, undefined, lvl2, TIER1)
    let i = 0
    for (; i < 4000 && s.status === 'delving'; i += 1) s = stepDelve(s)
    expect(s.status).not.toBe('delving') // terminated (stuck/dead/cleared), not an infinite rest
    expect(i).toBeLessThan(100) // and it gave up promptly, not at the 4000 safety cap
  })
})
