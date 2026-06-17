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
const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s*(?<summary>.+)$/iu

/** Parse one commit SUBJECT line; null if it isn't Conventional-Commit shaped. */
export function parseCommit(subject: string): ParsedCommit | null {
  // TS types regex groups as `string`, but optional ones (`scope`/`breaking`) are
  // undefined at runtime — annotate the values as `string | undefined` (a safe widening,
  // no cast) so the null-handling below is honest.
  const g: Record<string, string | undefined> | undefined = CONVENTIONAL.exec(subject.trim())?.groups
  if (g === undefined) return null
  return { type: (g.type ?? '').toLowerCase(), scope: g.scope ?? null, breaking: g.breaking === '!', summary: (g.summary ?? '').trim() }
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

/** One commit's CHANGELOG.md bullet text (scope prefix + summary + breaking marker). */
function entryText(p: ParsedCommit): string {
  return `${p.scope === null ? '' : `**${p.scope}:** `}${p.summary}${p.breaking ? ' ⚠️ BREAKING' : ''}`
}

/** One section's markdown lines (version heading + entries grouped by type label). */
function renderDevSection(sec: DevSection): string[] {
  const byLabel = new Map<string, string[]>()
  const other: string[] = []
  for (const subject of sec.subjects) {
    const p = parseCommit(subject)
    if (p === null) { other.push(subject); continue }
    const label = TYPE_LABEL[p.type] ?? 'Other'
    byLabel.set(label, [...byLabel.get(label) ?? [], entryText(p)])
  }
  const out = [`## ${sec.version}${sec.date === '' ? '' : ` — ${sec.date}`}`, '']
  for (const label of Object.values(TYPE_LABEL)) {
    const items = byLabel.get(label) ?? []
    if (items.length > 0) out.push(`### ${label}`, ...items.map((t) => `- ${t}`), '')
  }
  if (other.length > 0) out.push('### Other', ...other.map((t) => `- ${t}`), '')
  return out
}

/** Render the full developer CHANGELOG.md from sections (newest first). Pure + stable. */
export function renderDevChangelog(sections: readonly DevSection[]): string {
  const lines = [
    '# Changelog', '',
    '> Generated from Conventional Commits by `npm run changelog`. Do not edit by hand.', '',
    ...sections.flatMap(renderDevSection),
  ]
  return `${lines.join('\n').trimEnd()}\n`
}
