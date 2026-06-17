// MIGRATION: turn a golem's slot Procedure (ProtocolRow[]) into equivalent Inscription
// source, so a player can move from the slot editor to the code editor without rewriting
// (piste B). Combat translates faithfully (filter-then-pick → pick-then-guard); the
// exploration slot model is goal-navigation, which the POV code model intentionally drops
// (docs/INSCRIPTION-LANG.md §4), so there we seed the tier-1 template rather than mistranslate.

import type { ProtocolRow } from '../save'
import type { SkillId } from '../sim'

const SUBJECT_EXPR: Record<string, string> = {
  self: 'me',
  ally_any: 'senses.allies.first',
  ally_low: 'senses.allies.lowest_hp',
  enemy_near: 'senses.enemies.first',
  enemy_low: 'senses.enemies.lowest_hp',
  enemy_high: 'senses.enemies.highest_hp',
}

/** A predicate as a boolean condition on the picked target `t`, or null for `always`. */
function predCond(predId: string): string | null {
  switch (predId) {
    case 'always': return null
    case 'hp_full': return 't.hp_pct >= 100'
    case 'hp_lt_50': return 't.hp_pct < 50'
    case 'hp_lt_30': return 't.hp_pct < 30'
    default: return null
  }
}

function pascal(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function maneuverExpr(command: ProtocolRow['command'], skillId: SkillId): string {
  if (command === 'attack') return 'attack(t)'
  if (command === 'flee') return 'flee()'
  return `use(Skills.${pascal(skillId)}, t)`
}

/** Generate a `combat_turn` from enabled slot rows. The result is a faithful starting
 *  point (the `first`/`any` subjects pick the first candidate then guard, vs the slot
 *  model's first-PASSING — equivalent for the lowest/highest picks; tweak as needed). */
export function combatRowsToSource(rows: ProtocolRow[]): string {
  const lines = ['Engram.combat_turn:']
  for (const row of rows) {
    if (!row.enabled) continue
    const subject = SUBJECT_EXPR[row.subjectId]
    if (subject === undefined) continue
    const cond = predCond(row.predId)
    const guard = cond === null ? 't' : `t and ${cond}`
    lines.push(`    t = ${subject}`)
    lines.push(`    if ${guard}:`)
    lines.push(`        return ${maneuverExpr(row.command, row.skillId)}`)
  }
  lines.push('    return attack(senses.enemies.first)') // the engine's own fallback
  return `${lines.join('\n')}\n`
}

/** Rewrite a legacy `def combat_turn(senses):` / `def exploration_turn(senses):` program to
 *  the `Engram.X:` entry-block form (senses is ambient now). Idempotent — an already-`Engram.`
 *  program, or a helper `def`, is untouched. */
export function toEntryForm(src: string): string {
  return src
    .replace(/^def combat_turn\(senses\):/m, 'Engram.combat_turn:')
    .replace(/^def exploration_turn\(senses\):/m, 'Engram.exploration_turn:')
}

/** The tier-1 exploration navigator template (engine-driven frontier nav) — the
 *  starting point when moving the party's delve navigation to code. */
export function explorationTemplate(): string {
  // No-branch default so it runs under the minimal (no-`if`) language: explore the frontier,
  // withdraw when done. `if`/`Memory` unlock smarter navigation later. The `record(...)`
  // line seeds the journal (the golems' voice) — it logs the room type each turn, so a
  // fresh delve's journal isn't empty and the idiom is visible from the start.
  return [
    'Engram.exploration_turn:',
    '    record("at", senses.room.type)  # your record(...) lines fill the journal',
    '    return explore()',
    '',
  ].join('\n')
}
