// The in-game "What's New" — pure version logic + last-seen tracking. The data is
// src/changelog.json (the fixed schema a future generator writes; the game just reads
// it, decoupled — see CONTRIBUTING.md). The build version is injected from package.json
// (`__APP_VERSION__`, vite.config.ts). Last-seen is a single GLOBAL localStorage key —
// NOT per save slot — because "what's new" is about the build, shared across profiles.

import data from './changelog.json'

export interface VersionEntry {
  version: string
  date: string
  title: string
  New: string[]
  Fixes: string[]
  Improvements: string[]
}

export const APP_VERSION: string = __APP_VERSION__
export const CHANGELOG: VersionEntry[] = data.versions

const SEEN_KEY = 'pb:lastSeenVersion'

/** Compare dotted-numeric versions → -1 / 0 / 1 (missing parts count as 0). Pure. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i += 1) {
    const x = Number.parseInt(pa[i] ?? '0', 10) || 0
    const y = Number.parseInt(pb[i] ?? '0', 10) || 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Entries strictly newer than `lastSeen` (null = never seen → all), newest first. Pure. */
export function entriesSince(lastSeen: string | null, all: readonly VersionEntry[] = CHANGELOG): VersionEntry[] {
  const sorted = [...all].sort((a, b) => compareVersions(b.version, a.version))
  return lastSeen === null ? sorted : sorted.filter((e) => compareVersions(e.version, lastSeen) > 0)
}

// --- localStorage (impure; guarded so a storage failure never breaks boot) ----
export function lastSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

export function markSeen(version: string = APP_VERSION): void {
  try {
    localStorage.setItem(SEEN_KEY, version)
  } catch {
    /* storage unavailable — the panel just re-shows next boot, never breaks */
  }
}

/** Should the "What's New" panel auto-open this boot? (the build carries unseen notes.) */
export function shouldShowWhatsNew(): boolean {
  return entriesSince(lastSeenVersion()).length > 0
}
