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
import { LEVELS, recordClear, levelById, hasCleared } from './levels'
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
  { id: 'ally_low', label: 'Ally · low HP', make: () => ({ who: 'ally', pick: 'lowestHp' }) },
  { id: 'enemy_near', label: 'Enemy · near', make: () => ({ who: 'enemy', pick: 'first' }) },
  { id: 'enemy_low', label: 'Enemy · low HP', make: () => ({ who: 'enemy', pick: 'lowestHp' }) },
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

// Levels this profile has first-cleared (meta; persisted per slot, survives a wipe).
let clearedLevels: string[] = []
// Which level the next Descend launches (town-only choice; defaults to the first).
let selectedLevelId: string = LEVELS[0].id

/** Mark the current delve's level cleared if it just finished cleared (first-clear
 *  only — recordClear is idempotent). Called wherever a delve can reach 'cleared':
 *  the live ticker and offline catch-up on slot entry. */
function maybeRecordClear(): void {
  if (delve !== null && delve.status === 'cleared' && delve.levelId) {
    clearedLevels = recordClear(clearedLevels, delve.levelId)
  }
}

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
const levelSelectEl = requireElement('level-select', HTMLDivElement)
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
  delve = startDelve(party(), newSeed(), explorationProtocol(), levelById(selectedLevelId))
  mode = 'delve'
  saveNow()
  renderRunBar()
  renderLevelSelect() // hide the picker during the delve
  renderEditor() // re-render so inputs pick up the locked state
  renderExEditor()
  frame()
}

function backToTown(): void {
  delve = null
  mode = 'camp'
  saveNow()
  renderRunBar()
  renderLevelSelect() // show the picker again, with refreshed cleared badges
  renderEditor()
  renderExEditor()
  frame()
}

/** Persist the active slot, stamped with the current time (for offline catch-up).
 *  No-op on title/slots (no active profile) — a stray visibilitychange there
 *  must not write a blank slot. */
function saveNow(): void {
  if (activeSlot === null) return
  saveSlot(activeSlot, { roster, activeHero, exploration, clearedLevels, mode, delve })
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
  renderLevelSelect()
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
  clearedLevels = []
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
  clearedLevels = saved.clearedLevels ?? []
  if (saved.delve !== null) {
    // Pre-10a delves lack levelId — default it so first-clear tracking has a key.
    const base = { ...saved.delve, levelId: saved.delve.levelId || LEVELS[0].id }
    delve = catchUpDelve(base, elapsedSteps(saved.savedAt, Date.now()))
    mode = 'delve'
    maybeRecordClear() // a delve that cleared while away still counts
  } else {
    delve = null
    mode = 'camp'
  }
  saveNow() // re-stamp savedAt after catch-up (+ any first-clear just recorded)
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

/** A structural edit (add / remove / reorder / enable-toggle) — rebuild the editor
 *  and persist. Town-only; a launched delve is locked so this never runs mid-delve. */
function commit(): void {
  renderEditor()
  renderExEditor()
  saveNow()
}

/**
 * A value-only edit — a dropdown pick that changes a rule's data but not the
 * editor's structure. We deliberately do NOT rebuild the editor here: replacing a
 * `<select>` inside its own `change` handler makes the freshly-created element
 * reopen its dropdown at the same spot, so closing a list felt flaky. Nothing in
 * the editor's layout depends on the value (the rule's label only surfaces in the
 * delve journal), so persisting is all that's needed.
 */
function persist(): void {
  saveNow()
}

function move(i: number, dir: number): void {
  const rows = roster[activeHero].rows
  const j = i + dir
  if (j < 0 || j >= rows.length) return
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  commit()
}

// A custom dropdown (not a native <select>). We build our own so open/close is
// fully under our control — native <select> popups misbehaved in some browsers
// (a closed list spontaneously reopening). Only one is open at a time; any click
// outside the open one closes it.
let closeOpenDropdown: (() => void) | null = null
document.addEventListener('click', () => closeOpenDropdown?.())

function makeSelect(
  options: { value: string; label: string }[],
  selected: string,
  onChange: (value: string) => void,
  disabled = false,
): HTMLElement {
  let value = selected

  const root = document.createElement('div')
  root.className = disabled ? 'dropdown disabled' : 'dropdown'

  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'dropdown-head'
  head.disabled = disabled
  const label = document.createElement('span')
  label.className = 'dropdown-label'
  label.textContent = options.find((o) => o.value === value)?.label ?? value
  const caret = document.createElement('span')
  caret.className = 'dropdown-caret'
  caret.textContent = '▾'
  head.append(label, caret)

  const list = document.createElement('div')
  list.className = 'dropdown-list'
  list.hidden = true

  const close = (): void => {
    list.hidden = true
    root.classList.remove('open')
    if (closeOpenDropdown === close) closeOpenDropdown = null
  }
  const open = (): void => {
    closeOpenDropdown?.() // only one dropdown open at a time
    list.hidden = false
    root.classList.add('open')
    closeOpenDropdown = close
  }

  for (const opt of options) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = opt.value === value ? 'dropdown-item selected' : 'dropdown-item'
    item.textContent = opt.label
    item.addEventListener('click', (e) => {
      e.stopPropagation()
      if (opt.value !== value) {
        value = opt.value
        label.textContent = opt.label
        for (const child of list.children) child.classList.toggle('selected', child === item)
        onChange(value)
      }
      close()
    })
    list.appendChild(item)
  }

  head.addEventListener('click', (e) => {
    e.stopPropagation() // so the document handler doesn't close it on the opening click
    if (disabled) return
    if (list.hidden) open()
    else close()
  })

  root.append(head, list)
  return root
}

function makeButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.title = title
  btn.addEventListener('click', onClick)
  return btn
}

/** A `·` / `→` separator span between rule dropdowns. */
function sep(text: string, cls = 'dot'): HTMLSpanElement {
  const s = document.createElement('span')
  s.className = cls
  s.textContent = text
  return s
}

interface CardControls {
  index: number
  count: number
  locked: boolean
  enabled: boolean
  onToggle: (on: boolean) => void
  onUp: () => void
  onDown: () => void
  onDelete: () => void
}

/**
 * A two-line rule card: the rule reads as a sentence ([✓] Subject · Predicate →
 * …) on the top line, with the priority + reorder/delete controls on a subtle
 * strip below. Shared by the combat Procedure and the exploration Protocol
 * editors, so the rule never has to fight the controls for horizontal space.
 */
function ruleCard(ruleEls: HTMLElement[], c: CardControls): HTMLLIElement {
  const li = document.createElement('li')
  li.className = c.enabled ? 'protocol' : 'protocol disabled'

  const chk = document.createElement('input')
  chk.type = 'checkbox'
  chk.checked = c.enabled
  chk.disabled = c.locked
  chk.title = 'Enable / disable this rule'
  chk.addEventListener('change', () => c.onToggle(chk.checked))

  const ruleLine = document.createElement('div')
  ruleLine.className = 'rule-line'
  ruleLine.append(chk, ...ruleEls)

  const prio = document.createElement('span')
  prio.className = 'prio'
  prio.textContent = `#${c.index + 1}`

  const up = makeButton('▲', 'Higher priority', c.onUp)
  up.disabled = c.locked || c.index === 0
  const down = makeButton('▼', 'Lower priority', c.onDown)
  down.disabled = c.locked || c.index === c.count - 1
  const del = makeButton('✕', 'Remove this rule', c.onDelete)
  del.className = 'del'
  del.disabled = c.locked

  const ctrlLine = document.createElement('div')
  ctrlLine.className = 'ctrl-line'
  ctrlLine.append(prio, up, down, del)

  li.append(ruleLine, ctrlLine)
  return li
}

