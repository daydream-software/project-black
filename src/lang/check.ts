// Compile-time CHECK of an Inscription program: surfaces lex/parse errors (with a
// line/col) and the missing-entry case, for the editor's error line and the CodeMirror
// linter. Pure; never runs the program — purely syntactic + an entry-point presence test.

import { compile } from './interp'
import { checkGates, unlocked } from './gate'

export interface CheckResult {
  ok: boolean
  message?: string
  line?: number
  col?: number
}

/** Read a thrown lex/parse error's message + optional line/col defensively (the catch
 *  binding is `unknown`; no cast). */
function errInfo(e: unknown): { message: string; line?: number; col?: number } {
  const message = e instanceof Error ? e.message : 'error'
  const obj: object = typeof e === 'object' && e !== null ? e : {}
  const line = 'line' in obj && typeof obj.line === 'number' ? obj.line : undefined
  const col = 'col' in obj && typeof obj.col === 'number' ? obj.col : undefined
  return { message, line, col }
}

/** Check a program. Empty source is valid (the slot path runs instead). `entry` null =
 *  a LIBRARY (just check syntax, no required entry function). */
export function checkProgram(src: string, entry: string | null = 'combat_turn'): CheckResult {
  if (src.trim() === '') return { ok: true }
  try {
    const program = compile(src)
    if (entry !== null) {
      const hasEntry = program.module.body.some(
        (s) => (s.k === 'entry' && s.entry === entry) || (s.k === 'func' && s.name === entry),
      )
      if (!hasEntry) return { ok: false, message: `expected an 'Engram.${entry}:' block` }
    }
    const gate = checkGates(program.module, unlocked())
    if (!gate.ok) return gate
    return { ok: true }
  } catch (e) {
    return { ok: false, ...errInfo(e) }
  }
}
