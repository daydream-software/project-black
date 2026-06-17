// The CodeMirror 6 implementation of CodeEditorHandle (piste A) — highlighting +
// autocomplete + lint squiggles. Lazy-loaded (dynamic import in main.ts) so CM stays
// off the first-paint bundle (CLAUDE.md's scoped dependency exception). The
// language-aware parts — a stream highlighter from the keyword set, a CompletionSource
// over the unlocked namespace, and a linter from checkProgram — are ours; CM is the shell.

import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { StreamLanguage, HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language'
import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { linter, type Diagnostic } from '@codemirror/lint'
import { tags } from '@lezer/highlight'
import { SKILLS_BY_ID } from '../content/skills'
import { checkProgram } from './check'
import { unlocked } from './gate'
import type { CodeEditorHandle } from './editor'

const KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'and', 'or', 'not',
  'None', 'True', 'False', 'break', 'continue', 'pass', 'global', 'import', 'Engram',
])
const BUILTINS = new Set(['len', 'set', 'record', 'attack', 'use', 'flee', 'wait', 'move', 'rest', 'retreat', 'leave', 'explore'])

// --- Highlighting: a tiny stream tokenizer (mirrors the lexer's categories) ---
// CodeMirror's `stream.match` returns `string[] | boolean | null`; `matched` reduces it
// to a plain boolean so the conditions are well-typed.
function matched(r: string[] | boolean | null): boolean {
  return r !== null && r !== false
}
const inscription = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.eat('#') !== undefined) { stream.skipToEnd(); return 'comment' }
    if (matched(stream.match(/^[0-9]+(?:\.[0-9]+)?/u))) return 'number'
    if (matched(stream.match(/^"(?:[^"\\]|\\.)*"/u)) || matched(stream.match(/^'(?:[^'\\]|\\.)*'/u))) return 'string'
    if (matched(stream.match(/^[A-Za-z_]\w*/u))) {
      const w = stream.current()
      if (KEYWORDS.has(w)) return 'keyword'
      if (BUILTINS.has(w)) return 'operatorKeyword' // builtins (attack/use/move/…)
      if (/^[A-Z]/u.test(w)) return 'typeName' // Skills / RoomType enums
      return 'variableName'
    }
    stream.next()
    return null
  },
})

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#7fb3ff' },
  { tag: tags.operatorKeyword, color: '#7fe0d0' },
  { tag: tags.string, color: '#a3e6a3' },
  { tag: tags.number, color: '#ffcf8f' },
  { tag: tags.comment, color: '#6a7886', fontStyle: 'italic' },
  { tag: tags.typeName, color: '#d6b4ff' },
  { tag: tags.variableName, color: '#e6eef2' },
])

// --- Autocomplete: a small schema of the host namespace ----------------------
const MEMBERS = {
  unit: ['hp', 'max_hp', 'hp_pct', 'name', 'is_boss', 'defending', 'might', 'ward', 'fortitude', 'attunement', 'poise', 'celerity'],
  collection: ['lowest_hp', 'highest_hp', 'first'],
  room: ['sigil', 'type', 'cleared', 'resolved', 'is_objective'],
  exit: ['beyond', 'leads_to', 'explored'],
  memory: ['setdefault', 'get', 'pop', 'update', 'keys'],
  roomType: ['Entrance', 'Fight', 'Loot', 'Buff', 'Boss'],
}
// Only OFFER skills the player has unlocked (the linter is the real gate; this is polish).
const skillMembers = (): string[] =>
  [...SKILLS_BY_ID].filter(([, def]) => def.unlock === undefined || unlocked().has(def.unlock))
    .map(([id]) => id.charAt(0).toUpperCase() + id.slice(1))

// Gated keywords → their feature-unlock id (omitted from autocomplete until unlocked).
const KEYWORD_GATE: Record<string, string> = {
  if: 'lang-if', elif: 'lang-if', else: 'lang-if', for: 'lang-loops', while: 'lang-loops',
  def: 'lang-def', import: 'lang-import',
}

function globalsFor(kind: 'combat' | 'exploration'): string[] {
  const shared = ['len', 'set', 'record', 'wait', 'Memory', 'True', 'False', 'None']
  return kind === 'combat'
    ? ['me', 'senses', 'attack', 'use', 'flee', 'Skills', ...shared]
    : ['senses', 'party', 'explore', 'move', 'rest', 'retreat', 'leave', 'RoomType', ...shared]
}

