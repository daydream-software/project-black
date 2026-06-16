// Compile-time CHECK of an Inscription program: surfaces lex/parse errors (with a
// line/col) and the missing-entry case, for the editor's error line and the CodeMirror
// linter. Pure; never runs the program — purely syntactic + an entry-point presence test.

import { compile } from './interp'

export interface CheckResult {
  ok: boolean
  message?: string
  line?: number
  col?: number
}

/** Check a program. Empty source is valid (the slot path runs instead). `entry` null =
 *  a LIBRARY (just check syntax, no required entry function). */
export function checkProgram(src: string, entry: string | null = 'combat_turn'): CheckResult {
  if (src.trim() === '') return { ok: true }
  try {
    const program = compile(src)
    if (entry !== null) {
      const hasEntry = program.module.body.some((s) => s.k === 'func' && s.name === entry)
      if (!hasEntry) return { ok: false, message: `expected a 'def ${entry}(senses):' function` }
    }
    return { ok: true }
  } catch (e) {
    const err = e as { message: string; line?: number; col?: number }
    return { ok: false, message: err.message, line: err.line, col: err.col }
  }
}
