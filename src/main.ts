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
import {
  saveSlot,
  loadSlot,
  listSlots,
  deleteSlot,
  importLegacy,
  elapsedSteps,
  type Hero,
  type ProtocolRow,
  type ExProtocolRow,
  type SlotInfo,
} from './save'
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

/** The starting party + Procedures a New Game (or a never-saved slot) begins with. */
function freshRoster(): Hero[] {
  return [
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
}

let roster: Hero[] = freshRoster()
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
const screenTitleEl = requireElement('screen-title', HTMLDivElement)
const screenSlotsEl = requireElement('screen-slots', HTMLDivElement)
const screenGameEl = requireElement('screen-game', HTMLElement)
const slotListEl = requireElement('slot-list', HTMLDivElement)
const playBtn = requireElement('title-play', HTMLButtonElement)
const slotsBackBtn = requireElement('slots-back', HTMLButtonElement)
const toSlotsBtn = requireElement('to-slots', HTMLButtonElement)

musicBtn.addEventListener('click', () => {
  void toggleMusic().then((muted) => {
    musicBtn.textContent = muted ? '♪ Music: off' : '♪ Music: on'
    musicBtn.classList.toggle('on', !muted)
  })
})

const sprites = { hero: makeHero(), heroBack: makeHeroBack(), slime: makeSlime() }

// The screen shell sits above the in-game mode: title → slots → game (where the
// game's own town/delve `mode` lives). `activeSlot` is the profile every save
// routes to — null on title/slots, so saveNow() there is a no-op.
type Screen = 'title' | 'slots' | 'game'
let screen: Screen = 'title'
let activeSlot: number | null = null

type Mode = 'camp' | 'delve'
let mode: Mode = 'camp'
let delve: DelveState | null = null
let pendingDelete: number | null = null // slot index awaiting a delete confirm
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

/** Persist the active slot, stamped with the current time (for offline catch-up).
 *  No-op on title/slots (no active profile) — a stray visibilitychange there
 *  must not write a blank slot. */
function saveNow(): void {
  if (activeSlot === null) return
  saveSlot(activeSlot, { roster, activeHero, exploration, mode, delve })
}

// --- Screen shell: title → slots → game -------------------------------------

function renderScreens(): void {
  screenTitleEl.hidden = screen !== 'title'
  screenSlotsEl.hidden = screen !== 'slots'
  screenGameEl.hidden = screen !== 'game'
}

/** Paint the in-game screen for the current profile (called on slot entry). */
function enterGame(): void {
  screen = 'game'
  renderScreens()
  renderRunBar()
  renderTabs()
  renderEditor()
  renderExEditor()
  frame()
}

/** Start a brand-new profile in an empty slot. */
function newGame(index: number): void {
  activeSlot = index
  roster = freshRoster()
  exploration = DEFAULT_EX_ROWS.map((r) => ({ ...r }))
  activeHero = 0
  delve = null
  mode = 'camp'
  saveNow() // materialise the slot right away
  enterGame()
}

/**
 * Open an existing slot. If a delve was in progress, fast-forward it by the
 * elapsed wall-clock (offline progress now happens at slot-entry, not app load)
 * — a delve that ended while away lands on its CLEARED / WIPED screen so the
 * journal can be read (Design rule #1). An empty slot starts a new game.
 */
function enterSlot(index: number): void {
  const saved = loadSlot(index)
  if (saved === null) {
    newGame(index)
    return
  }
  activeSlot = index
  roster = saved.roster
  activeHero = Math.max(0, Math.min(saved.activeHero, roster.length - 1))
  exploration = saved.exploration ?? DEFAULT_EX_ROWS.map((r) => ({ ...r }))
  if (saved.delve !== null) {
    delve = catchUpDelve(saved.delve, elapsedSteps(saved.savedAt, Date.now()))
    mode = 'delve'
  } else {
    delve = null
    mode = 'camp'
  }
  saveNow() // re-stamp savedAt after catch-up
  enterGame()
}

/** Leave the game back to the slot picker — PAUSE, not abandon: the in-progress
 *  delve is saved as-is and resumes (with offline catch-up) on re-entry. */
function backToSlots(): void {
  saveNow() // persist current state into the slot BEFORE dropping activeSlot
  activeSlot = null
  goToSlots()
}

function goToSlots(): void {
  pendingDelete = null
  screen = 'slots'
  renderScreens()
  renderSlots()
}

function goToTitle(): void {
  screen = 'title'
  renderScreens()
}

/** Relative "x ago" for a slot's savedAt. */
function relTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

function slotSummary(info: SlotInfo): string {
  if (info.savedAt === null) return 'No save'
  const where =
    info.mode === 'delve'
      ? info.delveStatus === 'delving'
        ? 'Delving…'
        : info.delveStatus === 'cleared'
          ? 'Delve cleared'
          : info.delveStatus === 'dead'
            ? 'Party wiped'
            : 'Delve stuck'
      : 'In town'
  return `${where} · ${info.heroCount} heroes · ${relTime(info.savedAt)}`
}

function renderSlots(): void {
  slotListEl.replaceChildren()
  for (const info of listSlots()) {
    const empty = info.savedAt === null
    const card = document.createElement('div')
    card.className = empty ? 'slot-card empty' : 'slot-card'

    const no = document.createElement('span')
    no.className = 'slot-no'
    no.textContent = `Slot ${info.index + 1}`

    const body = document.createElement('div')
    body.className = 'slot-body'
    const name = document.createElement('div')
    name.className = 'slot-name'
    name.textContent = empty ? 'Empty slot' : `Profile ${info.index + 1}`
    const meta = document.createElement('div')
    meta.className = 'slot-meta'
    meta.textContent = slotSummary(info)
    body.append(name, meta)

    const actions = document.createElement('div')
    actions.className = 'slot-actions'
    if (empty) {
      actions.append(makeButton('New game', 'Start a new profile here', () => newGame(info.index)))
    } else if (pendingDelete === info.index) {
      const yes = makeButton('Confirm', 'Permanently erase this profile', () => {
        deleteSlot(info.index)
        pendingDelete = null
        renderSlots()
      })
      yes.className = 'danger'
      const cancel = makeButton('Cancel', 'Keep this profile', () => {
        pendingDelete = null
        renderSlots()
      })
      actions.append(yes, cancel)
    } else {
      actions.append(makeButton('Continue', 'Resume this profile', () => enterSlot(info.index)))
      const del = makeButton('Delete', 'Erase this profile', () => {
        pendingDelete = info.index
        renderSlots()
      })
      del.className = 'danger'
      actions.append(del)
    }

    card.append(no, body, actions)
    slotListEl.appendChild(card)
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

playBtn.addEventListener('click', goToSlots)
slotsBackBtn.addEventListener('click', goToTitle)
toSlotsBtn.addEventListener('click', backToSlots)

// Startup: no auto-resume. Surface any pre-9 single-save as slot 0, then show the
// title — a profile loads (and an in-progress delve fast-forwards) on slot entry.
importLegacy()
screen = 'title'
renderScreens()

let lastSaveMs = 0
const ticker = setInterval(() => {
  if (screen !== 'game' || mode !== 'delve' || delve === null || delve.status !== 'delving') return
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
