import { describe, it, expect } from 'vitest'
import { DEFAULT_EXPLORATION } from './delve'
import {
  buildExploration,
  exRowToRule,
  DEFAULT_EX_ROWS,
  EX_SUBJECTS,
  EX_PREDICATES,
  EX_MOVES,
  byId,
  available,
  type Option,
} from './protocol'
import type { ExProtocolRow } from './save'

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

  it('an all-disabled protocol compiles to an empty list (the delve will get stuck)', () => {
    const rows = DEFAULT_EX_ROWS.map((r) => ({ ...r, enabled: false }))
    expect(buildExploration(rows)).toEqual([])
  })

  it('maps each dropdown id to the right model value', () => {
    const rule = exRowToRule({ subjectId: 'exit', predId: 'php_lt_50', moveId: 'rest', enabled: true })
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
})