/** Resolve a dotted chain (already-typed roots) to the member list to offer. */
function membersFor(chain: string[], kind: 'combat' | 'exploration'): string[] | null {
  if (chain.length === 1) {
    switch (chain[0]) {
      case 'me': return MEMBERS.unit
      case 'senses': return kind === 'combat' ? ['allies', 'enemies', 'alone'] : ['exits', 'room', 'unexplored_exit']
      case 'party': return ['hp_pct']
      case 'Memory': return MEMBERS.memory
      case 'Skills': return skillMembers()
      case 'RoomType': return MEMBERS.roomType
      default: return [...MEMBERS.unit, ...MEMBERS.collection, ...MEMBERS.room, ...MEMBERS.exit]
    }
  }
  if (chain.length === 2 && chain[0] === 'senses') {
    if (chain[1] === 'allies' || chain[1] === 'enemies') return MEMBERS.collection
    if (chain[1] === 'room') return MEMBERS.room
    if (chain[1] === 'unexplored_exit') return MEMBERS.exit
  }
  return [...MEMBERS.unit, ...MEMBERS.collection, ...MEMBERS.room, ...MEMBERS.exit]
}

interface MatchToken { from: number; to: number; text: string }

/** Completions for a `a.b.member` chain (the segment after the last dot); null when the
 *  chain's type is unknown. */
function memberCompletion(token: MatchToken, kind: 'combat' | 'exploration'): CompletionResult | null {
  const parts = token.text.split('.')
  const member = parts.pop() ?? ''
  const opts = membersFor(parts, kind)
  if (opts === null) return null
  return {
    from: token.to - member.length,
    options: opts.map((label) => ({ label, type: 'property' })),
    validFor: /\w*/u,
  }
}

function makeCompletions(kind: 'combat' | 'exploration') {
  return (ctx: CompletionContext): CompletionResult | null => {
    // Computed per-call so newly-bought unlocks appear without a re-mount.
    const u = unlocked()
    const keywordOpts = [...KEYWORDS]
      .filter((k) => !(k in KEYWORD_GATE) || u.has(KEYWORD_GATE[k]))
      .map((label) => ({ label, type: 'keyword' }))
    const token = ctx.matchBefore(/[\w.]+/u)
    if (token === null) {
      if (!ctx.explicit) return null
    } else if (token.text.includes('.')) {
      return memberCompletion(token, kind)
    }
    return {
      from: token?.from ?? ctx.pos,
      options: [...globalsFor(kind).map((label) => ({ label, type: 'variable' })), ...keywordOpts],
      validFor: /\w*/u,
    }
  }
}

// --- Linter: compile-time check → an inline diagnostic -----------------------
function makeLinter(entry: string | null): Extension {
  return linter((view): Diagnostic[] => {
    const r = checkProgram(view.state.doc.toString(), entry)
    if (r.ok) return []
    const lineNo = Math.min(Math.max(1, r.line ?? 1), view.state.doc.lines)
    const lineInfo = view.state.doc.line(lineNo)
    const from = Math.min(lineInfo.from + Math.max(0, (r.col ?? 1) - 1), lineInfo.to)
    return [{ from, to: Math.min(from + 1, lineInfo.to + 1), severity: 'error', message: r.message ?? 'error' }]
  })
}

const theme = EditorView.theme({
  '&': { backgroundColor: '#0c1116', color: '#e6eef2', fontSize: '13px', borderRadius: '8px' },
  '.cm-content': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', caretColor: '#e6eef2' },
  '.cm-gutters': { backgroundColor: '#0c1116', color: '#566270', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(63, 125, 140, 0.08)' },
  '&.cm-focused': { outline: 'none' },
}, { dark: true })

export interface CmOptions {
  entry: string | null
  kind: 'combat' | 'exploration'
  placeholder?: string
}

/** Mount a CodeMirror editor exposing the SAME handle as the textarea fallback. */
export function mountCodeMirror(
  parent: HTMLElement,
  errorEl: HTMLElement,
  onChange: (src: string) => void,
  opts: CmOptions,
): CodeEditorHandle {
  parent.replaceChildren()
  const editable = new Compartment()
  let programmatic = false

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        indentUnit.of('    '),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        inscription,
        syntaxHighlighting(highlight),
        autocompletion({ override: [makeCompletions(opts.kind)] }),
        makeLinter(opts.entry),
        theme,
        cmPlaceholder(opts.placeholder ?? ''),
        editable.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
        EditorView.updateListener.of((u) => { if (u.docChanged && !programmatic) onChange(u.state.doc.toString()) }),
      ],
    }),
  })

  return {
    getValue: () => view.state.doc.toString(),
    setValue(src) {
      if (view.state.doc.toString() === src) return
      programmatic = true
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
      programmatic = false
    },
    setReadOnly(ro) {
      view.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]) })
    },
    setError(err) {
      const errBox = errorEl // a const alias: configuring the passed error element is the job
      if (err === null) { errBox.hidden = true; errBox.textContent = ''; return }
      const col = err.col === undefined ? '' : `, col ${err.col}`
      const where = err.line === undefined ? '' : ` (line ${err.line}${col})`
      errBox.hidden = false
      errBox.textContent = `⚠ ${err.message}${where}`
    },
  }
}
