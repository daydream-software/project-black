// The PURE "rule compiler" for the editors: it turns the persisted editor rows
// (ids picked from dropdowns, ExProtocolRow) into the model the sim consumes
// (ExProcedure / ExProtocol from delve.ts). Kept out of main.ts so it has no DOM
// dependency and is unit-testable — main.ts is just the DOM wiring around this.

import type { ExProcedure, ExProtocol } from './delve'
import type { Hero, ExProtocolRow, ProtocolRow } from './save'
import type { Maneuver, Procedure, Protocol, SkillId } from './sim'
import type { Option } from './content/registry'
import { SUBJECTS } from './content/subjects'
import { PREDICATES } from './content/predicates'
import { EX_SUBJECTS } from './content/exploration/subjects'
import { EX_PREDICATES } from './content/exploration/predicates'
import { EX_MOVES } from './content/exploration/moves'
import { SKILLS } from './content/skills'

// `Option<T>` + the content catalogs now live under src/content/ (one file per item,
// glob-assembled). Re-exported here so the editors and tests keep importing the
// vocabulary from a single `./protocol` facade alongside the compiler below.
export type { Option }
export { SUBJECTS, PREDICATES, EX_SUBJECTS, EX_PREDICATES, EX_MOVES, SKILLS }

// These helpers work over ANY catalog item — the exploration Option<T> (a `make`
// tag factory) and the combat SubjectDef/PredicateDef/SkillDef (which carry their own
// behaviour). All share `{ id, label, order, unlock? }`, so a minimal structural
// constraint covers them and each returns its concrete type.

/** The options the editor may offer right now: always-available ones, plus any
 *  whose `unlock` id the profile has purchased. Pure, so it's unit-testable. */
export function available<T extends { unlock?: string }>(options: T[], unlocked: readonly string[]): T[] {
  return options.filter((o) => o.unlock === undefined || unlocked.includes(o.unlock))
}

/** Look up an item by id, or `undefined` if none has it. The tolerant form used when
 *  compiling persisted rows, where a stale/renamed id must not throw. */
export function tryById<T extends { id: string }>(list: T[], id: string): T | undefined {
  return list.find((o) => o.id === id)
}

/** Look up an item by id, throwing on an unknown id. For call sites where an unknown
 *  id is a genuine programmer error, not stale player data — the row compilers below
 *  use the tolerant `tryById` + a resolve check instead. */
export function byId<T extends { id: string }>(list: T[], id: string): T {
  const found = tryById(list, id)
  if (found === undefined) throw new Error(`Unknown option: ${id}`)
  return found
}

// --- Exploration vocabulary: the party-wide delve Procedure's dropdowns. -----
// Subject · Predicate → Move (no Object — a Move carries no skill). Each row is one
// ExProtocol (delve.ts); the ids round-trip through ExProtocolRow. The catalogs
// (EX_SUBJECTS / EX_PREDICATES / EX_MOVES) live under content/exploration/ and are
// re-exported above; the compiler below turns rows built from them into ExProtocols.

/** The default exploration rows the editor starts with. Their compiled form must
 *  equal DEFAULT_EXPLORATION (delve.ts) — pinned by a test so the two can't drift. */
export const DEFAULT_EX_ROWS: ExProtocolRow[] = [
  { subjectId: 'target', predId: 'known', moveId: 'head', enabled: true },
  { subjectId: 'unexplored', predId: 'always', moveId: 'head', enabled: true },
]

/** Compile one editor row into an ExProtocol (its label is what the journal shows).
 *  The catalog entries ARE the behaviour-bearing defs now (no `make` tag). */
export function exRowToProtocol(row: ExProtocolRow): ExProtocol {
  const subject = byId(EX_SUBJECTS, row.subjectId)
  const pred = byId(EX_PREDICATES, row.predId)
  const mv = byId(EX_MOVES, row.moveId)
  // Store ids (serialisable); the delve resolves the behaviour-bearing defs at runtime.
  return {
    subject: subject.id,
    predicate: pred.id,
    move: mv.id,
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
// dropdown (a skill) only applies to "Use Skill". SUBJECTS / PREDICATES live under
// content/ and are re-exported above; COMMANDS stays here (a closed union wired to
// the compiler, not extensible content). The compiler below turns rows into Protocols.

/** A combat command. "useSkill" carries an Object (a skill); the others do not.
 *  "useItem" exists in the model but waits on an item system, so it's omitted.
 *  `sfx` (opaque sound key) is the command's own sound — Attack swings; Use Skill has
 *  none (the skill provides its own); Flee is silent. The view assembles the kind→
 *  sound map from these + SKILLS, so no central switch names each sound. */
export interface Command {
  id: 'attack' | 'useSkill' | 'flee'
  label: string
  hasObject: boolean
  sfx?: string
}

export const COMMANDS: Command[] = [
  { id: 'attack', label: 'Attack', hasObject: false, sfx: 'attack' },
  { id: 'useSkill', label: 'Use Skill', hasObject: true },
  { id: 'flee', label: 'Flee', hasObject: false },
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
  // The State references the vocab by id (serialisable); the sim resolves the def at
  // runtime. byId here is just to throw on a bad id + build the human label.
  return {
    state: { subject: subject.id, predicate: pred.id },
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
