// The Inscription PARSER — tokens → AST, recursive descent, PURE. Covers the whole
// target subset (docs/INSCRIPTION-LANG.md §1): def, if/elif/else, for, while, return,
// break/continue/pass, global, import, assignment, expr-stmt; expressions down to
// list/set/dict literals + comprehensions. Operator precedence mirrors Python.

import { lex, type Token, type TokKind } from './lexer'

export class ParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(message)
    this.name = 'ParseError'
  }
}

// --- AST ---------------------------------------------------------------------

export type Expr =
  | { k: 'num'; value: number }
  | { k: 'str'; value: string }
  | { k: 'bool'; value: boolean }
  | { k: 'none' }
  | { k: 'name'; id: string; line: number; col: number }
  | { k: 'attr'; obj: Expr; name: string; line: number; col: number }
  | { k: 'index'; obj: Expr; index: Expr; line: number; col: number }
  | { k: 'call'; fn: Expr; args: Expr[]; line: number; col: number }
  | { k: 'unary'; op: string; operand: Expr }
  | { k: 'binary'; op: string; left: Expr; right: Expr; line: number; col: number }
  | { k: 'bool_op'; op: 'and' | 'or'; left: Expr; right: Expr }
  | { k: 'compare'; op: string; left: Expr; right: Expr }
  | { k: 'list'; items: Expr[] }
  | { k: 'set'; items: Expr[] }
  | { k: 'dict'; pairs: Array<[Expr, Expr]> }
  | { k: 'comp'; kind: 'list' | 'set'; element: Expr; var: string; iter: Expr; cond: Expr | null }

// Gated statements (if/for/while/func/import) carry a line/col so the feature gate can
// point the linter at the locked construct.
export type Stmt =
  | { k: 'func'; name: string; params: string[]; body: Stmt[]; line: number; col: number }
  | { k: 'return'; value: Expr | null }
  | { k: 'if'; test: Expr; body: Stmt[]; orelse: Stmt[]; line: number; col: number }
  | { k: 'for'; var: string; iter: Expr; body: Stmt[]; line: number; col: number }
  | { k: 'while'; test: Expr; body: Stmt[]; line: number; col: number }
  | { k: 'assign'; target: Expr; value: Expr }
  | { k: 'expr'; value: Expr }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'pass' }
  | { k: 'global'; names: string[] }
  | { k: 'import'; name: string; line: number; col: number }
  | { k: 'entry'; entry: string; body: Stmt[] } // `Engram.combat_turn:` declarative entry block

export interface Module {
  body: Stmt[]
}

// --- Parser ------------------------------------------------------------------

class Parser {
  private pos = 0
  constructor(private toks: Token[]) {}

  private peek(o = 0): Token {
    return this.toks[Math.min(this.pos + o, this.toks.length - 1)]
  }
  private next(): Token {
    const t = this.toks[this.pos]
    if (this.pos < this.toks.length - 1) this.pos += 1
    return t
  }
  private is(kind: TokKind, value?: string): boolean {
    const t = this.peek()
    return t.kind === kind && (value === undefined || t.value === value)
  }
  private accept(kind: TokKind, value?: string): boolean {
    if (this.is(kind, value)) { this.next(); return true }
    return false
  }
  private expect(kind: TokKind, value?: string): Token {
    if (!this.is(kind, value)) {
      const t = this.peek()
      const want = value ?? kind
      throw new ParseError(`expected ${want}, got '${t.value === '' ? t.kind : t.value}'`, t.line, t.col)
    }
    return this.next()
  }
  private skipNewlines(): void {
    while (this.is('NEWLINE')) this.next()
  }

  parseModule(): Module {
    const body: Stmt[] = []
    this.skipNewlines()
    while (!this.is('EOF')) {
      body.push(this.statement())
      this.skipNewlines()
    }
    return { body }
  }

  private block(): Stmt[] {
    this.expect('OP', ':')
    this.expect('NEWLINE')
    this.expect('INDENT')
    const body: Stmt[] = []
    while (!this.is('DEDENT') && !this.is('EOF')) {
      body.push(this.statement())
      this.skipNewlines()
    }
    this.expect('DEDENT')
    return body
  }

  private statement(): Stmt {
    // Compound statements own a keyword + an indented block; simple ones are one line.
    if (this.is('KEYWORD', 'Engram')) return this.entryBlock()
    if (this.is('KEYWORD', 'def')) return this.funcDef()
    if (this.is('KEYWORD', 'if')) return this.ifStmt()
    if (this.is('KEYWORD', 'for')) return this.forStmt()
    if (this.is('KEYWORD', 'while')) return this.whileStmt()
    return this.simpleStatement()
  }

