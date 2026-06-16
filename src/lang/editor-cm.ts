// The CodeMirror 6 implementation of CodeEditorHandle (piste A) — highlighting +
// autocomplete + lint squiggles. Lazy-loaded (dynamic import in main.ts) so CM stays
// off the first-paint bundle (CLAUDE.md's scoped dependency exception). The
// language-aware parts — a stream highlighter from the keyword set, a CompletionSource
// over the unlocked namespace, and a linter from checkProgram — are ours; CM is the shell.

import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { StreamLanguage, HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language'
import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { linter, type Diagnostic } from '@codemirror/lint'
import { tags } from '@lezer/highlight'
import { SKILLS_BY_ID } from '../content/skills'
import { checkProgram } from './check'
import type { CodeEditorHandle } from './editor'

const KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'and', 'or', 'not',
  'None', 'True', 'False', 'break', 'continue', 'pass', 'global', 'import',
])
const BUILTINS = new Set(['len', 'set', 'print', 'attack', 'use', 'flee', 'wait', 'move', 'rest', 'retreat', 'leave'])

// --- Highlighting: a tiny stream tokenizer (mirrors the lexer's categories) ---
const inscription = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match('#')) { stream.skipToEnd(); return 'comment' }
    if (stream.match(/^[0-9]+(\.[0-9]+)?/)) return 'number'
    if (stream.match(/^"([^"\\]|\\.)*"/) || stream.match(/^'([^'\\]|\\.)*'/)) return 'string'
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const w = stream.current()
      if (KEYWORDS.has(w)) return 'keyword'
      if (BUILTINS.has(w)) return 'operatorKeyword' // builtins (attack/use/move/…)
      if (/^[A-Z]/.test(w)) return 'typeName' // Skills / RoomType enums
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
const skillMembers = (): string[] => [...SKILLS_BY_ID.keys()].map((id) => id.charAt(0).toUpperCase() + id.slice(1))

function globalsFor(kind: 'combat' | 'exploration'): string[] {
  const shared = ['len', 'set', 'print', 'wait', 'Memory', 'True', 'False', 'None']
  return kind === 'combat'
    ? ['me', 'senses', 'attack', 'use', 'flee', 'Skills', ...shared]
    : ['senses', 'party', 'move', 'rest', 'retreat', 'leave', 'RoomType', ...shared]
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

function makeCompletions(kind: 'combat' | 'exploration') {
  const keywordOpts = [...KEYWORDS].map((label) => ({ label, type: 'keyword' }))
  return (ctx: CompletionContext): CompletionResult | null => {
    const token = ctx.matchBefore(/[\w.]+/)
    const text = token?.text ?? ''
    if (text.includes('.')) {
      const parts = text.split('.')
      const member = parts.pop() ?? ''
      const opts = membersFor(parts, kind)
      if (opts === null) return null
      return {
        from: (token as { to: number }).to - member.length,
        options: opts.map((label) => ({ label, type: 'property' })),
        validFor: /\w*/,
      }
    }
    if (token === null && !ctx.explicit) return null
    return {
      from: token?.from ?? ctx.pos,
      options: [...globalsFor(kind).map((label) => ({ label, type: 'variable' })), ...keywordOpts],
      validFor: /\w*/,
    }
  }
}

// --- Linter: compile-time check → an inline diagnostic -----------------------
function makeLinter(entry: string | null) {
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
      if (err === null) { errorEl.hidden = true; errorEl.textContent = ''; return }
      const where = err.line !== undefined ? ` (line ${err.line}${err.col !== undefined ? `, col ${err.col}` : ''})` : ''
      errorEl.hidden = false
      errorEl.textContent = `⚠ ${err.message}${where}`
    },
  }
}
