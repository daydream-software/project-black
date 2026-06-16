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

function isNameStart(c: string): boolean {
  return /[A-Za-z_]/.test(c)
}
function isNameChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c)
}
function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

/** Tokenise `src`. Throws LexError on a bad character or inconsistent dedent. */
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

  while (i < src.length) {
    if (atLineStart && bracket === 0) {
      // Measure indentation (spaces only; tabs are rejected to avoid ambiguity).
      const startCol = col
      let indent = 0
      while (i < src.length && (src[i] === ' ' || src[i] === '\t')) {
        if (src[i] === '\t') throw new LexError('tabs are not allowed for indentation; use spaces', line, col)
        indent += 1
        i += 1
        col += 1
      }
      // Blank line or comment-only line: no indent token, just consume to newline.
      if (i >= src.length || src[i] === '\n' || src[i] === '#') {
        if (i < src.length && src[i] === '#') while (i < src.length && src[i] !== '\n') { i += 1; col += 1 }
        if (i < src.length && src[i] === '\n') { i += 1; line += 1; col = 1 }
        continue
      }
      const top = indents[indents.length - 1]
      if (indent > top) {
        indents.push(indent)
        push('INDENT', '', line, startCol)
      } else if (indent < top) {
        while (indents.length > 1 && indent < indents[indents.length - 1]) {
          indents.pop()
          push('DEDENT', '', line, startCol)
        }
        if (indents[indents.length - 1] !== indent) throw new LexError('inconsistent indentation', line, startCol)
      }
      atLineStart = false
      continue
    }

    const c = src[i]

    if (c === '\n') {
      i += 1
      if (bracket === 0) {
        // Suppress redundant blank NEWLINEs.
        if (tokens.length > 0 && tokens[tokens.length - 1].kind !== 'NEWLINE') push('NEWLINE', '')
        atLineStart = true
      }
      line += 1
      col = 1
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') { i += 1; col += 1; continue }
    if (c === '#') { while (i < src.length && src[i] !== '\n') { i += 1; col += 1 } continue }

    if (isNameStart(c)) {
      const startCol = col
      let j = i
      while (j < src.length && isNameChar(src[j])) j += 1
      const word = src.slice(i, j)
      col += j - i
      i = j
      push(KEYWORDS.has(word) ? 'KEYWORD' : 'NAME', word, line, startCol)
      continue
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      const startCol = col
      let j = i
      while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j += 1
      const num = src.slice(i, j)
      if ((num.match(/\./g) ?? []).length > 1) throw new LexError(`bad number '${num}'`, line, startCol)
      col += j - i
      i = j
      push('NUMBER', num, line, startCol)
      continue
    }

    if (c === '"' || c === "'") {
      const quote = c
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
      continue
    }

    const op = OPS.find((o) => src.startsWith(o, i))
    if (op !== undefined) {
      if (op === '(' || op === '[' || op === '{') bracket += 1
      if (op === ')' || op === ']' || op === '}') bracket = Math.max(0, bracket - 1)
      push('OP', op, line, col)
      i += op.length
      col += op.length
      continue
    }

    throw new LexError(`unexpected character '${c}'`, line, col)
  }

  if (tokens.length > 0 && tokens[tokens.length - 1].kind !== 'NEWLINE') push('NEWLINE', '')
  while (indents.length > 1) { indents.pop(); push('DEDENT', '') }
  push('EOF', '')
  return tokens
}