  private simpleStatement(): Stmt {
    if (this.is('KEYWORD', 'return')) {
      this.next()
      const value = this.is('NEWLINE') ? null : this.expression()
      this.endSimple()
      return { k: 'return', value }
    }
    if (this.accept('KEYWORD', 'break')) { this.endSimple(); return { k: 'break' } }
    if (this.accept('KEYWORD', 'continue')) { this.endSimple(); return { k: 'continue' } }
    if (this.accept('KEYWORD', 'pass')) { this.endSimple(); return { k: 'pass' } }
    if (this.accept('KEYWORD', 'global')) {
      const names = [this.expect('NAME').value]
      while (this.accept('OP', ',')) names.push(this.expect('NAME').value)
      this.endSimple()
      return { k: 'global', names }
    }
    if (this.is('KEYWORD', 'import')) {
      const kw = this.next()
      const name = this.expect('NAME').value
      this.endSimple()
      return { k: 'import', name, line: kw.line, col: kw.col }
    }
    return this.assignOrExpr()
  }

  private assignOrExpr(): Stmt {
    const expr = this.expression()
    if (this.accept('OP', '=')) {
      const value = this.expression()
      this.endSimple()
      if (expr.k !== 'name' && expr.k !== 'attr' && expr.k !== 'index') {
        throw new ParseError('invalid assignment target', this.peek().line, this.peek().col)
      }
      return { k: 'assign', target: expr, value }
    }
    this.endSimple()
    return { k: 'expr', value: expr }
  }

  private endSimple(): void {
    if (!this.is('EOF') && !this.is('DEDENT')) this.expect('NEWLINE')
  }

  // `Engram.combat_turn:` / `Engram.exploration_turn:` — a declarative entry block (NOT a
  // `def`, so `def` can stay a locked, advanced feature). The body uses ambient senses/me/Memory.
  private entryBlock(): Stmt {
    this.expect('KEYWORD', 'Engram')
    this.expect('OP', '.')
    const id = this.expect('NAME')
    if (id.value !== 'combat_turn' && id.value !== 'exploration_turn') {
      throw new ParseError(`unknown engram entry 'Engram.${id.value}' (expected combat_turn or exploration_turn)`, id.line, id.col)
    }
    return { k: 'entry', entry: id.value, body: this.block() }
  }

  private funcDef(): Stmt {
    const kw = this.expect('KEYWORD', 'def')
    const name = this.expect('NAME').value
    this.expect('OP', '(')
    const params: string[] = []
    if (!this.is('OP', ')')) {
      params.push(this.expect('NAME').value)
      while (this.accept('OP', ',')) params.push(this.expect('NAME').value)
    }
    this.expect('OP', ')')
    return { k: 'func', name, params, body: this.block(), line: kw.line, col: kw.col }
  }

  private ifStmt(): Stmt {
    const kw = this.expect('KEYWORD', 'if')
    const test = this.expression()
    const body = this.block()
    let orelse: Stmt[] = []
    if (this.is('KEYWORD', 'elif')) {
      // Re-enter as a nested if by swapping the keyword view.
      this.toks[this.pos] = { ...this.peek(), value: 'if' }
      orelse = [this.ifStmt()]
    } else if (this.accept('KEYWORD', 'else')) {
      orelse = this.block()
    }
    return { k: 'if', test, body, orelse, line: kw.line, col: kw.col }
  }

  private forStmt(): Stmt {
    const kw = this.expect('KEYWORD', 'for')
    const v = this.expect('NAME').value
    this.expect('KEYWORD', 'in')
    const iter = this.expression()
    return { k: 'for', var: v, iter, body: this.block(), line: kw.line, col: kw.col }
  }

  private whileStmt(): Stmt {
    const kw = this.expect('KEYWORD', 'while')
    const test = this.expression()
    return { k: 'while', test, body: this.block(), line: kw.line, col: kw.col }
  }

