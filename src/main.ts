import './style.css'
import { makeGolem, SENTINEL_STATS, MENDER_STATS, type Combatant, type GameState } from './sim'
import { startDelve, stepDelve, type DelveState, type ExProcedure } from './delve'
import { LEVELS, applyClear, levelById, hasCleared } from './levels'
import { UNLOCKABLES, buy, isOwned, canAfford } from './shop'
import { toggleMusic, setMusicState, type TrackId } from './music'
import { setSfxEnabled, playSfx, type SfxId } from './sfx'
import { log } from './log'
import {
  saveSlot,
  loadSlot,
  salvageMeta,
  listSlots,
  deleteSlot,
  importLegacy,
  type Hero,
  type ProtocolRow,
  type ExProtocolRow,
  type SalvagedMeta,
  type SlotInfo,
} from './save'
import { makeHero, makeHeroBack, makeSlime } from './sprites'
import { render, renderDelve } from './render'
import { buildingAt, type BuildingId } from './buildings'
import foyerUrl from './assets/town-foyer.png'
import { requireElement, require2dContext } from './dom'
import {
  available,
  buildExploration,
  procedureFor,
  commandById,
  SUBJECTS,
  PREDICATES,
  COMMANDS,
  SKILLS,
  EX_SUBJECTS,
  EX_PREDICATES,
  EX_MOVES,
  DEFAULT_EX_ROWS,
} from './protocol'

// --- Editor state: per-hero rule lists (priority = order). ------------------
// ProtocolRow / Hero are defined in save.ts (they're the persisted schema).
// `roster` is `let` so a loaded save can replace it on startup.

/** The starting party + Procedures a New Game (or a never-saved slot) begins with. */
function freshRoster(): Hero[] {
  return [
    {
      simId: 'hero-1',
      name: 'Sentinel',
      stats: { ...SENTINEL_STATS },
      rows: [
        { subjectId: 'self', predId: 'hp_lt_30', command: 'useSkill', skillId: 'defend', enabled: true },
        { subjectId: 'enemy_near', predId: 'always', command: 'attack', skillId: 'mend', enabled: true },
      ],
    },
    {
      simId: 'hero-2',
      name: 'Mender',
      stats: { ...MENDER_STATS },
      rows: [
        { subjectId: 'ally_low', predId: 'hp_lt_50', command: 'useSkill', skillId: 'mend', enabled: true },
        { subjectId: 'enemy_near', predId: 'always', command: 'attack', skillId: 'mend', enabled: true },
      ],
    },
  ]
}

let roster: Hero[] = freshRoster()
let activeHero = 0

// The party-wide exploration Procedure's rows — one Protocol each, priority =
// order. `let` so a loaded save can replace it; the defaults (protocol.ts) compile
// to DEFAULT_EXPLORATION.
let exploration: ExProtocolRow[] = DEFAULT_EX_ROWS.map((r) => ({ ...r }))

// Profile meta (persisted per slot, survives a wipe): levels first-cleared, and
// the Insight earned (+1 per first clear) — the currency the Trainer spends.
let clearedLevels: string[] = []
let insight = 0
// Vocabulary ids the profile has learned at the Trainer (10b). Gates the editor
// dropdowns; additive per-slot meta, survives a wipe.
let unlocked: string[] = []
// Which level the next Descend launches (town-only choice; defaults to the first).
let selectedLevelId: string = LEVELS[0].id
// Which building modal is open over the world (null = just the world). Transient
// UI state — never persisted.
type Building = 'workshop' | 'library' | 'journal'
let openBuilding: Building | null = null
// Which town building the cursor is over (for the hover highlight). Town-only.
let hoveredBuilding: BuildingId | null = null
// The last finished delve's journal, kept readable in town so the loop "wipe →
// read the journal → reprogram" works while you author. Transient (not saved).
let lastDelveLog: DelveState['log'] = []

/** When the current delve has just cleared, apply it to the meta: a FIRST clear
 *  adds the level and pays +1 Insight (a re-clear pays nothing). Called wherever a
 *  delve can reach 'cleared': the live ticker, and on resuming a delve that was
 *  already saved as cleared. */
function maybeRecordClear(): void {
  if (delve !== null && delve.status === 'cleared' && delve.levelId !== '') {
    const r = applyClear(clearedLevels, insight, delve.levelId)
    clearedLevels = r.clearedLevels
    insight = r.insight
  }
}

