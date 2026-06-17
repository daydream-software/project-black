// The Inscription language LEXER — source text → a flat token stream, PURE and
// deterministic (see docs/INSCRIPTION-LANG.md §9). A tiny Python subset: significant
// indentation (emits INDENT/DEDENT like CPython), with newlines suppressed inside
// brackets so comprehensions / calls can span lines. No host access — just text.

export type TokKind =
  | 'NEWLINE'
  | 'INDENT'
  | 'DEDENT'
  | 'NAME'
  | 'NUMBER'
  | 'STRING'
  | 'KEYWORD'
  | 'OP'
  | 'EOF'

export interface Token {
  kind: TokKind
  value: string
  /** 1-based line / column of the token start, for error messages + the linter. */
  line: number
  col: number
}

export class LexError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(message)
    this.name = 'LexError'
  }
}

const KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'and', 'or', 'not',
  'None', 'True', 'False', 'break', 'continue', 'pass', 'global', 'import', 'Engram',
])

// Multi-char operators first so the maximal-munch scan prefers them.
const OPS = [
  '==', '!=', '<=', '>=', '//', '**', '->',
  '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', '{', '}',
  ',', ':', '.', '|', '&',
]

function isNameStart(c: string): boolean { return /[A-Za-z_]/u.test(c) }
function isNameChar(c: string): boolean { return /[A-Za-z0-9_]/u.test(c) }
function isDigit(c: string): boolean { return c >= '0' && c <= '9' }
function isInlineSpace(c: string): boolean { return c === ' ' || c === '\t' || c === '\r' }
function isQuote(c: string): boolean { return c === '"' || c === "'" }
function startsNumber(c: string, next: string): boolean { return isDigit(c) || (c === '.' && isDigit(next)) }

/** Tokenise `src`. Throws LexError on a bad character or inconsistent dedent. The scan is
 *  split into per-token-kind helpers (sharing the cursor state via closure) so each — and
 *  the dispatch loop — stays small. */
export function lex(src: string): Token[] {
  const tokens: Token[] = []
  const indents: number[] = [0]
  let bracket = 0 // depth of () [] {} — newlines inside are insignificant
  let i = 0
  let line = 1
  let col = 1
  let atLineStart = true

  const push = (kind: TokKind, value: string, l = line, c = col): void => {
    tokens.push({ kind, value, line: l, col: c })
  }

  // Consume a blank- or comment-only line at the cursor; true if it was one (no token).
  const skipBlankOrComment = (): boolean => {
    if (!(i >= src.length || src[i] === '\n' || src[i] === '#')) return false
    if (i < src.length && src[i] === '#') while (i < src.length && src[i] !== '\n') { i += 1; col += 1 }
    if (i < src.length && src[i] === '\n') { i += 1; line += 1; col = 1 }
    return true
  }

  // Emit INDENT / DEDENT(s) for a line's measured indentation against the indent stack.
  const applyIndent = (indent: number, startCol: number): void => {
    const top = indents[indents.length - 1]
    if (indent > top) { indents.push(indent); push('INDENT', '', line, startCol); return }
    while (indents.length > 1 && indent < indents[indents.length - 1]) { indents.pop(); push('DEDENT', '', line, startCol) }
    if (indents[indents.length - 1] !== indent) throw new LexError('inconsistent indentation', line, startCol)
  }

  // Line start (outside brackets): measure indentation (spaces only — tabs rejected).
  const scanLineStart = (): void => {
    const startCol = col
    let indent = 0
    while (i < src.length && (src[i] === ' ' || src[i] === '\t')) {
      if (src[i] === '\t') throw new LexError('tabs are not allowed for indentation; use spaces', line, col)
      indent += 1; i += 1; col += 1
    }
    if (skipBlankOrComment()) return // stay atLineStart for the next line
    applyIndent(indent, startCol)
    atLineStart = false
  }

  const scanNewline = (): void => {
    i += 1
    if (bracket === 0) {
      if (tokens.length > 0 && tokens[tokens.length - 1].kind !== 'NEWLINE') push('NEWLINE', '') // suppress blanks
      atLineStart = true
    }
    line += 1
    col = 1
  }

  const skipComment = (): void => { while (i < src.length && src[i] !== '\n') { i += 1; col += 1 } }

  const scanName = (): void => {
    const startCol = col
    let j = i
    while (j < src.length && isNameChar(src[j])) j += 1
    const word = src.slice(i, j)
    col += j - i
    i = j
    push(KEYWORDS.has(word) ? 'KEYWORD' : 'NAME', word, line, startCol)
  }

  const scanNumber = (): void => {
    const startCol = col
    let j = i
    while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j += 1
    const num = src.slice(i, j)
    if ((num.match(/\./gu) ?? []).length > 1) throw new LexError(`bad number '${num}'`, line, startCol)
    col += j - i
    i = j
    push('NUMBER', num, line, startCol)
  }

  const scanString = (): void => {
    const quote = src[i]
    const startCol = col
    let j = i + 1
    let str = ''
    while (j < src.length && src[j] !== quote) {
      if (src[j] === '\n') throw new LexError('unterminated string', line, startCol)
      if (src[j] === '\\' && j + 1 < src.length) {
        const n = src[j + 1]
        str += n === 'n' ? '\n' : n === 't' ? '\t' : n
        j += 2
        continue
      }
      str += src[j]
      j += 1
    }
    if (j >= src.length) throw new LexError('unterminated string', line, startCol)
    col += j + 1 - i
    i = j + 1
    push('STRING', str, line, startCol)
  }

  const scanOp = (c: string): void => {
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op === undefined) throw new LexError(`unexpected character '${c}'`, line, col)
    if (op === '(' || op === '[' || op === '{') bracket += 1
    if (op === ')' || op === ']' || op === '}') bracket = Math.max(0, bracket - 1)
    push('OP', op, line, col)
    i += op.length
    col += op.length
  }

  // Scan one token (or whitespace/comment) at the cursor — the dispatch by first char.
  const step = (): void => {
    if (atLineStart && bracket === 0) { scanLineStart(); return }
    const c = src[i]
    if (c === '\n') { scanNewline(); return }
    if (isInlineSpace(c)) { i += 1; col += 1; return }
    if (c === '#') { skipComment(); return }
    if (isNameStart(c)) { scanName(); return }
    if (startsNumber(c, i + 1 < src.length ? src[i + 1] : '')) { scanNumber(); return }
    if (isQuote(c)) { scanString(); return }
    scanOp(c)
  }

  // Close the stream: a trailing NEWLINE, DEDENT back to column 0, then EOF.
  const finish = (): void => {
    if (tokens.length > 0 && tokens[tokens.length - 1].kind !== 'NEWLINE') push('NEWLINE', '')
    while (indents.length > 1) { indents.pop(); push('DEDENT', '') }
    push('EOF', '')
  }

  while (i < src.length) step()
  finish()
  return tokens
}