  // --- expressions (precedence climbing) ---
  private expression(): Expr {
    return this.orExpr()
  }
  private orExpr(): Expr {
    let left = this.andExpr()
    while (this.is('KEYWORD', 'or')) { this.next(); left = { k: 'bool_op', op: 'or', left, right: this.andExpr() } }
    return left
  }
  private andExpr(): Expr {
    let left = this.notExpr()
    while (this.is('KEYWORD', 'and')) { this.next(); left = { k: 'bool_op', op: 'and', left, right: this.notExpr() } }
    return left
  }
  private notExpr(): Expr {
    if (this.accept('KEYWORD', 'not')) return { k: 'unary', op: 'not', operand: this.notExpr() }
    return this.comparison()
  }
  private comparison(): Expr {
    let left = this.additive()
    for (;;) {
      const t = this.peek()
      if (t.kind === 'OP' && ['==', '!=', '<', '<=', '>', '>='].includes(t.value)) {
        this.next()
        left = { k: 'compare', op: t.value, left, right: this.additive() }
      } else if (this.is('KEYWORD', 'in')) {
        this.next()
        left = { k: 'compare', op: 'in', left, right: this.additive() }
      } else if (this.is('KEYWORD', 'not') && this.peek(1).kind === 'KEYWORD' && this.peek(1).value === 'in') {
        this.next(); this.next()
        left = { k: 'compare', op: 'not in', left, right: this.additive() }
      } else break
    }
    return left
  }
  private additive(): Expr {
    let left = this.multiplicative()
    while (this.is('OP', '+') || this.is('OP', '-')) {
      const op = this.next().value
      left = { k: 'binary', op, left, right: this.multiplicative(), line: this.peek().line, col: this.peek().col }
    }
    return left
  }
  private multiplicative(): Expr {
    let left = this.unary()
    while (this.is('OP', '*') || this.is('OP', '/') || this.is('OP', '//') || this.is('OP', '%')) {
      const op = this.next().value
      left = { k: 'binary', op, left, right: this.unary(), line: this.peek().line, col: this.peek().col }
    }
    return left
  }
  private unary(): Expr {
    if (this.is('OP', '-') || this.is('OP', '+')) {
      const op = this.next().value
      return { k: 'unary', op, operand: this.unary() }
    }
    return this.power()
  }
  private power(): Expr {
    const base = this.postfix()
    if (this.is('OP', '**')) { this.next(); return { k: 'binary', op: '**', left: base, right: this.unary(), line: this.peek().line, col: this.peek().col } }
    return base
  }
  private postfix(): Expr {
    let e = this.atom()
    for (;;) {
      const t = this.peek()
      if (this.is('OP', '.')) {
        this.next()
        const id = this.expect('NAME')
        e = { k: 'attr', obj: e, name: id.value, line: id.line, col: id.col }
      } else if (this.is('OP', '(')) {
        this.next()
        const args: Expr[] = []
        if (!this.is('OP', ')')) {
          args.push(this.expression())
          while (this.accept('OP', ',')) { if (this.is('OP', ')')) break; args.push(this.expression()) }
        }
        this.expect('OP', ')')
        e = { k: 'call', fn: e, args, line: t.line, col: t.col }
      } else if (this.is('OP', '[')) {
        this.next()
        const index = this.expression()
        this.expect('OP', ']')
        e = { k: 'index', obj: e, index, line: t.line, col: t.col }
      } else break
    }
    return e
  }
  private atom(): Expr {
    const lit = this.literalAtom()
    if (lit !== null) return lit
    if (this.accept('OP', '(')) {
      const e = this.expression()
      this.expect('OP', ')')
      return e
    }
    if (this.is('OP', '[')) return this.listOrComp()
    if (this.is('OP', '{')) return this.dictOrSet()
    const t = this.peek()
    throw new ParseError(`unexpected '${t.value === '' ? t.kind : t.value}'`, t.line, t.col)
  }

  /** A literal / name atom (number, string, True/False/None, name); null if none here. */
  private literalAtom(): Expr | null {
    const t = this.peek()
    if (t.kind === 'NUMBER') { this.next(); return { k: 'num', value: Number(t.value) } }
    if (t.kind === 'STRING') { this.next(); return { k: 'str', value: t.value } }
    if (this.accept('KEYWORD', 'True')) return { k: 'bool', value: true }
    if (this.accept('KEYWORD', 'False')) return { k: 'bool', value: false }
    if (this.accept('KEYWORD', 'None')) return { k: 'none' }
    if (t.kind === 'NAME') { this.next(); return { k: 'name', id: t.value, line: t.line, col: t.col } }
    return null
  }
  private listOrComp(): Expr {
    this.expect('OP', '[')
    if (this.accept('OP', ']')) return { k: 'list', items: [] }
    const first = this.expression()
    if (this.is('KEYWORD', 'for')) {
      const comp = this.comprehensionTail('list', first)
      this.expect('OP', ']')
      return comp
    }
    const items = [first]
    while (this.accept('OP', ',')) { if (this.is('OP', ']')) break; items.push(this.expression()) }
    this.expect('OP', ']')
    return { k: 'list', items }
  }
  private dictOrSet(): Expr {
    this.expect('OP', '{')
    if (this.accept('OP', '}')) return { k: 'dict', pairs: [] }
    const first = this.expression()
    if (this.accept('OP', ':')) {
      const val = this.expression()
      const pairs: Array<[Expr, Expr]> = [[first, val]]
      while (this.accept('OP', ',')) {
        if (this.is('OP', '}')) break
        const key = this.expression()
        this.expect('OP', ':')
        pairs.push([key, this.expression()])
      }
      this.expect('OP', '}')
      return { k: 'dict', pairs }
    }
    if (this.is('KEYWORD', 'for')) {
      const comp = this.comprehensionTail('set', first)
      this.expect('OP', '}')
      return comp
    }
    const items = [first]
    while (this.accept('OP', ',')) { if (this.is('OP', '}')) break; items.push(this.expression()) }
    this.expect('OP', '}')
    return { k: 'set', items }
  }
  private comprehensionTail(kind: 'list' | 'set', element: Expr): Expr {
    this.expect('KEYWORD', 'for')
    const v = this.expect('NAME').value
    this.expect('KEYWORD', 'in')
    const iter = this.orExpr()
    let cond: Expr | null = null
    if (this.accept('KEYWORD', 'if')) cond = this.orExpr()
    return { k: 'comp', kind, element, var: v, iter, cond }
  }
}

/** Lex + parse `src` into a Module. Throws LexError / ParseError on bad input. */
export function parse(src: string): Module {
  return new Parser(lex(src)).parseModule()
}
