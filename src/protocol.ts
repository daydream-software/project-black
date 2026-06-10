// The PURE "rule compiler" for the editors: it turns the persisted editor rows
// (ids picked from dropdowns, ExProtocolRow) into the model the sim consumes
// (ExProtocol / ExRule from delve.ts). Kept out of main.ts so it has no DOM
// dependency and is unit-testable — main.ts is just the DOM wiring around this.

import type { ExProtocol, ExRule, ExSubject, ExPredicate, ExMove } from './delve'
import type { ExProtocolRow } from './save'

/** A dropdown choice: a stable `id` (persisted), a `label` (shown + journaled),
 *  and a `make()` that builds the model value. Shared by the combat editor too.
 *  `unlock` (10b) gates the option behind a Trainer purchase — absent = always
 *  available; present = only offered once its id is in the profile's `unlocked`. */
export interface Option<T> {
  id: string
  label: string
  make: () => T
  unlock?: string
}

/** The options the editor may offer right now: always-available ones, plus any
 *  whose `unlock` id the profile has purchased. Pure, so it's unit-testable. */
export function available<T>(options: Option<T>[], unlocked: readonly string[]): Option<T>[] {
  return options.filter((o) => o.unlock === undefined || unlocked.includes(o.unlock))
}

/** Look up an option by id, throwing on an unknown id (a corrupt/stale row). */
export function byId<T>(list: Option<T>[], id: string): Option<T> {
  const found = list.find((o) => o.id === id)
  if (found === undefined) throw new Error(`Unknown option: ${id}`)
  return found
}

// --- Exploration vocabulary: the party-wide delve Protocol's dropdowns. ------
// Subject · Predicate → Move (no Object — a Move carries no skill). These mirror
// the ExRule model in delve.ts; the ids round-trip through ExProtocolRow.

export const EX_SUBJECTS: Option<ExSubject>[] = [
  { id: 'target', label: 'Target', make: () => ({ what: 'target' }) },
  { id: 'unexplored', label: 'Unexplored', make: () => ({ what: 'unexplored' }) },
  { id: 'exit', label: 'Exit', make: () => ({ what: 'exit' }) },
]

export const EX_PREDICATES: Option<ExPredicate>[] = [
  { id: 'always', label: 'Always', make: () => ({ p: 'always' }) },
  { id: 'known', label: 'known', make: () => ({ p: 'known' }) },
  { id: 'php_lt_50', label: 'party HP < 50%', make: () => ({ p: 'partyHpPctBelow', value: 50 }) },
  { id: 'php_lt_30', label: 'party HP < 30%', make: () => ({ p: 'partyHpPctBelow', value: 30 }) },
]

export const EX_MOVES: Option<ExMove>[] = [
  { id: 'head', label: 'head toward', make: () => 'headToward' },
  { id: 'retreat', label: 'retreat', make: () => 'retreat' },
  { id: 'rest', label: 'rest', make: () => 'rest' },
]

/** The default exploration rows the editor starts with. Their compiled form must
 *  equal DEFAULT_EXPLORATION (delve.ts) — pinned by a test so the two can't drift. */
export const DEFAULT_EX_ROWS: ExProtocolRow[] = [
  { subjectId: 'target', predId: 'known', moveId: 'head', enabled: true },
  { subjectId: 'unexplored', predId: 'always', moveId: 'head', enabled: true },
]

/** Compile one editor row into an ExRule (its label is what the journal shows). */
export function exRowToRule(row: ExProtocolRow): ExRule {
  const subject = byId(EX_SUBJECTS, row.subjectId)
  const pred = byId(EX_PREDICATES, row.predId)
  const mv = byId(EX_MOVES, row.moveId)
  return {
    subject: subject.make(),
    predicate: pred.make(),
    move: mv.make(),
    label: `${subject.label} · ${pred.label} → ${mv.label}`,
  }
}

/** Compile the enabled rows (in priority order) into the ExProtocol a delve runs. */
export function buildExploration(rows: ExProtocolRow[]): ExProtocol {
  return rows.filter((r) => r.enabled).map(exRowToRule)
}
