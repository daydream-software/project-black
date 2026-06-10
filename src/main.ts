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
import { startDelve, stepDelve, catchUpDelve, type DelveState, type ExProtocol } from './delve'
import { toggleMusic, setMusicState, type TrackId } from './music'
import { saveGame, loadGame, elapsedSteps, type Hero, type ProtocolRow, type ExProtocolRow } from './save'
import { makeHero, makeHeroBack, makeSlime } from './sprites'
import { render, renderDelve } from './render'
import { requireElement, require2dContext } from './dom'
import {
  byId,
  buildExploration,
  EX_SUBJECTS,
  EX_PREDICATES,
  EX_MOVES,
  DEFAULT_EX_ROWS,
  type Option,
} from './protocol'

// --- Rule catalog: the composed vocabulary the player picks from. -----------
// A Protocol is built from four dropdowns: Subject + Predicate (the State) and
// Command + Object (the Maneuver). The Object dropdown only shows for "Use Skill".
// The pure row→model compiler (+ the exploration catalogs) lives in protocol.ts.

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
// ProtocolRow / Hero are defined in save.ts (they're the persisted schema).
// `roster` is `let` so a loaded save can replace it on startup.

let roster: Hero[] = [
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

// The party-wide exploration Protocol rows (priority = order). `let` so a loaded
// save can replace it; the defaults (protocol.ts) compile to DEFAULT_EXPLORATION.
let exploration: ExProtocolRow[] = DEFAULT_EX_ROWS.map((r) => ({ ...r }))

/** The live exploration Protocol fed to a delve (enabled rows, in priority order). */
function explorationProtocol(): ExProtocol {
  return buildExploration(exploration)
}

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
const exEditorEl = requireElement('ex-editor', HTMLUListElement)
const exAddBtn = requireElement('ex-add', HTMLButtonElement)
const logEl = requireElement('log', HTMLDivElement)
const musicBtn = requireElement('music-toggle', HTMLButtonElement)

musicBtn.addEventListener('click', () => {
  void toggleMusic().then((muted) => {
    musicBtn.textContent = muted ? '♪ Music: off' : '♪ Music: on'
    musicBtn.classList.toggle('on', !muted)
  })
})

const sprites = { hero: makeHero(), heroBack: makeHeroBack(), slime: makeSlime() }

type Mode = 'camp' | 'delve'
let mode: Mode = 'camp'
let delve: DelveState | null = null
// Maps each enabled-row index of the ACTIVE hero -> its <li>, so we can highlight
// the firing protocol without rebuilding the editor (which would clobber focus).
let enabledLis: HTMLLIElement[] = []

// Design rule #2: a launched delve is autonomous — Procedures are authored in town.
const editingLocked = (): boolean => mode !== 'camp'

function party(): Combatant[] {
  return [makeWarrior(procedureFor(roster[0])), makeHealer(procedureFor(roster[1]))]
}

/** The town screen is just the party with no enemies (render shows "Camp"). */
function campState(): GameState {
  return { units: party(), turn: 0, round: 0, cursor: -1, log: [], outcome: 'ongoing' }
}

/** The hero units to show in the tabs: live combat units, else the delve party, else town. */
function partyUnits(): Combatant[] {
  if (delve === null) return campState().units
  if (delve.battle !== null) return delve.battle.units.filter((u) => u.side === 'hero')
  return delve.party
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  )
}

/** A fresh 32-bit seed for a delve (the impure shell may use Math.random). */
function newSeed(): number {
  return (Math.random() * 0x100000000) | 0
}

function descend(): void {
  delve = startDelve(party(), newSeed(), explorationProtocol())
  mode = 'delve'
  saveNow()
  renderRunBar()
  renderEditor() // re-render so inputs pick up the locked state
  renderExEditor()
  frame()
}

function backToTown(): void {
  delve = null
  mode = 'camp'
  saveNow()
  renderRunBar()
  renderEditor()
  renderExEditor()
  frame()
}

/** Persist the whole state, stamped with the current time (for offline catch-up). */
function saveNow(): void {
  saveGame({ roster, activeHero, exploration, mode, delve })
}

