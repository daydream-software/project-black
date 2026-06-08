import './style.css'
import { initialState, step, type GameState, type Program, type Condition, type ActionKind } from './sim'
import { makeHero, makeSlime } from './sprites'
import { render } from './render'

// --- Gambit catalog: the vocabulary the player can pick from in the editor. ---
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

const ACTIONS: { id: ActionKind; label: string }[] = [
  { id: 'attack', label: 'Attack' },
  { id: 'heal', label: 'Heal' },
  { id: 'defend', label: 'Defend' },
]

const actionLabel = (a: ActionKind) => ACTIONS.find((x) => x.id === a)!.label
const conditionById = (id: string) => CONDITIONS.find((c) => c.id === id)!

// --- Editor state: the player's gambit list (priority = order). ---
interface GambitRow {
  condId: string
  action: ActionKind
  enabled: boolean
}

let rows: GambitRow[] = [
  { condId: 'self_lt_30', action: 'heal', enabled: true },
  { condId: 'always', action: 'attack', enabled: true },
]

function buildProgram(): Program {
  return rows
    .filter((r) => r.enabled)
    .map((r) => {
      const c = conditionById(r.condId)
      return { condition: c.make(), action: r.action, label: `${c.label} → ${actionLabel(r.action)}` }
    })
}

// --- DOM + simulation wiring ---
const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const editorEl = document.getElementById('editor') as HTMLUListElement
const addBtn = document.getElementById('add-gambit') as HTMLButtonElement
const logEl = document.getElementById('log') as HTMLDivElement

const sprites = { hero: makeHero(), slime: makeSlime() }

let program: Program = buildProgram()
let state: GameState = initialState()
// Maps each enabled-row index -> its <li>, so we can highlight the firing gambit
// each frame without rebuilding the editor (which would clobber dropdown focus).
let enabledLis: HTMLLIElement[] = []

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  )
}

/** Rebuild the program and restart the fight so the player sees their new logic. */
function commit() {
  program = buildProgram()
  state = initialState()
  renderEditor()
}

function move(i: number, dir: number) {
  const j = i + dir
  if (j < 0 || j >= rows.length) return
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  commit()
}

function makeSelect(options: { value: string; label: string }[], selected: string, onChange: (v: string) => void) {
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

// Built with DOM APIs (not innerHTML) — safe, and keeps live event handlers.
function renderEditor() {
  editorEl.replaceChildren()
  enabledLis = []
  rows.forEach((row, i) => {
    const li = document.createElement('li')
    li.className = 'gambit' + (row.enabled ? '' : ' disabled')

    const prio = document.createElement('span')
    prio.className = 'prio'
    prio.textContent = String(i + 1)

    const chk = document.createElement('input')
    chk.type = 'checkbox'
    chk.checked = row.enabled
    chk.title = 'Enable / disable this gambit'
    chk.addEventListener('change', () => {
      row.enabled = chk.checked
      commit()
    })

    const condSel = makeSelect(
      CONDITIONS.map((c) => ({ value: c.id, label: c.label })),
      row.condId,
      (v) => {
        row.condId = v
        commit()
      },
    )

    const arrow = document.createElement('span')
    arrow.className = 'arrow'
    arrow.textContent = '→'

    const actSel = makeSelect(
      ACTIONS.map((a) => ({ value: a.id, label: a.label })),
      row.action,
      (v) => {
        row.action = v as ActionKind
        commit()
      },
    )

    const up = document.createElement('button')
    up.textContent = '▲'
    up.title = 'Higher priority'
    up.disabled = i === 0
    up.addEventListener('click', () => move(i, -1))

    const down = document.createElement('button')
    down.textContent = '▼'
    down.title = 'Lower priority'
    down.disabled = i === rows.length - 1
    down.addEventListener('click', () => move(i, 1))

    const del = document.createElement('button')
    del.textContent = '✕'
    del.title = 'Remove gambit'
    del.className = 'del'
    del.addEventListener('click', () => {
      rows.splice(i, 1)
      commit()
    })

    li.append(prio, chk, condSel, arrow, actSel, up, down, del)
    editorEl.appendChild(li)
    if (row.enabled) enabledLis.push(li)
  })
}

function renderLog() {
  const recent = state.log.slice(-13).reverse()
  logEl.innerHTML = recent
    .map((e) => {
      const cls = e.decision.action
      return `<div class="entry ${cls}"><span class="turn">T${e.turn}</span> <span class="rule">${esc(e.decision.reason)}</span><div class="detail">${esc(e.detail)}</div></div>`
    })
    .join('')
}

function highlightFiringGambit() {
  for (const li of enabledLis) li.classList.remove('active')
  const idx = state.log.at(-1)?.decision.ruleIndex
  if (idx !== undefined && idx >= 0 && idx < enabledLis.length) {
    enabledLis[idx].classList.add('active')
  }
}

function frame() {
  render(ctx, state, sprites)
  renderLog()
  highlightFiringGambit()
}

addBtn.addEventListener('click', () => {
  rows.push({ condId: 'always', action: 'attack', enabled: true })
  commit()
})

renderEditor()
frame()

setInterval(() => {
  if (state.hero.hp <= 0) return // defeated — pause until the player edits gambits
  state = step(state, program)
  frame()
}, 500)
