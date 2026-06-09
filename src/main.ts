import './style.css'
import {
  initialState,
  step,
  ENCOUNTERS,
  type GameState,
  type Procedure,
  type Protocol,
  type State,
  type Maneuver,
  type SkillId,
  type EncounterId,
} from './sim'
import { makeHero, makeSlime } from './sprites'
import { render } from './render'
import { requireElement, require2dContext } from './dom'

// --- Rule catalog: the composed vocabulary the player picks from. -----------
// A Protocol is built from four dropdowns: Subject + Predicate (the State) and
// Command + Object (the Maneuver). The Object dropdown only shows for "Use Skill".

interface Option<T> {
  id: string
  label: string
  make: () => T
}

const SUBJECTS: Option<State['subject']>[] = [
  { id: 'self', label: 'Self', make: () => ({ who: 'self' }) },
  { id: 'ally_any', label: 'Ally · any', make: () => ({ who: 'ally', pick: 'first' }) },
  { id: 'ally_low', label: 'Ally · lowest HP', make: () => ({ who: 'ally', pick: 'lowestHp' }) },
  { id: 'enemy_near', label: 'Enemy · nearest', make: () => ({ who: 'enemy', pick: 'first' }) },
  { id: 'enemy_low', label: 'Enemy · lowest HP', make: () => ({ who: 'enemy', pick: 'lowestHp' }) },
]

const PREDICATES: Option<State['predicate']>[] = [
  { id: 'always', label: 'Always', make: () => ({ p: 'always' }) },
  { id: 'hp_lt_30', label: 'HP < 30%', make: () => ({ p: 'hpPctBelow', value: 30 }) },
  { id: 'hp_lt_50', label: 'HP < 50%', make: () => ({ p: 'hpPctBelow', value: 50 }) },
  { id: 'hp_full', label: 'HP = 100%', make: () => ({ p: 'hpFull' }) },
]

// Commands. "useSkill" carries an Object (a skill); "attack"/"flee" do not.
// "useItem" exists in the model but waits on an item system, so it is omitted here.
const COMMANDS: { id: 'attack' | 'useSkill' | 'flee'; label: string; hasObject: boolean }[] = [
  { id: 'attack', label: 'Attack', hasObject: false },
  { id: 'useSkill', label: 'Use Skill', hasObject: true },
  { id: 'flee', label: 'Flee', hasObject: false },
]

const SKILLS: { id: SkillId; label: string }[] = [
  { id: 'cure', label: 'Cure' },
  { id: 'defend', label: 'Defend' },
]

function byId<T>(list: Option<T>[], id: string): Option<T> {
  const found = list.find((o) => o.id === id)
  if (found === undefined) throw new Error(`Unknown option: ${id}`)
  return found
}

function commandById(id: string): (typeof COMMANDS)[number] {
  const found = COMMANDS.find((c) => c.id === id)
  if (found === undefined) throw new Error(`Unknown command: ${id}`)
  return found
}

function skillLabel(id: SkillId): string {
  const found = SKILLS.find((s) => s.id === id)
  return found?.label ?? id
}

// --- Editor state: per-hero rule lists (priority = order). ------------------

interface ProtocolRow {
  subjectId: string
  predId: string
  command: 'attack' | 'useSkill' | 'flee'
  skillId: SkillId // only used when command === 'useSkill'
  enabled: boolean
}

interface Hero {
  simId: string // matches the id sim.ts assigns (hero-1 = Warrior, hero-2 = Healer)
  name: string
  rows: ProtocolRow[]
}

const roster: Hero[] = [
  {
    simId: 'hero-1',
    name: 'Warrior',
    rows: [
      { subjectId: 'self', predId: 'hp_lt_30', command: 'useSkill', skillId: 'defend', enabled: true },
      { subjectId: 'enemy_near', predId: 'always', command: 'attack', skillId: 'cure', enabled: true },
    ],
  },
  {
    simId: 'hero-2',
    name: 'Healer',
    rows: [
      { subjectId: 'ally_low', predId: 'hp_lt_50', command: 'useSkill', skillId: 'cure', enabled: true },
      { subjectId: 'enemy_near', predId: 'always', command: 'attack', skillId: 'cure', enabled: true },
    ],
  },
]