/**
 * Restore from localStorage on startup. If a delve was in progress when we last
 * saved, fast-forward it by the elapsed wall-clock (offline progress) — a delve
 * that ended while away lands on its CLEARED / WIPED screen so the player can
 * read the journal (Design rule #1). A bad/missing save is ignored.
 */
function restore(): void {
  const saved = loadGame()
  if (saved === null) return
  roster = saved.roster
  activeHero = Math.max(0, Math.min(saved.activeHero, roster.length - 1))
  if (saved.exploration !== undefined) exploration = saved.exploration // pre-8c saves default it
  if (saved.delve !== null) {
    delve = catchUpDelve(saved.delve, elapsedSteps(saved.savedAt, Date.now()))
    mode = 'delve'
  } else {
    delve = null
    mode = 'camp'
  }
}

/** Camp-only: editing rebuilds the editor (e.g. the contextual Object dropdown)
 *  and refreshes the camp preview. A launched run is unaffected. */
function commit(): void {
  renderEditor()
  renderExEditor()
  frame()
  saveNow()
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

// The delve-control bar: descend in town, abandon mid-delve, back-to-town at the end.
function renderRunBar(): void {
  runBarEl.replaceChildren()
  if (mode === 'camp' || delve === null) {
    const launch = makeButton('▶ Descend', 'Send your party delving into a procedural dungeon', descend)
    launch.className = 'run-launch'
    runBarEl.append(launch, makeHint('A seeded dungeon — they explore, fight and hunt the objective on their own'))
  } else if (delve.status === 'delving') {
    const abandon = makeButton('✕ Abandon delve', 'Give up and return to town', backToTown)
    abandon.className = 'run-abandon'
    runBarEl.append(abandon, makeHint(`Delving — editing locked · seed ${delve.seed}`))
  } else {
    const back = makeButton('↩ Back to town', 'Return to town to revise your Procedures', backToTown)
    back.className = 'run-launch'
    const msg =
      delve.status === 'cleared'
        ? 'Delve cleared!'
        : delve.status === 'stuck'
          ? 'The delve got stuck — read the journal'
          : 'The party was wiped — read the journal'
    runBarEl.append(back, makeHint(msg))
  }
}

function renderTabs(): void {
  tabsEl.replaceChildren()
  const units = partyUnits()
  roster.forEach((hero, i) => {
    const tab = document.createElement('button')
    tab.className = i === activeHero ? 'tab active' : 'tab'
    const unit = units.find((u) => u.id === hero.simId)
    const hp = unit ? `${Math.max(0, unit.hp)}/${unit.maxHp}` : ''
    tab.textContent = `${hero.name}  ${hp}`
    tab.addEventListener('click', () => {
      activeHero = i
      renderTabs()
      renderEditor()
      saveNow()
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

// One exploration editor row: Subject · Predicate → Move + controls. Party-wide
// (no hero tabs); reuses the .protocol styling and the makeSelect/makeButton helpers.
function createExRow(row: ExProtocolRow, i: number): HTMLLIElement {
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
  chk.title = 'Enable / disable this exploration Protocol'
  chk.addEventListener('change', () => {
    row.enabled = chk.checked
    commit()
  })

  const subjSel = makeSelect(
    EX_SUBJECTS.map((s) => ({ value: s.id, label: s.label })),
    row.subjectId,
    (v) => {
      row.subjectId = v
      commit()
    },
  )
  subjSel.title = 'Subject — what in the dungeon this rule looks at'
  subjSel.disabled = locked

  const dot = document.createElement('span')
  dot.className = 'dot'
  dot.textContent = '·'

  const predSel = makeSelect(
    EX_PREDICATES.map((p) => ({ value: p.id, label: p.label })),
    row.predId,
    (v) => {
      row.predId = v
      commit()
    },
  )
  predSel.title = 'Predicate — what must be true'
  predSel.disabled = locked

  const arrow = document.createElement('span')
  arrow.className = 'arrow'
  arrow.textContent = '→'

  const moveSel = makeSelect(
    EX_MOVES.map((m) => ({ value: m.id, label: m.label })),
    row.moveId,
    (v) => {
      row.moveId = v
      commit()
    },
  )
  moveSel.title = 'Move — what the party does'
  moveSel.disabled = locked

  li.append(prio, chk, subjSel, dot, predSel, arrow, moveSel)

  const up = makeButton('▲', 'Higher priority', () => exMove(i, -1))
  up.disabled = locked || i === 0
  const down = makeButton('▼', 'Lower priority', () => exMove(i, 1))
  down.disabled = locked || i === exploration.length - 1
  const del = makeButton('✕', 'Remove exploration Protocol', () => {
    exploration.splice(i, 1)
    commit()
  })
  del.className = 'del'
  del.disabled = locked

  li.append(up, down, del)
  return li
}

function exMove(i: number, dir: number): void {
  const j = i + dir
  if (j < 0 || j >= exploration.length) return
  ;[exploration[i], exploration[j]] = [exploration[j], exploration[i]]
  commit()
}

function renderExEditor(): void {
  exAddBtn.disabled = editingLocked()
  exEditorEl.replaceChildren()
  exploration.forEach((row, i) => exEditorEl.appendChild(createExRow(row, i)))
}

// Map a delve-log kind to one of the existing log-entry colour classes.
const LOG_CLASS: Record<string, string> = { explore: 'defend', enter: 'flee', combat: 'attack', clear: 'heal', end: 'counter' }

function renderLog(): void {
  const entries = (delve?.log ?? []).slice(-14).reverse()
  logEl.innerHTML = entries
    .map(
      (e) =>
        `<div class="entry ${LOG_CLASS[e.kind] ?? 'defend'}"><span class="turn">T${e.turn}</span> <span class="rule">${esc(e.reason)}</span><div class="detail">${esc(e.detail)}</div></div>`,
    )
    .join('')
}

/** Highlight the firing combat Protocol — only when the ACTIVE hero just acted in a fight. */
function highlightFiringProtocol(): void {
  for (const li of enabledLis) li.classList.remove('active')
  const last = delve?.battle?.log.at(-1)
  if (last === undefined || last.actorId !== roster[activeHero].simId) return
  const idx = last.protocolIndex
  if (idx >= 0 && idx < enabledLis.length) enabledLis[idx].classList.add('active')
}

/** Which theme the game wants right now: town / dungeon / boss (the objective fight). */
function musicTrack(): TrackId {
  if (mode === 'camp' || delve === null) return 'camp'
  if (delve.battle !== null && delve.battle.units.some((u) => u.side === 'enemy' && u.isBoss === true)) return 'boss'
  return 'run'
}

function frame(): void {
  if (mode === 'camp' || delve === null) render(ctx, campState(), sprites)
  else renderDelve(ctx, delve, sprites)
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

exAddBtn.addEventListener('click', () => {
  if (editingLocked()) return
  exploration.push({ subjectId: 'unexplored', predId: 'always', moveId: 'head', enabled: true })
  commit()
})

restore() // load a saved game (and fast-forward an in-progress delve) before first paint
renderRunBar()
renderTabs()
renderEditor()
renderExEditor()
frame()

let lastSaveMs = 0
const ticker = setInterval(() => {
  if (mode !== 'delve' || delve === null || delve.status !== 'delving') return
  delve = stepDelve(delve)
  frame()
  const now = Date.now()
  if (delve.status !== 'delving') {
    renderRunBar() // surface "Back to town"
    saveNow() // persist the finished delve
  } else if (now - lastSaveMs >= 1000) {
    saveNow() // heartbeat: keep savedAt fresh so offline catch-up is accurate
    lastSaveMs = now
  }
}, 450)

// Persist immediately when the tab is hidden or unloaded — this stamps `savedAt`
// at the moment of leaving, which is what offline catch-up measures from.
// (visibilitychange/pagehide are reliable where beforeunload is not.)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow()
})
window.addEventListener('pagehide', () => saveNow())

// Vite HMR re-runs this module on edit; without this, each hot update would stack
// another interval and the fight would race. Clear ours when the module is replaced.
if (import.meta.hot) import.meta.hot.dispose(() => clearInterval(ticker))
