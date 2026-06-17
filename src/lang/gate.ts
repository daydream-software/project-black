// The PROGRESSION feature gate: the Inscription language starts minimal and grows as the
// player spends Insight at the Library. A program that uses a LOCKED construct (`if`, loops,
// `def`, `import`, comprehensions) fails the check with a friendly "study it at the Library"
// message — surfaced by the town-time linter and re-checked at decide-time. Pure; the
// unlocked set is injected (DI) so the lang layer never imports the save/UI.

import type { Module, Stmt, Expr } from './parser'

export interface GateResult {
  ok: boolean
  message?: string
  line?: number
  col?: number
}

/** Human label for a language-feature unlock id (used in the lock message). */
export const FEATURE_LABEL: Record<string, string> = {
  'lang-if': 'if / else',
  'lang-loops': 'loops (for / while)',
  'lang-comprehensions': 'list/set comprehensions',
  'lang-def': 'def (helper functions)',
  'lang-import': 'import',
}

// --- DI registry for the unlocked set (mirrors setLibraries) -----------------
let unlockedSet: ReadonlySet<string> = new Set()
export function setUnlocked(ids: readonly string[]): void {
  unlockedSet = new Set(ids)
}
export function unlocked(): ReadonlySet<string> {
  return unlockedSet
}

/** Check `module` against `allowed`; return the FIRST locked construct (or ok). */
export function checkGates(module: Module, allowed: ReadonlySet<string>): GateResult {
  let hit: GateResult | null = null
  const fail = (id: string, line?: number, col?: number): void => {
    if (hit === null) hit = { ok: false, message: `${FEATURE_LABEL[id] ?? id} is locked — study it at the Library`, line, col }
  }

  const walkExpr = (e: Expr): void => {
    if (hit !== null) return
    switch (e.k) {
      case 'comp':
        if (!allowed.has('lang-comprehensions')) { fail('lang-comprehensions'); return }
        walkExpr(e.iter); walkExpr(e.element); if (e.cond !== null) walkExpr(e.cond); return
      case 'unary': walkExpr(e.operand); return
      case 'bool_op': case 'binary': case 'compare': walkExpr(e.left); walkExpr(e.right); return
      case 'attr': walkExpr(e.obj); return
      case 'index': walkExpr(e.obj); walkExpr(e.index); return
      case 'call': walkExpr(e.fn); e.args.forEach(walkExpr); return
      case 'list': case 'set': e.items.forEach(walkExpr); return
      case 'dict': e.pairs.forEach(([k, v]) => { walkExpr(k); walkExpr(v) })
      // no default: literals / names / None carry nothing to gate (no-op)
    }
  }

  const walkBody = (body: Stmt[]): void => { for (const s of body) walkStmt(s) }
  const walkStmt = (s: Stmt): void => {
    if (hit !== null) return
    switch (s.k) {
      case 'if':
        if (!allowed.has('lang-if')) { fail('lang-if', s.line, s.col); return }
        walkExpr(s.test); walkBody(s.body); walkBody(s.orelse); return
      case 'for': case 'while':
        if (!allowed.has('lang-loops')) { fail('lang-loops', s.line, s.col); return }
        if (s.k === 'for') walkExpr(s.iter); else walkExpr(s.test)
        walkBody(s.body); return
      case 'func':
        if (!allowed.has('lang-def')) { fail('lang-def', s.line, s.col); return }
        walkBody(s.body); return
      case 'import':
        if (!allowed.has('lang-import')) { fail('lang-import', s.line, s.col); return }
        return
      case 'entry': walkBody(s.body); return
      case 'return': if (s.value !== null) walkExpr(s.value); return
      case 'assign': walkExpr(s.target); walkExpr(s.value); return
      case 'expr': walkExpr(s.value)
      // no default: break / continue / pass / global carry nothing to gate (no-op)
    }
  }

  walkBody(module.body)
  return hit ?? { ok: true }
}