let activeHero = 0

function maneuverFor(row: ProtocolRow): Maneuver {
  if (row.command === 'useSkill') return { command: 'useSkill', skill: row.skillId }
  if (row.command === 'flee') return { command: 'flee' }
  return { command: 'attack' }
}

function maneuverLabel(row: ProtocolRow): string {
  if (row.command === 'useSkill') return `Use Skill · ${skillLabel(row.skillId)}`
  return commandById(row.command).label
}

function rowToProtocol(row: ProtocolRow): Protocol {
  const subject = byId(SUBJECTS, row.subjectId)
  const pred = byId(PREDICATES, row.predId)
  return {
    state: { subject: subject.make(), predicate: pred.make() },
    maneuver: maneuverFor(row),
    label: `${subject.label} · ${pred.label} → ${maneuverLabel(row)}`,
  }
}

function procedureFor(hero: Hero): Procedure {
  return hero.rows.filter((r) => r.enabled).map(rowToProtocol)
}

// --- DOM + simulation wiring ------------------------------------------------
const canvas = requireElement('game', HTMLCanvasElement)
const ctx = require2dContext(canvas)
const encountersEl = requireElement('encounters', HTMLDivElement)
const tabsEl = requireElement('hero-tabs', HTMLDivElement)
const editorEl = requireElement('editor', HTMLUListElement)
const addBtn = requireElement('add-protocol', HTMLButtonElement)
const logEl = requireElement('log', HTMLDivElement)

const sprites = { hero: makeHero(), slime: makeSlime() }

let currentEncounter: EncounterId = 'warden'
let state: GameState = buildState()
// Maps each enabled-row index of the ACTIVE hero -> its <li>, so we can highlight
// the firing protocol without rebuilding the editor (which would clobber focus).
let enabledLis: HTMLLIElement[] = []

function buildState(): GameState {
  return initialState(procedureFor(roster[0]), procedureFor(roster[1]), currentEncounter)
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  )
}

/** Rebuild every Procedure and restart the fight so the player sees their logic. */
function commit(): void {
  state = buildState()
  renderTabs()
  renderEditor()
}

