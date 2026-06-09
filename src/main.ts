import './style.css'
import {
  makeWarrior,
  makeHealer,
  type Combatant,
  type GameState,
  type Procedure,
  type Protocol,
  type State,
  type Maneuver,
  type SkillId,
} from './sim'
import { startRun, stepRun, type RunState } from './run'
import { toggleMusic, setMusicState, type TrackId } from './music'
import { makeHero, makeSlime } from './sprites'
import { render, renderRunHud, renderRunEnd } from './render'
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

// --- DOM + run wiring -------------------------------------------------------
const canvas = requireElement('game', HTMLCanvasElement)
const ctx = require2dContext(canvas)
const runBarEl = requireElement('run-bar', HTMLDivElement)
const tabsEl = requireElement('hero-tabs', HTMLDivElement)
const editorEl = requireElement('editor', HTMLUListElement)
const addBtn = requireElement('add-protocol', HTMLButtonElement)
const logEl = requireElement('log', HTMLDivElement)
const musicBtn = requireElement('music-toggle', HTMLButtonElement)

musicBtn.addEventListener('click', () => {
  void toggleMusic().then((muted) => {
    musicBtn.textContent = muted ? '♪ Music: off' : '♪ Music: on'
    musicBtn.classList.toggle('on', !muted)
  })
})

const sprites = { hero: makeHero(), slime: makeSlime() }

type Mode = 'camp' | 'run'
let mode: Mode = 'camp'
let run: RunState | null = null
// The GameState currently on screen (camp preview or the run's battle),
// recomputed each frame so tabs / log / highlight read one consistent source.
let view: GameState = campState()
// Maps each enabled-row index of the ACTIVE hero -> its <li>, so we can highlight
// the firing protocol without rebuilding the editor (which would clobber focus).
let enabledLis: HTMLLIElement[] = []

// Design rule #2: a launched run is autonomous — Procedures are authored at camp.
const editingLocked = (): boolean => mode === 'run'

function party(): Combatant[] {
  return [makeWarrior(procedureFor(roster[0])), makeHealer(procedureFor(roster[1]))]
}

/** The camp screen is just the party with no enemies (render shows "Camp"). */
function campState(): GameState {
  return { units: party(), turn: 0, round: 0, cursor: -1, log: [], outcome: 'ongoing' }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  )
}

function launchRun(): void {
  run = startRun(party())
  mode = 'run'
  renderRunBar()
  renderEditor() // re-render so inputs pick up the locked state
  frame()
}

function backToCamp(): void {
  run = null
  mode = 'camp'
  renderRunBar()
  renderEditor()
  frame()
}

/** Camp-only: editing rebuilds the editor (e.g. the contextual Object dropdown)
 *  and refreshes the camp preview. A launched run is unaffected. */
function commit(): void {
  renderEditor()
  frame()
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
  const locked = editingLocked()
  const li = document.createElement('li')
  li.className = row.enabled ? 'protocol' : 'protocol disabled'

  const prio = document.createElement('span')
  prio.className = 'prio'
  prio.textContent = String(i + 1)

  const chk = document.createElement('input')
  chk.type = 'checkbox'
  chk.checked = row.enabled
  chk.disabled = locked
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
  subjSel.disabled = locked

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
  predSel.disabled = locked

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
  cmdSel.disabled = locked

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
    objSel.disabled = locked
    li.append(objSel)
  }

  const up = makeButton('▲', 'Higher priority', () => move(i, -1))
  up.disabled = locked || i === 0
  const down = makeButton('▼', 'Lower priority', () => move(i, 1))
  down.disabled = locked || i === rows.length - 1
  const del = makeButton('✕', 'Remove protocol', () => {
    rows.splice(i, 1)
    commit()
  })
  del.className = 'del'
  del.disabled = locked

  li.append(up, down, del)
  return li
}

function makeHint(text: string): HTMLSpanElement {
  const hint = document.createElement('span')
  hint.className = 'run-hint'
  hint.textContent = text
  return hint
}

// The run-control bar: launch at camp, abandon during a run, back-to-camp at the end.
function renderRunBar(): void {
  runBarEl.replaceChildren()
  if (mode === 'camp') {
    const launch = makeButton('▶ Launch run', 'Send your party on an autonomous run', launchRun)
    launch.className = 'run-launch'
    runBarEl.append(launch, makeHint('Gauntlet: Two Slimes → Slime Pack → Hex Warden'))
  } else if (run !== null && run.status === 'fighting') {
    const abandon = makeButton('✕ Abandon run', 'Give up and return to camp', backToCamp)
    abandon.className = 'run-abandon'
    runBarEl.append(abandon, makeHint('Run in progress — editing locked (no rescue)'))
  } else {
    const back = makeButton('↩ Back to camp', 'Return to camp to revise your Procedures', backToCamp)
    back.className = 'run-launch'
    const msg = run?.status === 'cleared' ? 'Run cleared!' : 'Run over — read the journal below'
    runBarEl.append(back, makeHint(msg))
  }
}

function renderTabs(): void {
  tabsEl.replaceChildren()
  roster.forEach((hero, i) => {
    const tab = document.createElement('button')
    tab.className = i === activeHero ? 'tab active' : 'tab'
    const unit = view.units.find((u) => u.id === hero.simId)
    const hp = unit ? `${Math.max(0, unit.hp)}/${unit.maxHp}` : ''
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
  addBtn.disabled = editingLocked()
  editorEl.replaceChildren()
  enabledLis = []
  roster[activeHero].rows.forEach((row, i) => {
    const li = createRow(row, i)
    editorEl.appendChild(li)
    if (row.enabled) enabledLis.push(li)
  })
}

function renderLog(): void {
  const recent = view.log.slice(-14).reverse()
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
  const last = view.log.at(-1)
  if (last === undefined || last.actorId !== roster[activeHero].simId) return
  const idx = last.protocolIndex
  if (idx >= 0 && idx < enabledLis.length) enabledLis[idx].classList.add('active')
}

/** Which theme the game wants right now: camp / run / boss (the Hex Warden). */
function musicTrack(): TrackId {
  if (mode === 'camp' || run === null) return 'camp'
  return run.gauntlet[run.depth] === 'warden' ? 'boss' : 'run'
}

function frame(): void {
  view = mode === 'camp' ? campState() : (run?.battle ?? campState())
  render(ctx, view, sprites)
  if (mode === 'run' && run !== null) {
    renderRunHud(ctx, run.depth, run.gauntlet.length)
    if (run.status !== 'fighting') renderRunEnd(ctx, run.status)
  }
  renderLog()
  renderTabs()
  highlightFiringProtocol()
  setMusicState(musicTrack()) // cheap no-op unless the track should change
}

addBtn.addEventListener('click', () => {
  if (editingLocked()) return
  roster[activeHero].rows.push({
    subjectId: 'enemy_near',
    predId: 'always',
    command: 'attack',
    skillId: 'cure',
    enabled: true,
  })
  commit()
})

renderRunBar()
renderTabs()
renderEditor()
frame()

const ticker = setInterval(() => {
  if (mode !== 'run' || run === null || run.status !== 'fighting') return
  run = stepRun(run)
  frame()
  if (run.status !== 'fighting') renderRunBar() // surface "Back to camp"
}, 450)

// Vite HMR re-runs this module on edit; without this, each hot update would stack
// another interval and the fight would race. Clear ours when the module is replaced.
if (import.meta.hot) import.meta.hot.dispose(() => clearInterval(ticker))
