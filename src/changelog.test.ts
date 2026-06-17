import { describe, it, expect } from 'vitest'
import { compareVersions, entriesSince, CHANGELOG, type VersionEntry } from './changelog'

const entry = (version: string): VersionEntry => ({
  version, date: '2026-01-01', title: version, New: [], Fixes: [], Improvements: [],
})

describe('compareVersions', () => {
  it('orders dotted-numeric versions', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })
  it('treats missing trailing parts as 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2', '1.2.1')).toBe(-1)
  })
  it('compares by most-significant part first (no lexical surprises)', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1) // 10 > 9, not "10" < "9"
  })
})

describe('entriesSince', () => {
  const all = [entry('0.1.0'), entry('0.3.0'), entry('0.2.0')]

  it('returns everything (newest first) when never seen', () => {
    expect(entriesSince(null, all).map((e) => e.version)).toEqual(['0.3.0', '0.2.0', '0.1.0'])
  })
  it('returns only strictly-newer entries', () => {
    expect(entriesSince('0.2.0', all).map((e) => e.version)).toEqual(['0.3.0'])
  })
  it('returns nothing when the latest is already seen', () => {
    expect(entriesSince('0.3.0', all)).toEqual([])
  })
})

describe('the shipped changelog.json', () => {
  it('parses into well-formed entries the panel can render', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0)
    for (const e of CHANGELOG) {
      expect(typeof e.version).toBe('string')
      expect(typeof e.date).toBe('string')
      expect(Array.isArray(e.New)).toBe(true)
      expect(Array.isArray(e.Fixes)).toBe(true)
      expect(Array.isArray(e.Improvements)).toBe(true)
    }
  })
})
