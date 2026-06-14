// The PURE "rule compiler" for the editors: it turns the persisted editor rows
// (ids picked from dropdowns, ExProtocolRow) into the model the sim consumes
// (ExProcedure / ExProtocol from delve.ts). Kept out of main.ts so it has no DOM
// dependency and is unit-testable — main.ts is just the DOM wiring around this.

import type { ExProcedure, ExProtocol, ExSubject, ExPredicate, ExMove } from './delve'
import type { Hero, ExProtocolRow, ProtocolRow } from './save'
import type { State, Maneuver, Procedure, Protocol, SkillId } from './sim'

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
export function available<T>(options: Array<Option<T>>, unlocked: readonly string[]): Array<Option<T>> {
  return options.filter((o) => o.unlock === undefined || unlocked.includes(o.unlock))
}

/** Look up an option by id, or `undefined` if no option has it. The tolerant form
 *  used when compiling persisted rows, where a stale/renamed id must not throw. */
export function tryById<T>(list: Array<Option<T>>, id: string): Option<T> | undefined {
  return list.find((o) => o.id === id)
}

/** Look up an option by id, throwing on an unknown id. For call sites where an
 *  unknown id is a genuine programmer error, not stale player data — the row
 *  compilers below use the tolerant `tryById` + a resolve check instead. */
export function byId<T>(list: Array<Option<T>>, id: string): Option<T> {
  const found = tryById(list, id)
  if (found === undefined) throw new Error(`Unknown option: ${id}`)
  return found
}

// --- Exploration vocabulary: the party-wide delve Procedure's dropdowns. -----
// Subject · Predicate → Move (no Object — a Move carries no skill). Each row is one
// ExProtocol (delve.ts); the ids round-trip through ExProtocolRow.

export const EX_SUBJECTS: Array<Option<ExSubject>> = [
  { id: 'target', label: 'Target', make: () => ({ what: 'target' }) },
  { id: 'unexplored', label: 'Unexplored', make: () => ({ what: 'unexplored' }) },
  { id: 'exit', label: 'Exit', make: () => ({ what: 'exit' }) },
]

export const EX_PREDICATES: Array<Option<ExPredicate>> = [
  { id: 'always', label: 'Always', make: () => ({ p: 'always' }) },
  { id: 'known', label: 'known', make: () => ({ p: 'known' }) },
  { id: 'php_lt_50', label: 'party HP < 50%', make: () => ({ p: 'partyHpPctBelow', value: 50 }) },
  { id: 'php_lt_30', label: 'party HP < 30%', make: () => ({ p: 'partyHpPctBelow', value: 30 }) },
]

