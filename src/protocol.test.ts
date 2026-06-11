import { describe, it, expect } from 'vitest'
import { DEFAULT_EXPLORATION } from './delve'
import {
  buildExploration,
  exRowToProtocol,
  exRowResolves,
  DEFAULT_EX_ROWS,
  EX_SUBJECTS,
  EX_PREDICATES,
  EX_MOVES,
  procedureFor,
  rowToProtocol,
  rowResolves,
  commandById,
  SUBJECTS,
  PREDICATES,
  COMMANDS,
  SKILLS,
  byId,
  available,
  type Option,
} from './protocol'
import type { ExProtocolRow, Hero, ProtocolRow } from './save'

describe('protocol — exploration rule compiler', () => {
  it('compiles the default editor rows into exactly DEFAULT_EXPLORATION', () => {
    // The town editor's starting rows must reproduce the hardcoded delve default,
    // bit for bit (subject/predicate/move AND the journal label) — so the two
    // can never silently drift. Flip any id in DEFAULT_EX_ROWS and this goes red.
    expect(buildExploration(DEFAULT_EX_ROWS)).toEqual(DEFAULT_EXPLORATION)
  })

  it('drops disabled rows and preserves priority order', () => {
    const rows: ExProtocolRow[] = [
      { subjectId: 'exit', predId: 'php_lt_30', moveId: 'retreat', enabled: true },
      { subjectId: 'unexplored', predId: 'always', moveId: 'head', enabled: false },
      { subjectId: 'target', predId: 'known', moveId: 'head', enabled: true },
    ]
    const compiled = buildExploration(rows)
    expect(compiled).toHaveLength(2) // the disabled middle row is gone
    expect(compiled[0].label).toBe('Exit · party HP < 30% → retreat') // order kept
    expect(compiled[1].label).toBe('Target · known → head toward')
  })

  it('an all-disabled procedure compiles to an empty list (the delve will get stuck)', () => {
    const rows = DEFAULT_EX_ROWS.map((r) => ({ ...r, enabled: false }))
    expect(buildExploration(rows)).toEqual([])
  })

  it('maps each dropdown id to the right model value', () => {
    const rule = exRowToProtocol({ subjectId: 'exit', predId: 'php_lt_50', moveId: 'rest', enabled: true })
    expect(rule.subject).toEqual({ what: 'exit' })
    expect(rule.predicate).toEqual({ p: 'partyHpPctBelow', value: 50 })
    expect(rule.move).toBe('rest')
  })

  it('every catalog option has a unique id (ids are the persisted, round-tripped key)', () => {
    for (const cat of [EX_SUBJECTS, EX_PREDICATES, EX_MOVES]) {
      const ids = cat.map((o) => o.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('byId throws on an unknown id (a corrupt/stale row must not pass silently)', () => {
    expect(() => byId(EX_MOVES, 'teleport')).toThrow(/Unknown option/)
  })

  it('available() offers always-on options + unlocked ones, hides locked-unowned (10b gating)', () => {
    const opts: Option<number>[] = [
      { id: 'a', label: 'A', make: () => 1 }, // always available
      { id: 'b', label: 'B', make: () => 2, unlock: 'buy-b' }, // locked
    ]
    expect(available(opts, []).map((o) => o.id)).toEqual(['a']) // locked one hidden
    expect(available(opts, ['buy-b']).map((o) => o.id)).toEqual(['a', 'b']) // purchased → offered
    // byId still resolves a locked id (an already-authored rule must keep working)
    expect(byId(opts, 'b').label).toBe('B')
  })

  it('drops an exploration row whose id no longer resolves instead of throwing', () => {
    // A save authored before the vocabulary churned: 'sprint' is not an EX_MOVES id.
    const rows: ExProtocolRow[] = [
      { subjectId: 'target', predId: 'known', moveId: 'head', enabled: true },
      { subjectId: 'unexplored', predId: 'always', moveId: 'sprint', enabled: true }, // stale move
    ]
    expect(exRowResolves(rows[1])).toBe(false)
    const compiled = buildExploration(rows)
    expect(compiled).toHaveLength(1) // the stale row is skipped, the good one survives
    expect(compiled[0].label).toBe('Target · known → head toward')
  })
})

describe('protocol — combat rule compiler', () => {
  const hero = (rows: ProtocolRow[]): Hero => ({ simId: 'hero-1', name: 'Test', rows })

  it('compiles a hero’s enabled rows into Protocols, in priority order, with labels', () => {
    const h = hero([
      { subjectId: 'self', predId: 'hp_lt_30', command: 'useSkill', skillId: 'defend', enabled: true },
      { subjectId: 'enemy_near', predId: 'always', command: 'attack', skillId: 'cure', enabled: true },
    ])
    const proc = procedureFor(h)
    expect(proc).toHaveLength(2)
    expect(proc[0].label).toBe('Self · HP < 30% → Use Skill · Defend')
    expect(proc[1].label).toBe('Enemy · near · Always → Attack')
    expect(proc[0].state).toEqual({ subject: { who: 'self' }, predicate: { p: 'hpPctBelow', value: 30 } })
    expect(proc[0].maneuver).toEqual({ command: 'useSkill', skill: 'defend' })
    expect(proc[1].maneuver).toEqual({ command: 'attack' })
  })

  it('drops disabled rows and preserves priority order', () => {
    const h = hero([
      { subjectId: 'enemy_low', predId: 'always', command: 'attack', skillId: 'cure', enabled: false },
      { subjectId: 'self', predId: 'hp_full', command: 'flee', skillId: 'cure', enabled: true },
    ])
    const proc = procedureFor(h)
    expect(proc).toHaveLength(1)
    expect(proc[0].maneuver).toEqual({ command: 'flee' })
  })

  it('drops a row whose State id no longer resolves instead of throwing (stale save)', () => {
    // The brick path the defensive compile fixes: an old save with a renamed id
    // must field a party, not crash enterGame. 'enemy_biggest' is not a SUBJECTS id.
    const h = hero([
      { subjectId: 'enemy_biggest', predId: 'always', command: 'attack', skillId: 'cure', enabled: true }, // stale
      { subjectId: 'enemy_near', predId: 'always', command: 'attack', skillId: 'cure', enabled: true },
    ])
    expect(rowResolves(h.rows[0])).toBe(false)
    const proc = procedureFor(h)
    expect(proc).toHaveLength(1) // the stale row is gone, the valid one remains
    expect(proc[0].state.subject).toEqual({ who: 'enemy', pick: 'first' })
  })

  it('rowToProtocol maps each dropdown id to the right model value', () => {
    const p = rowToProtocol({ subjectId: 'ally_low', predId: 'hp_lt_50', command: 'useSkill', skillId: 'cure', enabled: true })
    expect(p.state.subject).toEqual({ who: 'ally', pick: 'lowestHp' })
    expect(p.state.predicate).toEqual({ p: 'hpPctBelow', value: 50 })
    expect(p.maneuver).toEqual({ command: 'useSkill', skill: 'cure' })
  })

  it('every combat catalog option has a unique id', () => {
    for (const cat of [SUBJECTS, PREDICATES, COMMANDS, SKILLS]) {
      const ids = cat.map((o) => o.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('commandById throws on an unknown command (a genuine wiring error, not stale data)', () => {
    expect(() => commandById('parry')).toThrow(/Unknown command/)
  })
})