// One combat-Procedure row: Subject · Predicate → Command [· Object].
function createRow(row: ProtocolRow, i: number): HTMLLIElement {
  const rows = roster[activeHero].rows
  const locked = editingLocked()

  const subjSel = makeSelect(
    SUBJECTS.map((s) => ({ value: s.id, label: s.label })),
    row.subjectId,
    (v) => {
      row.subjectId = v
      persist()
    },
    locked,
  )
  subjSel.title = 'Subject — who this rule looks at (and acts on)'

  const predSel = makeSelect(
    PREDICATES.map((p) => ({ value: p.id, label: p.label })),
    row.predId,
    (v) => {
      row.predId = v
      persist()
    },
    locked,
  )
  predSel.title = 'Predicate — what must be true of the Subject'

  // The Object dropdown (and its separator) is always built, but only *shown* for
  // a Command that carries one (Use Skill). A Command change toggles its
  // visibility — it never recreates a <select>, which is what made the native
  // dropdown reopen flakily when an editor was rebuilt mid-change.
  const objSep = sep('·')
  const objSel = makeSelect(
    SKILLS.map((s) => ({ value: s.id, label: s.label })),
    row.skillId,
    (v) => {
      const found = SKILLS.find((s) => s.id === v)
      if (found !== undefined) {
        row.skillId = found.id
        persist()
      }
    },
    locked,
  )
  objSel.title = 'Object — which skill to use'
  const showObject = (on: boolean): void => {
    objSep.style.display = on ? '' : 'none'
    objSel.style.display = on ? '' : 'none'
  }
  showObject(commandById(row.command).hasObject)

  const cmdSel = makeSelect(
    COMMANDS.map((c) => ({ value: c.id, label: c.label })),
    row.command,
    (v) => {
      row.command = commandById(v).id
      persist()
      showObject(commandById(row.command).hasObject)
    },
    locked,
  )
  cmdSel.title = 'Command — what to do'

  return ruleCard([subjSel, sep('·'), predSel, sep('→', 'arrow'), cmdSel, objSep, objSel], {
    index: i,
    count: rows.length,
    locked,
    enabled: row.enabled,
    onToggle: (on) => {
      row.enabled = on
      commit()
    },
    onUp: () => move(i, -1),
    onDown: () => move(i, 1),
    onDelete: () => {
      rows.splice(i, 1)
      commit()
    },
  })
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
    const launch = makeButton('▶ Descend', 'Send your party delving into the selected level', descend)
    launch.className = 'run-launch'
    runBarEl.append(launch, makeHint(`${levelById(selectedLevelId).name} — a fresh seeded layout each run`))
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

/** Town-only level picker: a chip per level (name · room range · cleared badge).
 *  Picking one sets which level the next Descend launches. Empty during a delve. */
function renderLevelSelect(): void {
  levelSelectEl.replaceChildren()
  if (mode !== 'camp' || delve !== null) return
  for (const level of LEVELS) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = level.id === selectedLevelId ? 'level-chip selected' : 'level-chip'

    const name = document.createElement('span')
    name.textContent = level.name

    const meta = document.createElement('span')
    meta.className = 'lvl-meta'
    meta.textContent = `${level.rooms[0]}–${level.rooms[1]} rooms`

    const badge = document.createElement('span')
    const cleared = hasCleared(clearedLevels, level.id)
    badge.className = cleared ? 'lvl-cleared' : 'lvl-new'
    badge.textContent = cleared ? '✓ cleared' : 'new'

    chip.append(name, meta, badge)
    chip.addEventListener('click', () => {
      selectedLevelId = level.id
      renderLevelSelect()
      renderRunBar() // the Descend hint names the selected level
    })
    levelSelectEl.append(chip)
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

// One exploration-Protocol row: Subject · Predicate → Move. Party-wide (no hero
// tabs); shares the two-line ruleCard with the combat editor.
function createExRow(row: ExProtocolRow, i: number): HTMLLIElement {
  const locked = editingLocked()

  const subjSel = makeSelect(
    EX_SUBJECTS.map((s) => ({ value: s.id, label: s.label })),
    row.subjectId,
    (v) => {
      row.subjectId = v
      persist()
    },
    locked,
  )
  subjSel.title = 'Subject — what in the dungeon this rule looks at'

  const predSel = makeSelect(
    EX_PREDICATES.map((p) => ({ value: p.id, label: p.label })),
    row.predId,
    (v) => {
      row.predId = v
      persist()
    },
    locked,
  )
  predSel.title = 'Predicate — what must be true'

  const moveSel = makeSelect(
    EX_MOVES.map((m) => ({ value: m.id, label: m.label })),
    row.moveId,
    (v) => {
      row.moveId = v
      persist()
    },
    locked,
  )
  moveSel.title = 'Move — what the party does'

  return ruleCard([subjSel, sep('·'), predSel, sep('→', 'arrow'), moveSel], {
    index: i,
    count: exploration.length,
    locked,
    enabled: row.enabled,
    onToggle: (on) => {
      row.enabled = on
      commit()
    },
    onUp: () => exMove(i, -1),
    onDown: () => exMove(i, 1),
    onDelete: () => {
      exploration.splice(i, 1)
      commit()
    },
  })
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
    maybeRecordClear() // first-clear of this level → into the profile's cleared set
    renderRunBar() // surface "Back to town"
    saveNow() // persist the finished delve (+ any first-clear)
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