export const EX_MOVES: Array<Option<ExMove>> = [
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

/** Compile one editor row into an ExProtocol (its label is what the journal shows). */
export function exRowToProtocol(row: ExProtocolRow): ExProtocol {
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

/** True when every id in an exploration row resolves to a current catalog option.
 *  A row with a stale id (vocabulary churned since it was saved) is *dropped* at
 *  compile time rather than crashing the delve — see buildExploration. */
export function exRowResolves(row: ExProtocolRow): boolean {
  return (
    tryById(EX_SUBJECTS, row.subjectId) !== undefined &&
    tryById(EX_PREDICATES, row.predId) !== undefined &&
    tryById(EX_MOVES, row.moveId) !== undefined
  )
}

/** Compile the enabled rows (in priority order) into the ExProcedure a delve runs.
 *  Rows whose ids no longer resolve are skipped (never thrown on) so a save from an
 *  older vocabulary still launches — the stale row stays visible in the editor. */
export function buildExploration(rows: ExProtocolRow[]): ExProcedure {
  return rows.filter((r) => r.enabled && exRowResolves(r)).map(exRowToProtocol)
}

// --- Combat vocabulary: a hero's Procedure dropdowns. ------------------------
// Subject + Predicate (the State) and Command + Object (the Maneuver). The Object
// dropdown (a skill) only applies to "Use Skill". Mirrors the exploration catalogs
// above; ids round-trip through ProtocolRow. Lives here (not main.ts) so the
// compiler is pure and unit-testable, like the exploration twin.

export const SUBJECTS: Array<Option<State['subject']>> = [
  { id: 'self', label: 'Self', make: () => ({ who: 'self' }) },
  { id: 'ally_any', label: 'Ally · any', make: () => ({ who: 'ally', pick: 'first' }) },
  { id: 'ally_low', label: 'Ally · low HP', make: () => ({ who: 'ally', pick: 'lowestHp' }) },
  { id: 'enemy_near', label: 'Enemy · near', make: () => ({ who: 'enemy', pick: 'first' }) },
  { id: 'enemy_low', label: 'Enemy · low HP', make: () => ({ who: 'enemy', pick: 'lowestHp' }) },
  // Locked until learned at the Trainer (slice 10b): focus-fire the biggest threat.
  { id: 'enemy_high', label: 'Enemy · most HP', make: () => ({ who: 'enemy', pick: 'highestHp' }), unlock: 'enemy-most-hp' },
]

export const PREDICATES: Array<Option<State['predicate']>> = [
  { id: 'always', label: 'Always', make: () => ({ p: 'always' }) },
  { id: 'hp_lt_30', label: 'HP < 30%', make: () => ({ p: 'hpPctBelow', value: 30 }) },
  { id: 'hp_lt_50', label: 'HP < 50%', make: () => ({ p: 'hpPctBelow', value: 50 }) },
  { id: 'hp_full', label: 'HP = 100%', make: () => ({ p: 'hpFull' }) },
]

/** A combat command. "useSkill" carries an Object (a skill); the others do not.
 *  "useItem" exists in the model but waits on an item system, so it's omitted. */
export interface Command {
  id: 'attack' | 'useSkill' | 'flee'
  label: string
  hasObject: boolean
}

export const COMMANDS: Command[] = [
  { id: 'attack', label: 'Attack', hasObject: false },
  { id: 'useSkill', label: 'Use Skill', hasObject: true },
  { id: 'flee', label: 'Flee', hasObject: false },
]

export const SKILLS: Array<{ id: SkillId; label: string }> = [
  { id: 'mend', label: 'Mend' },
  { id: 'defend', label: 'Defend' },
]

/** Look up a command by id, throwing on an unknown one (editor wiring uses this on
 *  the constrained command union — a miss is a programmer error). */
export function commandById(id: string): Command {
  const found = COMMANDS.find((c) => c.id === id)
  if (found === undefined) throw new Error(`Unknown command: ${id}`)
  return found
}

/** The shown label for a skill id; falls back to the raw id if it's stale. */
export function skillLabel(id: SkillId): string {
  return SKILLS.find((s) => s.id === id)?.label ?? id
}

function maneuverFor(row: ProtocolRow): Maneuver {
  if (row.command === 'useSkill') return { command: 'useSkill', skill: row.skillId }
  if (row.command === 'flee') return { command: 'flee' }
  return { command: 'attack' }
}

function maneuverLabel(row: ProtocolRow): string {
  if (row.command === 'useSkill') return `Use Skill · ${skillLabel(row.skillId)}`
  return COMMANDS.find((c) => c.id === row.command)?.label ?? row.command
}

/** Compile one combat row into a Protocol (its label is what the journal shows).
 *  Strict on the State ids — callers must pre-filter with `rowResolves`. */
export function rowToProtocol(row: ProtocolRow): Protocol {
  const subject = byId(SUBJECTS, row.subjectId)
  const pred = byId(PREDICATES, row.predId)
  return {
    state: { subject: subject.make(), predicate: pred.make() },
    maneuver: maneuverFor(row),
    label: `${subject.label} · ${pred.label} → ${maneuverLabel(row)}`,
  }
}

/** True when a combat row's State ids both resolve to current catalog options. */
export function rowResolves(row: ProtocolRow): boolean {
  return tryById(SUBJECTS, row.subjectId) !== undefined && tryById(PREDICATES, row.predId) !== undefined
}

/** Compile a hero's enabled rows (priority order) into the Procedure the sim runs.
 *  Stale-id rows are dropped, not thrown on, so an old save still fields a party. */
export function procedureFor(hero: Hero): Procedure {
  return hero.rows.filter((r) => r.enabled && rowResolves(r)).map(rowToProtocol)
}
