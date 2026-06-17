import { describe, it, expect } from 'vitest'
import {
  parseCommit, groupForPlayer, buildBlock, mergeBlocks, renderDevChangelog,
} from './changelog-gen'
import type { VersionEntry } from './changelog'

describe('parseCommit', () => {
  it('parses type / scope / summary', () => {
    expect(parseCommit('feat(journal): show record lines')).toEqual({
      type: 'feat', scope: 'journal', breaking: false, summary: 'show record lines',
    })
  })
  it('handles no scope and a breaking !', () => {
    expect(parseCommit('feat!: rewrite the save format')).toEqual({
      type: 'feat', scope: null, breaking: true, summary: 'rewrite the save format',
    })
  })
  it('returns null for a non-conventional subject', () => {
    expect(parseCommit('just some words')).toBeNull()
  })
})

describe('groupForPlayer', () => {
  const subjects = [
    'feat(lang): record(...) writes to the journal',
    'fix(combat): stop the celerity softlock',
    'perf(render): fewer allocations',
    'feat: a second feature',
    'balance(combat): gentler level-1 boss', // player-facing in spirit, but NOT a player type
    'docs: sync the markdown',
    'chore: bump deps',
    'not a conventional commit',
  ]
  const g = groupForPlayer(subjects)

  it('maps feat→New, fix→Fixes, perf→Improvements', () => {
    expect(g.New).toEqual(['record(...) writes to the journal', 'a second feature'])
    expect(g.Fixes).toEqual(['stop the celerity softlock'])
    expect(g.Improvements).toEqual(['fewer allocations'])
  })
  it('LOUDLY tallies dropped commits by type (never silent)', () => {
    expect(g.skipped.count).toBe(4) // balance, docs, chore, (no type)
    expect(g.skipped.types).toEqual({ balance: 1, docs: 1, chore: 1, '(no type)': 1 })
  })
})

describe('buildBlock', () => {
  it('produces a consumer-shaped VersionEntry', () => {
    const { block } = buildBlock('0.2.0', '2026-06-20', 'Patch', ['feat: a thing', 'fix: a bug'])
    expect(block).toEqual({
      version: '0.2.0', date: '2026-06-20', title: 'Patch',
      New: ['a thing'], Fixes: ['a bug'], Improvements: [],
    })
  })
})

describe('mergeBlocks', () => {
  const entry = (version: string, title = version): VersionEntry =>
    ({ version, date: '2026-01-01', title, New: [], Fixes: [], Improvements: [] })

  it('preserves an existing (hand-authored) version, adds new ones, newest first', () => {
    const existing = [entry('0.1.0', 'hand-authored')]
    const generated = [entry('0.1.0', 'GENERATED — should not win'), entry('0.2.0', 'new')]
    const merged = mergeBlocks(existing, generated)
    expect(merged.map((e) => e.version)).toEqual(['0.2.0', '0.1.0'])
    expect(merged.find((e) => e.version === '0.1.0')?.title).toBe('hand-authored') // frozen
  })
})

describe('renderDevChangelog', () => {
  it('renders sections newest-first with grouped, labelled entries', () => {
    const md = renderDevChangelog([
      { version: 'v0.2.0', date: '2026-06-20', subjects: ['feat(x): a feature', 'chore: tidy'] },
    ])
    expect(md).toContain('## v0.2.0 — 2026-06-20')
    expect(md).toContain('### Features')
    expect(md).toContain('**x:** a feature')
    expect(md).toContain('### Chores')
  })
})