/** The live exploration Procedure fed to a delve (enabled rows compiled to
 *  Protocols, in priority order). */
function explorationProcedure(): ExProcedure {
  return buildExploration(exploration)
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
const insightEl = requireElement('insight', HTMLSpanElement)
const openJournalBtn = requireElement('open-journal', HTMLButtonElement)
const modalWorkshopEl = requireElement('modal-workshop', HTMLDivElement)
const modalLibraryEl = requireElement('modal-library', HTMLDivElement)
const modalJournalEl = requireElement('modal-journal', HTMLDivElement)
const trainerListEl = requireElement('trainer-list', HTMLDivElement)
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
    void setSfxEnabled(!muted) // one toggle drives both music and combat SFX
  })
})

const sprites = { hero: makeHero(), heroBack: makeHeroBack(), slime: makeSlime() }

// The town hub backdrop (the Artificer's tower foyer). Preloaded; repaint once it
// lands so the foyer replaces the drawn-placeholder town.
const foyerImg = new Image()
foyerImg.src = foyerUrl
foyerImg.onload = () => { frame(); }

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
  // The player authors the whole team via point-buy, so the party is whatever the
  // roster holds (1–4 golems). Each golem is built from its authored stat block;
  // a pre-point-buy save lacks `stats`, so fall back to the reference blocks by
  // index (hero-1 = Sentinel, hero-2 = Mender) — a missing block must not crash
  // the first frame.
  return roster.map((hero, i) => makeGolem({
    id: hero.simId,
    name: hero.name,
    stats: hero.stats ?? (i === 1 ? MENDER_STATS : SENTINEL_STATS),
    procedure: procedureFor(hero),
  }))
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
  return s.replace(/[&<>"']/gu, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  )
}

/** A fresh 32-bit seed for a delve (the impure shell may use Math.random). */
function newSeed(): number {
  return (Math.random() * 0x100000000) | 0
}

function descend(): void {
  lastDelveLog = [] // a fresh run — the previous journal no longer applies
  delve = startDelve(party(), newSeed(), explorationProcedure(), levelById(selectedLevelId))
  mode = 'delve'
  saveNow()
  renderRunBar()
  renderLevelSelect() // hide the picker during the delve
  renderEditor() // re-render so inputs pick up the locked state
  renderExEditor()
  setBuilding(null) // close any modal so the delve world is in view
  frame()
}

function backToTown(): void {
  if (delve !== null) lastDelveLog = delve.log // keep the run's journal readable in town
  delve = null
  mode = 'camp'
  saveNow()
  renderRunBar()
  renderLevelSelect() // show the picker again, with refreshed cleared badges
  renderEditor()
  renderExEditor()
  setBuilding(null) // back in town, world in view; building entries re-enabled
  frame()
}

/** Persist the active slot, stamped with the current time. No-op on title/slots
 *  (no active profile) — a stray visibilitychange there must not write a blank
 *  slot. */
function saveNow(): void {
  if (activeSlot === null) return
  saveSlot(activeSlot, { roster, activeHero, exploration, clearedLevels, insight, unlocked, mode, delve })
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
  resizeCanvas() // the canvas is laid out now (no longer display:none) — size its buffer
  renderRunBar()
  renderLevelSelect()
  renderTabs()
  renderEditor()
  renderExEditor()
  openBuilding = null // enter on the world, no modal open
  lastDelveLog = [] // don't carry a previous profile's journal into this slot
  renderModals()
  frame()
}

/** Start a brand-new profile in a slot. `carried` defaults to whatever meta we can
 *  salvage from a blob already there — so a slot whose save-format we can no longer
 *  load keeps its meta-progression (the run resets to fresh, but Insight / unlocks /
 *  cleared levels survive). A genuinely empty slot salvages nothing → fresh. */
function newGame(index: number, carried: SalvagedMeta | undefined = salvageMeta(index) ?? undefined): void {
  activeSlot = index
  roster = freshRoster()
  exploration = DEFAULT_EX_ROWS.map((r) => ({ ...r }))
  clearedLevels = carried?.clearedLevels ?? []
  insight = carried?.insight ?? 0
  unlocked = carried?.unlocked ?? []
  activeHero = 0
  delve = null
  mode = 'camp'
  saveNow() // materialise the slot right away
  enterGame()
}

/**
 * Open an existing slot. A delve that was in progress **resumes exactly where it
 * was saved** — the ticker continues it in real time. There is no offline progress:
 * time away never advances a delve (it just waits). An empty slot starts a new game.
 */
function enterSlot(index: number): void {
  const saved = loadSlot(index)
  if (saved === null) {
    // A rejected blob (stale format / corrupt run state) still gives up its
    // meta-progression — newGame salvages it so a format change never wipes unlocks.
    newGame(index)
    return
  }
  activeSlot = index
  roster = saved.roster
  activeHero = Math.max(0, Math.min(saved.activeHero, roster.length - 1))
  exploration = saved.exploration ?? DEFAULT_EX_ROWS.map((r) => ({ ...r }))
  clearedLevels = saved.clearedLevels ?? []
  insight = saved.insight ?? 0
  unlocked = saved.unlocked ?? []
  if (saved.delve === null) {
    delve = null
    mode = 'camp'
  } else {
    // Resume the delve as saved — no fast-forward (no offline progress).
    // (Pre-10a delves lack levelId — default it so first-clear tracking has a key.)
    delve = { ...saved.delve, levelId: saved.delve.levelId === '' ? LEVELS[0].id : saved.delve.levelId }
    mode = 'delve'
    maybeRecordClear() // a delve already saved as cleared still counts on resume
  }
  saveNow() // re-stamp savedAt (+ record a first clear if the saved delve was cleared)
  enterGame()
}

/** Leave the game back to the slot picker — PAUSE, not abandon: the in-progress
 *  delve is saved as-is and resumes in real time, exactly where it was, on
 *  re-entry (time away never advances it). */
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
            ? 'Golems wiped'
            : 'Delve stuck'
      : 'In town'
  return `${where} · ${info.heroCount} golems · ${relTime(info.savedAt)}`
}

