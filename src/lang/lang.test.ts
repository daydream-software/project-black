import { describe, it, expect, beforeAll } from 'vitest'
import { lex } from './lexer'
import { parse } from './parser'
import { compile, Interp, baseBuiltins, type LangValue } from './interp'
import { decideCombatFromProgram } from './combat'
import { combatRowsToSource } from './migrate'
import {
  makeGolem, makeWarden, makeBattle, step, setProgramDecider,
  SENTINEL_STATS, type Combatant, type GameState, type Stats,
} from '../sim'

/** Run a single top-level `def main(...)` for the interpreter tests. */
function run(src: string, args: LangValue[]): LangValue {
  const interp = new Interp()
  return interp.run(compile(src), 'main', args, baseBuiltins(interp))
}

describe('lexer', () => {
  it('emits INDENT/DEDENT around a block', () => {
    const kinds = lex('if x:\n    y\n').map((t) => t.kind)
    expect(kinds).toContain('INDENT')
    expect(kinds).toContain('DEDENT')
  })
  it('rejects tabs for indentation', () => {
    expect(() => lex('if x:\n\ty\n')).toThrow(/tab/)
  })
})

describe('parser', () => {
  it('parses a function with an if/elif/else', () => {
    const m = parse('def f(a):\n    if a:\n        return 1\n    elif a:\n        return 2\n    else:\n        return 3\n')
    expect(m.body[0].k).toBe('func')
  })
})

describe('interpreter', () => {
  it('arithmetic + return', () => {
    expect(run('def main(x):\n    return x + 1\n', [2])).toBe(3)
  })
  it('if / comparison / boolean short-circuit', () => {
    const src = 'def main(x):\n    if x < 10 and x > 0:\n        return "ok"\n    return "no"\n'
    expect(run(src, [5])).toBe('ok')
    expect(run(src, [50])).toBe('no')
  })
  it('for-loop accumulation', () => {
    expect(run('def main(xs):\n    total = 0\n    for x in xs:\n        total = total + x\n    return total\n', [[1, 2, 3]])).toBe(6)
  })
  it('list comprehension with a filter', () => {
    expect(run('def main(xs):\n    return [x for x in xs if x > 1]\n', [[1, 2, 3]])).toEqual([2, 3])
  })
  it('dict setdefault + index', () => {
    expect(run('def main(m):\n    m.setdefault("a", 0)\n    return m["a"]\n', [new Map()])).toBe(0)
  })
  it('set add + membership', () => {
    expect(run('def main(s):\n    s.add(2)\n    return 2 in s\n', [new Set()])).toBe(true)
  })
  it('fuel overrun on an infinite loop throws', () => {
    expect(() => run('def main(x):\n    while True:\n        x = x\n    return x\n', [1])).toThrow(/budget/)
  })
  it('import exposes a library as a callable namespace', () => {
    const lib = 'def bump(x):\n    return x + 100\n'
    const interp = new Interp()
    const main = compile('import lib\ndef main(x):\n    return lib.bump(x)\n')
    expect(interp.run(main, 'main', [5], baseBuiltins(interp), { lib })).toBe(105)
  })
})

// --- Combat parity: the interpreter drives a real Decision -------------------

const ATTACK_LOWEST = 'def combat_turn(senses):\n    return attack(senses.enemies.lowest_hp)\n'
const MEND_THEN_ATTACK =
  'def combat_turn(senses):\n' +
  '    if me.hp_pct < 30:\n' +
  '        return use(Skills.Mend, me)\n' +
  '    return attack(senses.enemies.first)\n'

function hero(program: string, hp?: number): Combatant {
  const g = makeGolem({ id: 'hero-1', name: 'Sentinel', stats: SENTINEL_STATS, procedure: [], program })
  return hp === undefined ? g : { ...g, hp }
}

