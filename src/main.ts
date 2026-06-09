import './style.css'
import { initialState, step, type GameState, type Procedure, type Condition, type ActionKind } from './sim'
import { makeHero, makeSlime } from './sprites'
import { render } from './render'
import { requireElement, require2dContext } from './dom'

// --- Rule catalog: the vocabulary the player can pick from in the editor. ---
interface ConditionOption {
  id: string
  label: string
  make: () => Condition
}

const CONDITIONS: ConditionOption[] = [
  { id: 'self_lt_30', label: 'Self HP < 30%', make: () => ({ kind: 'selfHpPctBelow', value: 30 }) },
  { id: 'self_lt_50', label: 'Self HP < 50%', make: () => ({ kind: 'selfHpPctBelow', value: 50 }) },
  { id: 'enemy_lt_30', label: 'Enemy HP < 30%', make: () => ({ kind: 'enemyHpPctBelow', value: 30 }) },
  { id: 'self_full', label: 'Self HP = 100%', make: () => ({ kind: 'selfHpFull' }) },
  { id: 'always', label: 'Always', make: () => ({ kind: 'always' }) },
]

interface ActionOption {
  id: ActionKind
  label: string
}

const ACTIONS: ActionOption[] = [
  { id: 'attack', label: 'Attack' },
  { id: 'heal', label: 'Heal' },
  { id: 'defend', label: 'Defend' },
]

function actionLabel(id: ActionKind): string {
  const found = ACTIONS.find((a) => a.id === id)
  if (found === undefined) throw new Error(`Unknown action: ${id}`)
  return found.label
}

function conditionById(id: string): ConditionOption {
  const found = CONDITIONS.find((c) => c.id === id)
  if (found === undefined) throw new Error(`Unknown condition: ${id}`)
  return found
}

// --- Editor state: the player's protocol list (priority = order). ---
interface ProtocolRow {
  condId: string
  action: ActionKind
  enabled: boolean
}

let rows: ProtocolRow[] = [
  { condId: 'self_lt_30', action: 'heal', enabled: true },
  { condId: 'always', action: 'attack', enabled: true },
]

function buildProcedure(): Procedure {
  return rows
    .filter((r) => r.enabled)
    .map((r) => {
      const c = conditionById(r.condId)
      return { condition: c.make(), action: r.action, label: `${c.label} → ${actionLabel(r.action)}` }
    })
}

// --- DOM + simulation wiring ---
const canvas = requireElement('game', HTMLCanvasElement)
const ctx = require2dContext(canvas)
const editorEl = requireElement('editor', HTMLUListElement)
const addBtn = requireElement('add-protocol', HTMLButtonElement)
const logEl = requireElement('log', HTMLDivElement)

const sprites = { hero: makeHero(), slime: makeSlime() }

let procedure: Procedure = buildProcedure()
let state: GameState = initialState()
// Maps each enabled-row index -> its <li>, so we can highlight the firing protocol
// each frame without rebuilding the editor (which would clobber dropdown focus).
let enabledLis: HTMLLIElement[] = []

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  )
}

/** Rebuild the procedure and restart the fight so the player sees their new logic. */
function commit(): void {
  procedure = buildProcedure()
  state = initialState()
  renderEditor()
}

function move(i: number, dir: number): void {
  const j = i + dir
  if (j < 0 || j >= rows.length) return
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  commit()
}

function makeSelect(
  options: { value: string; label: string }[],
  selected: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const sel = document.createElement('select')
  for (const opt of options) {
    const o = document.createElement('option')
    o.value = opt.value
    o.textContent = opt.label
    if (opt.value === selected) o.selected = true
    sel.appendChild(o)
  }
  sel.addEventListener('change', () => onChange(sel.value))
  return sel
}

function makeButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.title = title
  btn.addEventListener('click', onClick)
  return btn
}

// One editor row for a single protocol. Extracted so renderEditor stays small.
function createRow(row: ProtocolRow, i: number): HTMLLIElement {
  const li = document.createElement('li')
  li.className = row.enabled ? 'protocol' : 'protocol disabled'

  const prio = document.createElement('span')
  prio.className = 'prio'
  prio.textContent = String(i + 1)

  const chk = document.createElement('input')
  chk.type = 'checkbox'
  chk.checked = row.enabled
  chk.title = 'Enable / disable this protocol'
  chk.addEventListener('change', () => {
    row.enabled = chk.checked
    commit()
  })

  const condSel = makeSelect(
    CONDITIONS.map((c) => ({ value: c.id, label: c.label })),
    row.condId,
    (value) => {
      row.condId = value
      commit()
    },
  )

  const arrow = document.createElement('span')
  arrow.className = 'arrow'
  arrow.textContent = '→'

  const actSel = makeSelect(
    ACTIONS.map((a) => ({ value: a.id, label: a.label })),
    row.action,
    (value) => {
      const found = ACTIONS.find((a) => a.id === value)
      if (found !== undefined) {
        row.action = found.id
        commit()
      }
    },
  )

  const up = makeButton('▲', 'Higher priority', () => move(i, -1))
  up.disabled = i === 0
  const down = makeButton('▼', 'Lower priority', () => move(i, 1))
  down.disabled = i === rows.length - 1
  const del = makeButton('✕', 'Remove protocol', () => {
    rows.splice(i, 1)
    commit()
  })
  del.className = 'del'

  li.append(prio, chk, condSel, arrow, actSel, up, down, del)
  return li
}

// Built with DOM APIs (not innerHTML) — safe, and keeps live event handlers.
function renderEditor(): void {
  editorEl.replaceChildren()
  enabledLis = []
  rows.forEach((row, i) => {
    const li = createRow(row, i)
    editorEl.appendChild(li)
    if (row.enabled) enabledLis.push(li)
  })
}

function renderLog(): void {
  const recent = state.log.slice(-13).reverse()
  logEl.innerHTML = recent
    .map((e) => {
      const cls = e.decision.action
      return `<div class="entry ${cls}"><span class="turn">T${e.turn}</span> <span class="rule">${esc(e.decision.reason)}</span><div class="detail">${esc(e.detail)}</div></div>`
    })
    .join('')
}

function highlightFiringProtocol(): void {
  for (const li of enabledLis) li.classList.remove('active')
  const idx = state.log.at(-1)?.decision.ruleIndex
  if (idx !== undefined && idx >= 0 && idx < enabledLis.length) {
    enabledLis[idx].classList.add('active')
  }
}

function frame(): void {
  render(ctx, state, sprites)
  renderLog()
  highlightFiringProtocol()
}

addBtn.addEventListener('click', () => {
  rows.push({ condId: 'always', action: 'attack', enabled: true })
  commit()
})

renderEditor()
frame()

setInterval(() => {
  if (state.hero.hp <= 0) return // defeated — pause until the player edits protocols
  state = step(state, procedure)
  frame()
}, 500)