function move(i: number, dir: number): void {
  const rows = roster[activeHero].rows
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

// One editor row: Subject · Predicate → Command [· Object] + controls.
function createRow(row: ProtocolRow, i: number): HTMLLIElement {
  const rows = roster[activeHero].rows
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

  const subjSel = makeSelect(
    SUBJECTS.map((s) => ({ value: s.id, label: s.label })),
    row.subjectId,
    (v) => {
      row.subjectId = v
      commit()
    },
  )
  subjSel.title = 'Subject — who this Protocol looks at (and acts on)'

  const dot = document.createElement('span')
  dot.className = 'dot'
  dot.textContent = '·'

  const predSel = makeSelect(
    PREDICATES.map((p) => ({ value: p.id, label: p.label })),
    row.predId,
    (v) => {
      row.predId = v
      commit()
    },
  )
  predSel.title = 'Predicate — what must be true of the Subject'

  const arrow = document.createElement('span')
  arrow.className = 'arrow'
  arrow.textContent = '→'

  const cmdSel = makeSelect(
    COMMANDS.map((c) => ({ value: c.id, label: c.label })),
    row.command,
    (v) => {
      const cmd = commandById(v)
      row.command = cmd.id
      commit()
    },
  )
  cmdSel.title = 'Command — what to do'

  li.append(prio, chk, subjSel, dot, predSel, arrow, cmdSel)

  // Contextual Object dropdown: only "Use Skill" carries an Object.
  if (commandById(row.command).hasObject) {
    const objSel = makeSelect(
      SKILLS.map((s) => ({ value: s.id, label: s.label })),
      row.skillId,
      (v) => {
        const found = SKILLS.find((s) => s.id === v)
        if (found !== undefined) {
          row.skillId = found.id
          commit()
        }
      },
    )
    objSel.title = 'Object — which skill to use'
    li.append(objSel)
  }

  const up = makeButton('▲', 'Higher priority', () => move(i, -1))
  up.disabled = i === 0
  const down = makeButton('▼', 'Lower priority', () => move(i, 1))
  down.disabled = i === rows.length - 1
  const del = makeButton('✕', 'Remove protocol', () => {
    rows.splice(i, 1)
    commit()
  })
  del.className = 'del'

  li.append(up, down, del)
  return li
}

function renderEncounters(): void {
  encountersEl.replaceChildren()
  const label = document.createElement('span')
  label.className = 'enc-label'
  label.textContent = 'Encounter:'
  encountersEl.appendChild(label)
  for (const enc of ENCOUNTERS) {
    const btn = document.createElement('button')
    btn.className = enc.id === currentEncounter ? 'enc active' : 'enc'
    btn.textContent = enc.name
    btn.title = enc.hint
    btn.addEventListener('click', () => {
      if (enc.id === currentEncounter) return
      currentEncounter = enc.id
      // Restart the fight against the new enemy group — the player's Procedures
      // are untouched (this is the "same program, different wall" comparison).
      state = buildState()
      renderEncounters()
      renderEditor()
    })
    encountersEl.appendChild(btn)
  }
}

function renderTabs(): void {
  tabsEl.replaceChildren()
  roster.forEach((hero, i) => {
    const tab = document.createElement('button')
    tab.className = i === activeHero ? 'tab active' : 'tab'
    const alive = state.units.find((u) => u.id === hero.simId)
    const hp = alive ? `${Math.max(0, alive.hp)}/${alive.maxHp}` : ''
    tab.textContent = `${hero.name}  ${hp}`
    tab.addEventListener('click', () => {
      activeHero = i
      renderTabs()
      renderEditor()
    })
    tabsEl.appendChild(tab)
  })
}

// Built with DOM APIs (not innerHTML) — safe, and keeps live event handlers.
function renderEditor(): void {
  editorEl.replaceChildren()
  enabledLis = []
  roster[activeHero].rows.forEach((row, i) => {
    const li = createRow(row, i)
    editorEl.appendChild(li)
    if (row.enabled) enabledLis.push(li)
  })
}

function renderLog(): void {
  const recent = state.log.slice(-14).reverse()
  logEl.innerHTML = recent
    .map((e) => {
      const target = e.targetName !== null ? ` <span class="tgt">→ ${esc(e.targetName)}</span>` : ''
      return `<div class="entry ${e.kind}"><span class="turn">T${e.turn}</span> <span class="actor">${esc(e.actorName)}</span> <span class="rule">${esc(e.reason)}</span>${target}<div class="detail">${esc(e.detail)}</div></div>`
    })
    .join('')
}

/** Highlight the firing Protocol — but only when the ACTIVE hero just acted. */
function highlightFiringProtocol(): void {
  for (const li of enabledLis) li.classList.remove('active')
  const last = state.log.at(-1)
  if (last === undefined || last.actorId !== roster[activeHero].simId) return
  const idx = last.protocolIndex
  if (idx >= 0 && idx < enabledLis.length) enabledLis[idx].classList.add('active')
}

function frame(): void {
  render(ctx, state, sprites)
  renderLog()
  renderTabs()
  highlightFiringProtocol()
}

addBtn.addEventListener('click', () => {
  roster[activeHero].rows.push({
    subjectId: 'enemy_near',
    predId: 'always',
    command: 'attack',
    skillId: 'cure',
    enabled: true,
  })
  commit()
})

renderEncounters()
renderTabs()
renderEditor()
frame()

const ticker = setInterval(() => {
  if (state.outcome !== 'ongoing') return // battle over — pause until the player edits
  state = step(state)
  frame()
}, 450)

// Vite HMR re-runs this module on edit; without this, each hot update would stack
// another interval and the fight would race. Clear ours when the module is replaced.
if (import.meta.hot) import.meta.hot.dispose(() => clearInterval(ticker))