function renderSlots(): void {
  slotListEl.replaceChildren()
  // The card builder is declared outside the loop: its button handlers close over
  // the module-level `pendingDelete`, which a loop-declared closure must not.
  const addCard = (info: SlotInfo): void => {
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
      actions.append(makeButton('New game', 'Start a new profile here', () => { newGame(info.index); }))
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
      actions.append(makeButton('Continue', 'Resume this profile', () => { enterSlot(info.index); }))
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
  for (const info of listSlots()) addCard(info)
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
  const {rows} = roster[activeHero]
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
  options: Array<{ value: string; label: string }>,
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

  // Declared outside the loop: the click handler closes over the mutable `value`.
  const addItem = (opt: { value: string; label: string }): void => {
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
  for (const opt of options) addItem(opt)

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
 * A two-line Protocol card: the rule reads as a sentence ([✓] Subject · Predicate
 * → …) on the top line, with the priority + reorder/delete controls on a subtle
 * strip below. Shared by both Procedure editors (combat and exploration), so the
 * rule never has to fight the controls for horizontal space.
 */
function ruleCard(ruleEls: HTMLElement[], c: CardControls): HTMLLIElement {
  const li = document.createElement('li')
  li.className = c.enabled ? 'protocol' : 'protocol disabled'

  const chk = document.createElement('input')
  chk.type = 'checkbox'
  chk.checked = c.enabled
  chk.disabled = c.locked
  chk.title = 'Enable / disable this rule'
  chk.addEventListener('change', () => { c.onToggle(chk.checked); })

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

// One row of the combat Procedure — a single Protocol: Subject · Predicate →
// Command [· Object].
function createRow(row: ProtocolRow, i: number): HTMLLIElement {
  /* eslint-disable no-param-reassign -- the editor binds each dropdown to its roster
     row, edited in place then persist()/commit(). The immutable rewrite belongs to
     the editor restructure (see chat); for now the in-place binding is the design. */
  const {rows} = roster[activeHero]
  const locked = editingLocked()

  const subjSel = makeSelect(
    available(SUBJECTS, unlocked).map((s) => ({ value: s.id, label: s.label })),
    row.subjectId,
    (v) => {
      row.subjectId = v
      persist()
    },
    locked,
  )
  subjSel.title = 'Subject — who this rule looks at (and acts on)'

  const predSel = makeSelect(
    available(PREDICATES, unlocked).map((p) => ({ value: p.id, label: p.label })),
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
  // Tolerant on a persisted command: a stale/absent id must not throw here (this
  // runs during the editor render in enterGame, outside the tick try/catch — see
  // the defensive compile path). An unknown command just hides the Object dropdown;
  // makeSelect shows the raw id, and the compiler treats it as a plain attack.
  showObject(COMMANDS.find((c) => c.id === row.command)?.hasObject ?? false)

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
    onUp: () => { move(i, -1); },
    onDown: () => { move(i, 1); },
    onDelete: () => {
      rows.splice(i, 1)
      commit()
    },
  })
  /* eslint-enable no-param-reassign */
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
    const launch = makeButton('▶ Descend', 'Send your golems delving into the chosen depths', descend)
    launch.className = 'run-launch'
    runBarEl.append(launch, makeHint(`${levelById(selectedLevelId).name} — never the same twice`))
  } else if (delve.status === 'delving') {
    const abandon = makeButton('✕ Abandon delve', 'Give up and return to town', backToTown)
    abandon.className = 'run-abandon'
    runBarEl.append(abandon, makeHint('Delving — your golems are on their own now'))
  } else {
    const back = makeButton('↩ Back to town', 'Return to town to revise your Procedures', backToTown)
    back.className = 'run-launch'
    const msg =
      delve.status === 'cleared'
        ? 'Delve cleared!'
        : delve.status === 'stuck'
          ? 'The delve got stuck — read the journal'
          : 'Your golems were wiped — read the journal'
    runBarEl.append(back, makeHint(msg))
  }
}

/** Town-only level picker: a chip per level (name · room range · cleared badge).
 *  Picking one sets which level the next Descend launches. Empty during a delve. */
function renderLevelSelect(): void {
  levelSelectEl.replaceChildren()
  if (mode !== 'camp' || delve !== null) return
  // The chip builder is declared OUTSIDE the loop (its click handler closes over
  // the module-level `selectedLevelId`, which a loop-declared closure must not).
  const addChip = (level: (typeof LEVELS)[number]): void => {
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
  for (const level of LEVELS) addChip(level)
}

// --- Buildings: full-screen modals over the world (Workshop / Library / Journal) --

/** Open a building's modal (or close all when null). The Workshop & Library are
 *  town activities (you author/shop between delves); the Journal is always
 *  reachable — including from a wipe, the whole reprogram loop depends on it. */
function setBuilding(b: Building | null): void {
  openBuilding = b
  renderModals()
}

/** Reflect `openBuilding` into the DOM + refresh the open building's contents.
 *  Workshop/Library entry is town-only; the Journal button is always available. */
function renderModals(): void {
  modalWorkshopEl.hidden = openBuilding !== 'workshop'
  modalLibraryEl.hidden = openBuilding !== 'library'
  modalJournalEl.hidden = openBuilding !== 'journal'

  if (openBuilding === 'library') renderTrainer()
  if (openBuilding === 'journal') renderLog()
}

/** Make a floating panel draggable by `handle`, clamped to the viewport. Resizing
 *  is handled by CSS (`resize: both`). Used for the Journal so it never blocks the
 *  delve you're watching. */
function makeDraggable(panel: HTMLElement, handle: HTMLElement | null): void {
  /* eslint-disable no-param-reassign -- positions the dragged panel via the DOM
     API (panel.style.* = …); configuring the element is the whole job here. */
  if (handle === null) return
  let ox = 0
  let oy = 0
  let sx = 0
  let sy = 0
  let dragging = false
  handle.addEventListener('pointerdown', (e) => {
    if (e.target instanceof HTMLElement && e.target.closest('[data-close-modal]') !== null) return // the ✕ isn't a drag
    dragging = true
    const r = panel.getBoundingClientRect()
    ox = r.left
    oy = r.top
    sx = e.clientX
    sy = e.clientY
    // switch from right/bottom anchoring to explicit left/top before we move it
    panel.style.left = `${ox}px`
    panel.style.top = `${oy}px`
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
    handle.setPointerCapture(e.pointerId)
  })
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const nx = Math.max(0, Math.min(ox + (e.clientX - sx), window.innerWidth - panel.offsetWidth))
    const ny = Math.max(0, Math.min(oy + (e.clientY - sy), window.innerHeight - panel.offsetHeight))
    panel.style.left = `${nx}px`
    panel.style.top = `${ny}px`
  })
  const end = (e: PointerEvent): void => {
    dragging = false
    try {
      handle.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  /* eslint-enable no-param-reassign */
}

/** The Trainer shop: each unlockable as name · description · cost / Learn / owned. */
function renderTrainer(): void {
  trainerListEl.replaceChildren()
  for (const u of UNLOCKABLES) {
    const owned = isOwned(unlocked, u.id)
    const item = document.createElement('div')
    item.className = owned ? 'trainer-item owned' : 'trainer-item'

    const body = document.createElement('div')
    body.className = 'ti-body'
    const name = document.createElement('div')
    name.className = 'ti-name'
    name.textContent = u.name
    const desc = document.createElement('div')
    desc.className = 'ti-desc'
    desc.textContent = u.desc
    body.append(name, desc)

    const buyCol = document.createElement('div')
    buyCol.className = 'ti-buy'
    if (owned) {
      const o = document.createElement('span')
      o.className = 'ti-owned'
      o.textContent = '✓ learned'
      buyCol.append(o)
    } else {
      const cost = document.createElement('span')
      cost.className = 'ti-cost'
      cost.textContent = `✦ ${u.cost}`
      const btn = makeButton('Learn', 'Spend Insight to learn this', () => { buyUnlock(u.id); })
      btn.disabled = !canAfford(insight, u.id)
      buyCol.append(cost, btn)
    }

    item.append(body, buyCol)
    trainerListEl.append(item)
  }
}

/** Buy an unlockable: spend Insight, add to `unlocked`, refresh the shop + the
 *  editors (the new vocabulary appears in the dropdowns) + the counter, and save. */
function buyUnlock(id: string): void {
  const r = buy(id, insight, unlocked)
  if (!r.bought) return
  insight = r.insight
  unlocked = r.unlocked
  renderInsight()
  renderTrainer()
  renderEditor()
  renderExEditor()
  saveNow()
}

function renderTabs(): void {
  tabsEl.replaceChildren()
  const units = partyUnits()
  roster.forEach((hero, i) => {
    const tab = document.createElement('button')
    tab.className = i === activeHero ? 'tab active' : 'tab'
    const unit = units.find((u) => u.id === hero.simId)
    const hp = unit === undefined ? '' : `${Math.max(0, unit.hp)}/${unit.maxHp}`
    // Prefer the sim unit's name (always current) over the saved roster name, so a
    // pre-U4 profile shows the golem names too without migrating the save.
    tab.textContent = `${unit?.name ?? hero.name}  ${hp}`
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

// One row of the exploration Procedure — a single Protocol: Subject · Predicate →
// Move. Party-wide (no hero tabs); shares the two-line ruleCard with the combat
// editor.
function createExRow(row: ExProtocolRow, i: number): HTMLLIElement {
  /* eslint-disable no-param-reassign -- same as createRow: the editor binds each
     dropdown to its exploration row, edited in place then persist()/commit(). */
  const locked = editingLocked()

  const subjSel = makeSelect(
    available(EX_SUBJECTS, unlocked).map((s) => ({ value: s.id, label: s.label })),
    row.subjectId,
    (v) => {
      row.subjectId = v
      persist()
    },
    locked,
  )
  subjSel.title = 'Subject — what in the dungeon this rule looks at'

  const predSel = makeSelect(
    available(EX_PREDICATES, unlocked).map((p) => ({ value: p.id, label: p.label })),
    row.predId,
    (v) => {
      row.predId = v
      persist()
    },
    locked,
  )
  predSel.title = 'Predicate — what must be true'

  const moveSel = makeSelect(
    available(EX_MOVES, unlocked).map((m) => ({ value: m.id, label: m.label })),
    row.moveId,
    (v) => {
      row.moveId = v
      persist()
    },
    locked,
  )
  moveSel.title = 'Move — what your golems do'

  return ruleCard([subjSel, sep('·'), predSel, sep('→', 'arrow'), moveSel], {
    index: i,
    count: exploration.length,
    locked,
    enabled: row.enabled,
    onToggle: (on) => {
      row.enabled = on
      commit()
    },
    onUp: () => { exMove(i, -1); },
    onDown: () => { exMove(i, 1); },
    onDelete: () => {
      exploration.splice(i, 1)
      commit()
    },
  })
  /* eslint-enable no-param-reassign */
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
  exploration.forEach((row, i) => { exEditorEl.appendChild(createExRow(row, i)) })
}

// Map a delve-log kind to one of the existing log-entry colour classes.
const LOG_CLASS: Record<string, string> = { explore: 'defend', enter: 'flee', combat: 'attack', clear: 'heal', end: 'counter' }

function renderLog(): void {
  const entries = (delve?.log ?? lastDelveLog).slice(-14).reverse()
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
  if (last?.actorId !== roster[activeHero].simId) return
  const idx = last.protocolIndex
  if (idx >= 0 && idx < enabledLis.length) enabledLis[idx].classList.add('active')
}

/** Which theme the game wants right now: town / dungeon / boss (the objective fight). */
function musicTrack(): TrackId {
  if (mode === 'camp' || delve === null) return 'camp'
  if (delve.battle?.units.some((u) => u.side === 'enemy' && u.isBoss === true) === true) return 'boss'
  return 'run'
}

function renderInsight(): void {
  insightEl.textContent = `✦ ${insight} Insight`
}

/** Responsive viewport: match the canvas backing store to its CSS box × the device
 *  pixel ratio, so the world fills any window with no bars, crop or distortion AND
 *  stays crisp on HiDPI displays. A transform maps drawing coords back to CSS px,
 *  so render.ts and hit-testing keep working in CSS px (the buffer is dpr× larger).
 *  dpr is capped so a 3–4× display doesn't allocate a huge buffer. No-op while
 *  hidden (size 0). */
function resizeCanvas(): void {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return
  const dpr = Math.min(window.devicePixelRatio > 0 ? window.devicePixelRatio : 1, 3)
  const bw = Math.round(w * dpr)
  const bh = Math.round(h * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // draw in CSS px; backing store is device px
}

window.addEventListener('resize', () => {
  if (screen !== 'game') return
  resizeCanvas()
  frame()
})

function frame(): void {
  if (mode === 'camp' || delve === null) render(ctx, campState(), sprites, hoveredBuilding, foyerImg)
  else renderDelve(ctx, delve, sprites)
  renderLog()
  renderTabs()
  renderInsight()
  highlightFiringProtocol()
  setMusicState(musicTrack()) // cheap no-op unless the track should change
}

addBtn.addEventListener('click', () => {
  if (editingLocked()) return
  roster[activeHero].rows.push({
    subjectId: 'enemy_near',
    predId: 'always',
    command: 'attack',
    skillId: 'mend',
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

// The Journal opens from its always-available button (it's readable mid-delve too).
openJournalBtn.addEventListener('click', () => { setBuilding('journal'); })

// The Workshop & Library are entered by clicking their buildings in the town scene.
// Map a click to the renderer's CSS-pixel coordinate space (the backing store is
// dpr× larger, but render.ts draws in CSS px), and hit-test the SAME rects the
// renderer draws. Town-only, and not while a modal is up.
function canvasPoint(e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.clientWidth,
    y: ((e.clientY - rect.top) / rect.height) * canvas.clientHeight,
  }
}
canvas.addEventListener('click', (e) => {
  if (mode !== 'camp' || openBuilding !== null) return
  const { x, y } = canvasPoint(e)
  const b = buildingAt(x, y, canvas.clientWidth, canvas.clientHeight)
  if (b !== null) setBuilding(b)
})
canvas.addEventListener('mousemove', (e) => {
  const over =
    mode === 'camp' && openBuilding === null
      ? buildingAt(canvasPoint(e).x, canvasPoint(e).y, canvas.clientWidth, canvas.clientHeight)
      : null
  canvas.style.cursor = over === null ? 'default' : 'pointer'
  if (over !== hoveredBuilding) {
    hoveredBuilding = over
    frame() // repaint only on change — light up the hovered building
  }
})
canvas.addEventListener('mouseleave', () => {
  if (hoveredBuilding !== null) {
    hoveredBuilding = null
    canvas.style.cursor = 'default'
    frame()
  }
})

// Workshop & Library are blocking modals: the dim backdrop or the ✕ closes them.
for (const modal of [modalWorkshopEl, modalLibraryEl]) {
  modal.addEventListener('click', (e) => {
    const t = e.target
    if (t === modal || (t instanceof HTMLElement && t.closest('[data-close-modal]') !== null)) setBuilding(null)
  })
}
// The Journal is a floating panel (no backdrop): only its ✕ closes it; it's drag-
// gable by its header and resizable from the corner (CSS). The world stays visible.
modalJournalEl.addEventListener('click', (e) => {
  if (e.target instanceof HTMLElement && e.target.closest('[data-close-modal]') !== null) setBuilding(null)
})
makeDraggable(modalJournalEl, modalJournalEl.querySelector('.float-drag'))

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openBuilding !== null) setBuilding(null)
})

// Startup: no auto-resume. Surface any pre-9 single-save as slot 0, then show the
// title — a profile loads, and an in-progress delve resumes in real time exactly
// where it was, on slot entry.
importLegacy()
screen = 'title'
renderScreens()

// Combat SFX: play one clip per *new* battle-log entry. The log grows within a
// fight and resets (battle → null) between fights, so we track its length and
// reset on null. The first call only primes the baseline — never replaying the
// history of a fight resumed from a save.
let sfxLogLen = 0
let sfxPrimed = false

// Pick the clip for a log entry. An attack is logged the same way whoever throws
// it, so we read the actor's side: your golems' blows play `attack`, an enemy's
// blow (your golem taking the hit) plays `hit`. `flee` is silent.
function sfxFor(e: GameState['log'][number], battle: GameState): SfxId | null {
  switch (e.kind) {
    case 'heal':
      return 'heal'
    case 'defend':
      return 'defend'
    case 'counter':
      return 'hit'
    case 'flee':
      return null
    case 'attack': {
      const actor = battle.units.find((u) => u.id === e.actorId)
      return actor?.side === 'hero' ? 'attack' : 'hit'
    }
  }
}

function pumpSfx(battle: GameState | null): void {
  if (!sfxPrimed) {
    sfxPrimed = true
    sfxLogLen = battle?.log.length ?? 0
    return
  }
  if (battle === null) {
    sfxLogLen = 0
    return
  }
  for (const e of battle.log.slice(sfxLogLen)) {
    const id = sfxFor(e, battle)
    if (id !== null) playSfx(id)
  }
  sfxLogLen = battle.log.length
}

// The delve advances one step per tick. Combat steps tick slowly so each blow
// is readable (and the per-action SFX breathe instead of machine-gunning);
// exploration (and the idle poll while not delving) stays snappy.
const COMBAT_TICK_MS = 2000
const EXPLORE_TICK_MS = 450
let lastSaveMs = 0
let tickHandle: ReturnType<typeof setTimeout> | undefined = undefined

/** One delve step + its persistence cadence. Called only while `active` is delving;
 *  reassigns the module `delve` to the stepped state. Split out so `tick` stays under
 *  the complexity bar. */
function advanceDelveTick(active: DelveState): void {
  delve = stepDelve(active)
  pumpSfx(delve.battle)
  frame()
  if (delve.status !== 'delving') {
    maybeRecordClear() // first-clear of this level → into the profile's cleared set
    renderRunBar() // surface "Back to town"
    saveNow() // persist the finished delve (+ any first-clear)
    return
  }
  const now = Date.now()
  if (now - lastSaveMs >= 1000) {
    saveNow() // periodic checkpoint: a crash/close mid-delve loses ~1s at most
    lastSaveMs = now
  }
}

function tick(): void {
  // Everything is wrapped so the loop is increvable: a throw anywhere (render,
  // audio, save) must NOT stop the reschedule, or the whole game freezes for
  // good. The error is logged (open DevTools to see it) but never fatal.
  try {
    if (screen === 'game' && mode === 'delve' && delve !== null && delve.status === 'delving') {
      advanceDelveTick(delve)
    }
  } catch (err) {
    log.error('[tick] error (loop survives):', err)
  } finally {
    // Pace the next tick by what the delve is doing now: slow mid-fight, brisk
    // while exploring or idle (so a freshly-started delve resumes promptly).
    const inCombat = delve !== null && delve.battle !== null && delve.status === 'delving'
    tickHandle = setTimeout(tick, inCombat ? COMBAT_TICK_MS : EXPLORE_TICK_MS)
  }
}
tickHandle = setTimeout(tick, EXPLORE_TICK_MS)

// Persist immediately when the tab is hidden or unloaded, so an in-progress delve
// resumes exactly where it was left. (visibilitychange/pagehide are reliable where
// beforeunload is not.)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow()
})
window.addEventListener('pagehide', () => { saveNow(); })

// Vite HMR re-runs this module on edit; without this, each hot update would stack
// another timer and the fight would race. Clear ours when the module is replaced.
if (import.meta.hot !== undefined) import.meta.hot.dispose(() => { clearTimeout(tickHandle); })
