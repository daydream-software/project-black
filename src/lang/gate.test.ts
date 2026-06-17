import { describe, it, expect } from 'vitest'
import { parse } from './parser'
import { checkGates } from './gate'

const NONE = new Set<string>()
const ALL = new Set(['lang-if', 'lang-loops', 'lang-comprehensions', 'lang-def', 'lang-import'])

describe('feature gate', () => {
  it('passes the minimal language with NOTHING unlocked', () => {
    const m = parse('Engram.combat_turn:\n    return attack(senses.enemies.first)\n')
    expect(checkGates(m, NONE).ok).toBe(true)
  })

  it('locks `if`, and a lang-if unlock opens it (mutation-check)', () => {
    const m = parse('Engram.combat_turn:\n    if me.hp_pct < 30:\n        return flee()\n    return attack(senses.enemies.first)\n')
    expect(checkGates(m, NONE).ok).toBe(false)
    expect(checkGates(m, NONE).message).toMatch(/locked/u)
    expect(checkGates(m, new Set(['lang-if'])).ok).toBe(true)
  })

  it('locks loops / def / import / comprehensions, each by its own id', () => {
    expect(checkGates(parse('Engram.combat_turn:\n    for e in senses.enemies:\n        return attack(e)\n'), NONE).message).toMatch(/loop/iu)
    expect(checkGates(parse('def f():\n    return 1\nEngram.combat_turn:\n    return attack(senses.enemies.first)\n'), NONE).message).toMatch(/def/iu)
    expect(checkGates(parse('import lib\nEngram.combat_turn:\n    return attack(senses.enemies.first)\n'), NONE).message).toMatch(/import/iu)
    expect(checkGates(parse('Engram.combat_turn:\n    xs = [e for e in senses.enemies]\n    return attack(senses.enemies.first)\n'), NONE).message).toMatch(/comprehension/iu)
    // ...all pass once everything is unlocked
    expect(checkGates(parse('Engram.combat_turn:\n    for e in senses.enemies:\n        return attack(e)\n'), ALL).ok).toBe(true)
  })

  it('catches a construct nested inside an allowed one (if inside a loop)', () => {
    const m = parse('Engram.combat_turn:\n    for e in senses.enemies:\n        if me.hp_pct < 30:\n            return flee()\n    return attack(senses.enemies.first)\n')
    expect(checkGates(m, new Set(['lang-loops'])).ok).toBe(false) // loop allowed, the nested if isn't
    expect(checkGates(m, new Set(['lang-loops', 'lang-if'])).ok).toBe(true)
  })

  it('reports the line of the locked construct', () => {
    const r = checkGates(parse('Engram.combat_turn:\n    if me.hp_pct < 30:\n        return flee()\n'), NONE)
    expect(r.line).toBe(2)
  })
})