describe('combat program decider', () => {
  it('attacks the chosen enemy', () => {
    const h = hero(ATTACK_LOWEST)
    const d = decideCombatFromProgram(h, [h, makeWarden()])
    expect(d.maneuver).toEqual({ command: 'attack' })
    expect(d.targetId).toBe('enemy-1')
  })
  it('branches on its own HP (mend when low, else attack)', () => {
    const low = hero(MEND_THEN_ATTACK, 1)
    const lowD = decideCombatFromProgram(low, [low, makeWarden()])
    expect(lowD.maneuver).toEqual({ command: 'useSkill', skill: 'mend' })
    expect(lowD.targetId).toBe('hero-1')

    const full = hero(MEND_THEN_ATTACK)
    const fullD = decideCombatFromProgram(full, [full, makeWarden()])
    expect(fullD.maneuver).toEqual({ command: 'attack' })
  })
  it('degrades to the engine fallback on a broken program', () => {
    const h = hero('def wrong_name(senses):\n    return None\n')
    const d = decideCombatFromProgram(h, [h, makeWarden()])
    expect(d.maneuver).toEqual({ command: 'attack' })
    expect(d.targetId).toBe('enemy-1')
    expect(d.reason).toMatch(/error|attack/)
  })
  it('fuel overrun degrades to fallback, never throws', () => {
    const h = hero('def combat_turn(senses):\n    while True:\n        x = 1\n    return attack(me)\n')
    expect(() => decideCombatFromProgram(h, [h, makeWarden()])).not.toThrow()
    const d = decideCombatFromProgram(h, [h, makeWarden()])
    expect(d.maneuver).toEqual({ command: 'attack' })
  })
})

// --- The slice-4 "wall" reproduced with a CODE brain (the plan's done-when) ------
// Same Titan build + same boss as the slot-system wall (sim.test.ts), but the brain is
// a PROGRAM. The discriminating edit is deleting the mend line — exactly the in-app
// proof: with it the Warden's heal-counter wins; without it the Titan wins the DPS race.
describe('Hex Warden wall — code-brain parity', () => {
  beforeAll(() => setProgramDecider(decideCombatFromProgram))
  const TITAN: Stats = { might: 6, ward: 1, fortitude: 7, attunement: 3, poise: 0, celerity: 4 } // 21 pts
  const MENDS = 'def combat_turn(senses):\n    if me.hp_pct < 50:\n        return use(Skills.Mend, me)\n    return attack(senses.enemies.first)\n'
  const ATTACKS = 'def combat_turn(senses):\n    return attack(senses.enemies.first)\n'
  const titan = (program: string): GameState =>
    makeBattle([makeGolem({ id: 'hero-1', name: 'Titan', stats: TITAN, procedure: [], program })], 'warden')
  const runToEnd = (start: GameState): GameState => {
    let s = start
    for (let i = 0; i < 400 && s.outcome === 'ongoing'; i += 1) s = step(s)
    return s
  }

  it('the mend-when-low PROGRAM loses to the Warden (the wall)', () => {
    expect(runToEnd(titan(MENDS)).outcome).toBe('defeat')
  })
  it('the SAME build WINS once the mend line is deleted', () => {
    expect(runToEnd(titan(ATTACKS)).outcome).toBe('victory')
  })
})

// --- Slot → code migration (piste B) ----------------------------------------
describe('combatRowsToSource migration', () => {
  const rows = [
    { subjectId: 'self', predId: 'hp_lt_50', command: 'useSkill' as const, skillId: 'mend' as const, enabled: true },
    { subjectId: 'enemy_near', predId: 'always', command: 'attack' as const, skillId: 'mend' as const, enabled: true },
  ]
  it('generates source that reproduces the rows’ behaviour', () => {
    const src = combatRowsToSource(rows)
    expect(src).toContain('use(Skills.Mend, t)')
    const lowHero = { ...makeGolem({ id: 'hero-1', name: 'S', stats: SENTINEL_STATS, procedure: [], program: src }), hp: 1 }
    const lowD = decideCombatFromProgram(lowHero, [lowHero, makeWarden()])
    expect(lowD.maneuver).toEqual({ command: 'useSkill', skill: 'mend' })
    const fullHero = makeGolem({ id: 'hero-1', name: 'S', stats: SENTINEL_STATS, procedure: [], program: src })
    expect(decideCombatFromProgram(fullHero, [fullHero, makeWarden()]).maneuver).toEqual({ command: 'attack' })
  })
  it('skips disabled rows', () => {
    const src = combatRowsToSource([{ ...rows[0], enabled: false }])
    expect(src).not.toContain('Mend')
  })
})
