// The changelog GENERATOR (run: `npm run changelog`). Reads git tags `vX.Y.Z` as
// release boundaries, turns each tag's Conventional Commits into a player-facing block
// (src/changelog.json — the schema the game consumes) and a dev CHANGELOG.md. All the
// logic lives in src/changelog-gen.ts (pure, unit-tested); this file is only the git/fs
// I/O around it. Run via vite-node so it can import the TS sources directly.
//
// It VALIDATES that the latest tag matches package.json's version and fails loudly on a
// mismatch (that mismatch is exactly what reopens the in-game panel forever) — it never
// mutates package.json itself. Bumping the version stays an explicit, separate step.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  buildBlock, mergeBlocks, renderDevChangelog,
  type DevSection, type GroupResult,
} from '../src/changelog-gen'
import { compareVersions, type VersionEntry } from '../src/changelog'

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim()
const subjectsIn = (range: string): string[] =>
  git('log', range, '--pretty=format:%s').split('\n').map((s) => s.trim()).filter((s) => s !== '')

// --- gather release tags (vX.Y.Z), ascending ---------------------------------
const tags = git('tag', '--list', 'v*')
  .split('\n').map((t) => t.trim()).filter((t) => t !== '')
  .map((t) => t.replace(/^v/, ''))
  .sort(compareVersions)

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

if (tags.length === 0) {
  console.log(`No vX.Y.Z release tags yet — nothing to generate.\n`
    + `Cut a release: git tag v${pkg.version} && npm run changelog`)
  process.exit(0)
}

// --- enforce the invariant: latest tag === package.json version --------------
const latest = tags[tags.length - 1]
if (latest !== pkg.version) {
  console.error(`✗ version mismatch: package.json is ${pkg.version} but the latest tag is v${latest}.\n`
    + `  Bump package.json to ${latest} (or tag v${pkg.version}) — a mismatch reopens the in-game "What's New" panel forever.`)
  process.exit(1)
}

// --- generate a player block per tag, from its commit range ------------------
const existing = (JSON.parse(readFileSync('src/changelog.json', 'utf8')) as { versions: VersionEntry[] }).versions
const generated: VersionEntry[] = []
const devSections: DevSection[] = []
const skippedTotal: GroupResult['skipped'] = { count: 0, types: {} }

const unreleased = subjectsIn(`v${latest}..HEAD`)
if (unreleased.length > 0) devSections.push({ version: 'Unreleased', date: '', subjects: unreleased })

for (let i = tags.length - 1; i >= 0; i -= 1) {
  const v = tags[i]
  const prev = i > 0 ? tags[i - 1] : null
  const range = prev === null ? `v${v}` : `v${prev}..v${v}`
  const subjects = subjectsIn(range)
  const date = git('log', '-1', '--format=%cs', `v${v}`)
  const { block, skipped } = buildBlock(v, date, '', subjects)
  generated.push(block)
  devSections.push({ version: `v${v}`, date, subjects })
  skippedTotal.count += skipped.count
  for (const [type, n] of Object.entries(skipped.types)) skippedTotal.types[type] = (skippedTotal.types[type] ?? 0) + n
}

// --- write (stable: 2-space JSON + trailing newline) -------------------------
const merged = mergeBlocks(existing, generated)
writeFileSync('src/changelog.json', `${JSON.stringify({ versions: merged }, null, 2)}\n`)
writeFileSync('CHANGELOG.md', renderDevChangelog(devSections))

const preserved = merged.length - generated.filter((g) => !existing.some((e) => e.version === g.version)).length
const skippedTypes = Object.entries(skippedTotal.types).map(([t, n]) => `${t}×${n}`).join(', ')
console.log(`✓ wrote src/changelog.json (${merged.length} versions; ${preserved} hand-authored preserved) + CHANGELOG.md`)
console.log(`  player notes from feat/fix/perf; skipped ${skippedTotal.count} dev commits${skippedTypes === '' ? '' : ` (${skippedTypes})`}`)
if (unreleased.length > 0) console.log(`  ${unreleased.length} unreleased commit(s) after v${latest} → CHANGELOG.md only (tag a new version to publish them)`)
