// Pure logic for the changelog GENERATOR (the deferred half of CONTRIBUTING's plan):
// Conventional-Commit subjects → player-facing version blocks (the schema changelog.ts
// consumes) + a dev CHANGELOG.md. No git, no fs, no clock here — all I/O lives in
// scripts/gen-changelog.ts so this stays pure + unit-testable with fixture commit lines.

import { compareVersions, type VersionEntry } from './changelog'

export interface ParsedCommit {
  type: string
  scope: string | null
  breaking: boolean
  summary: string
}

// `type(scope)!: summary` — scope and the breaking `!` are optional.
const CONVENTIONAL = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/i

/** Parse one commit SUBJECT line; null if it isn't Conventional-Commit shaped. */
export function parseCommit(subject: string): ParsedCommit | null {
  const m = CONVENTIONAL.exec(subject.trim())
  if (m === null) return null
  return { type: m[1].toLowerCase(), scope: m[2] ?? null, breaking: m[3] === '!', summary: m[4].trim() }
}

// Which commit types become which PLAYER-FACING group. Only these reach changelog.json;
// everything else (docs/refactor/test/chore/style/ci/build/balance/…) is dev-only and is
// reported as "skipped" so the omission is visible, never silent.
export const PLAYER_GROUP: Readonly<Record<string, 'New' | 'Fixes' | 'Improvements'>> = {
  feat: 'New',
  fix: 'Fixes',
  perf: 'Improvements',
}

export interface GroupResult {
  New: string[]
  Fixes: string[]
  Improvements: string[]
  /** Commits NOT shown to players, tallied by type so the dropper is loud. */
  skipped: { count: number; types: Record<string, number> }
}

/** Group commit subjects into the player-facing buckets, tallying what's dropped. Pure. */
export function groupForPlayer(subjects: readonly string[]): GroupResult {
  const out: GroupResult = { New: [], Fixes: [], Improvements: [], skipped: { count: 0, types: {} } }
  for (const subject of subjects) {
    const parsed = parseCommit(subject)
    const group = parsed === null ? undefined : PLAYER_GROUP[parsed.type]
    if (parsed === null || group === undefined) {
      const key = parsed?.type ?? '(no type)'
      out.skipped.count += 1
      out.skipped.types[key] = (out.skipped.types[key] ?? 0) + 1
      continue
    }
    out[group].push(parsed.summary)
  }
  return out
}

/** Build a player-facing version block from a tag's commit subjects (empty groups kept
 *  as []; the consumer omits them). `title` is left for the author to fill / polish. */
export function buildBlock(
  version: string, date: string, title: string, subjects: readonly string[],
): { block: VersionEntry; skipped: GroupResult['skipped'] } {
  const g = groupForPlayer(subjects)
  return {
    block: { version, date, title, New: g.New, Fixes: g.Fixes, Improvements: g.Improvements },
    skipped: g.skipped,
  }
}

/** Merge generated blocks into the existing changelog, PRESERVING any version already
 *  present (generate-once-then-frozen — hand-authored prose is never clobbered; to
 *  regenerate a version, delete its block from changelog.json first). Newest first. */
export function mergeBlocks(existing: readonly VersionEntry[], generated: readonly VersionEntry[]): VersionEntry[] {
  const have = new Set(existing.map((e) => e.version))
  const merged = [...existing, ...generated.filter((g) => !have.has(g.version))]
  return merged.sort((a, b) => compareVersions(b.version, a.version))
}

// --- dev CHANGELOG.md (all types, all versions) ------------------------------
const TYPE_LABEL: Readonly<Record<string, string>> = {
  feat: 'Features', fix: 'Fixes', perf: 'Performance', refactor: 'Refactors',
  docs: 'Docs', test: 'Tests', build: 'Build', ci: 'CI', chore: 'Chores',
  style: 'Style', balance: 'Balance',
}

export interface DevSection { version: string; date: string; subjects: readonly string[] }

/** Render the full developer CHANGELOG.md from sections (newest first). Pure + stable. */
export function renderDevChangelog(sections: readonly DevSection[]): string {
  const lines: string[] = ['# Changelog', '', '> Generated from Conventional Commits by `npm run changelog`. Do not edit by hand.', '']
  for (const sec of sections) {
    lines.push(`## ${sec.version}${sec.date === '' ? '' : ` — ${sec.date}`}`, '')
    const byLabel = new Map<string, string[]>()
    const other: string[] = []
    for (const subject of sec.subjects) {
      const p = parseCommit(subject)
      if (p === null) { other.push(subject); continue }
      const label = TYPE_LABEL[p.type] ?? 'Other'
      const text = `${p.scope === null ? '' : `**${p.scope}:** `}${p.summary}${p.breaking ? ' ⚠️ BREAKING' : ''}`
      const bucket = byLabel.get(label) ?? []
      bucket.push(text)
      byLabel.set(label, bucket)
    }
    for (const label of Object.values(TYPE_LABEL)) {
      const items = byLabel.get(label)
      if (items === undefined || items.length === 0) continue
      lines.push(`### ${label}`, ...items.map((t) => `- ${t}`), '')
    }
    if (other.length > 0) lines.push('### Other', ...other.map((t) => `- ${t}`), '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
