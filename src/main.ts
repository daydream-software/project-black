import './style.css'
import { makeGolem, setProgramDecider, type Combatant, type GameState, type Stats } from './sim'
import { decideCombatFromProgram } from './lang/combat'
import { decideExplorationFromProgram } from './lang/explore'
import { setLibraries } from './lang/interp'
import { combatRowsToSource, explorationTemplate, toEntryForm } from './lang/migrate'
import { mountTextarea, type CodeEditorHandle } from './lang/editor'
import { checkProgram, type CheckResult } from './lang/check'
import { startDelve, stepDelve, setExplorationProgramDecider, type DelveState, type ExProcedure } from './delve'
import { BUILD_BUDGET, CHASSIS_COST, STAT_CAP, GOLEM_MAX, buildCost } from './party'
import { LEVELS, applyClear, levelById, hasCleared } from './levels'
import { UNLOCKABLES, buy, isOwned, canAfford } from './shop'
import { toggleMusic, setMusicState, type TrackId } from './music'
import { setSfxEnabled, playSfx, isSfxId, type SfxId } from './sfx'
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
  type EngramStore,
  type NamedEngram,
} from './save'
import { makeHero, makeHeroBack, makeSlime } from './sprites'
import { render, renderDelve } from './render'
import { buildingAt, type BuildingId } from './buildings'
import foyerUrl from './assets/town-foyer.png'
import { requireElement, require2dContext } from './dom'
import {
  buildExploration,
  procedureFor,
  COMMANDS,
  SKILLS,
  DEFAULT_EX_ROWS,
} from './protocol'

// --- Editor state: per-hero rule lists (priority = order). ------------------
// ProtocolRow / Hero are defined in save.ts (they're the persisted schema).
// `roster` is `let` so a loaded save can replace it on startup.

// The default rules a freshly-forged golem starts with (one plain attack rule — the
// player authors the rest). The chassis grants no stats; the player spends the build
// budget themselves.
function freshGolemRows(): ProtocolRow[] {
  return [{ subjectId: 'enemy_near', predId: 'always', command: 'attack', skillId: 'mend', enabled: true }]
}

const ZERO_STATS: Stats = { might: 0, ward: 0, fortitude: 0, attunement: 0, poise: 0, celerity: 0 }

/** A New Game starts with NO golems — an empty foundry. The player forges and names
 *  their own team in the Workshop (no pre-selected, pre-named, pre-built golems). */
function freshRoster(): Hero[] {
  return []
}

let roster: Hero[] = freshRoster()
let activeHero = 0

// The party-wide exploration Procedure's rows — one Protocol each, priority =
// order. `let` so a loaded save can replace it; the defaults (protocol.ts) compile
// to DEFAULT_EXPLORATION.
let exploration: ExProtocolRow[] = DEFAULT_EX_ROWS.map((r) => ({ ...r }))
// The party-wide exploration code navigator (overrides `exploration` rows when filled).
let explorationProgram = ''
// The shared library source (`import lib` → `lib.fn()`), party-wide per profile. Legacy;
// migrated into `engrams.libs` (as an entry named "lib") on load.
let library = ''
// Named, reusable engrams authored in the Library, copied onto golems in the Workshop.
let engrams: EngramStore = { combat: [], exploration: [], libs: [] }

/** Publish every named library engram to the interpreter so `import <name>` resolves it. */
function syncLibraries(): void {
  setLibraries(Object.fromEntries(engrams.libs.map((l) => [l.name, l.src])))
}

/** Fold the legacy single `library` field into `engrams.libs` (as "lib") once, on load. */
function migrateLibrary(): void {
  if (library.trim() !== '' && !engrams.libs.some((l) => l.name === 'lib')) {
    engrams.libs = [...engrams.libs, { name: 'lib', src: library }]
  }
  library = ''
}

// The real default brains a fresh golem / profile runs (the code editors show these,
// not a placeholder). Authoring is now code-only — the slot Procedure was retired.
const DEFAULT_COMBAT_PROGRAM = [
  'Engram.combat_turn:',
  '    ally = senses.allies.lowest_hp',
  '    if ally and ally.hp_pct < 50:',
  '        return use(Skills.Mend, ally)',
  '    if me.hp_pct < 30:',
  '        return use(Skills.Defend, me)',
  '    return attack(senses.enemies.lowest_hp)',
  '',
].join('\n')
const DEFAULT_EXPLORATION_PROGRAM = explorationTemplate()

/** On load, carry a profile into the current code form: a golem without a program gets one
 *  from its slot rows; legacy `def`-entry programs are rewritten to `Engram.X:`; the party
 *  navigator defaults to the tier-1 template. Idempotent. */
function migrateToCode(): void {
  for (const hero of roster) {
    const src = hero.program ?? ''
    hero.program = src.trim() === '' ? combatRowsToSource(hero.rows) : toEntryForm(src)
  }
  explorationProgram = explorationProgram.trim() === '' ? DEFAULT_EXPLORATION_PROGRAM : toEntryForm(explorationProgram)
}

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
const coreBudgetEl = requireElement('core-budget', HTMLDivElement)
const statEditorEl = requireElement('stat-editor', HTMLDivElement)
const logEl = requireElement('log', HTMLDivElement)
const musicBtn = requireElement('music-toggle', HTMLButtonElement)
const insightEl = requireElement('insight', HTMLSpanElement)
const openJournalBtn = requireElement('open-journal', HTMLButtonElement)
const modalWorkshopEl = requireElement('modal-workshop', HTMLDivElement)
const modalLibraryEl = requireElement('modal-library', HTMLDivElement)
const modalJournalEl = requireElement('modal-journal', HTMLDivElement)
const trainerListEl = requireElement('trainer-list', HTMLDivElement)
const codeMountEl = requireElement('code-mount', HTMLDivElement)
const codeErrorEl = requireElement('code-error', HTMLDivElement)
const exCodeMountEl = requireElement('ex-code-mount', HTMLDivElement)
const exCodeErrorEl = requireElement('ex-code-error', HTMLDivElement)
// Engram-manager (Library) + Workshop loader elements.
const engramTabsEl = requireElement('engram-tabs', HTMLDivElement)
const engramSelectEl = requireElement('engram-select', HTMLSelectElement)
const engramNewBtn = requireElement('engram-new', HTMLButtonElement)
const engramRenameBtn = requireElement('engram-rename', HTMLButtonElement)
const engramDeleteBtn = requireElement('engram-delete', HTMLButtonElement)
const engramMountEl = requireElement('engram-mount', HTMLDivElement)
const engramErrorEl = requireElement('engram-error', HTMLDivElement)
const loadCombatEl = requireElement('load-combat-engram', HTMLSelectElement)
const saveCombatBtn = requireElement('save-combat-engram', HTMLButtonElement)
const loadExEl = requireElement('load-ex-engram', HTMLSelectElement)
const saveExBtn = requireElement('save-ex-engram', HTMLButtonElement)

// Wire the Inscription interpreter into the pure sim (dependency injection — sim.ts
// never imports the language module). A golem carrying a `program` runs it instead of
// its slot `procedure`; everything else is unchanged.
setProgramDecider(decideCombatFromProgram)
setExplorationProgramDecider(decideExplorationFromProgram)

function toEditorError(r: CheckResult): { message: string; line?: number; col?: number } | null {
  return r.ok ? null : { message: r.message ?? 'error', line: r.line, col: r.col }
}

/** Persist + validate on every code edit (active golem's combat brain). */
function onCodeChange(src: string): void {
  const hero = roster[activeHero] as Hero | undefined
  if (hero === undefined) return
  hero.program = src
  codeEditor.setError(toEditorError(checkProgram(src)))
  persist()
}

let codeEditor: CodeEditorHandle = mountTextarea(codeMountEl, codeErrorEl, onCodeChange)

/** Sync the combat editor to the active golem (value, locked state, error line). */
function renderCodeBrain(): void {
  const hero = roster[activeHero] as Hero | undefined
  const src = hero?.program ?? ''
  codeEditor.setValue(src)
  codeEditor.setReadOnly(editingLocked() || hero === undefined)
  codeEditor.setError(toEditorError(checkProgram(src)))
}

/** Persist + validate the party's exploration navigator on every edit. */
function onExCodeChange(src: string): void {
  explorationProgram = src
  exCodeEditor.setError(toEditorError(checkProgram(src, 'exploration_turn')))
  persist()
}

const EX_PLACEHOLDER = 'Engram.exploration_turn:\n    nxt = senses.unexplored_exit\n    if nxt:\n        return move(nxt)\n    return retreat()'
let exCodeEditor: CodeEditorHandle = mountTextarea(exCodeMountEl, exCodeErrorEl, onExCodeChange, EX_PLACEHOLDER)

function renderExCodeBrain(): void {
  exCodeEditor.setValue(explorationProgram)
  exCodeEditor.setReadOnly(editingLocked())
  exCodeEditor.setError(toEditorError(checkProgram(explorationProgram, 'exploration_turn')))
}

// --- Engram manager (the Library: author named, reusable engrams) -----------
type EngramKind = 'combat' | 'exploration' | 'libs'
const ENGRAM_KINDS: Array<{ kind: EngramKind; label: string; entry: 'combat_turn' | 'exploration_turn' | null }> = [
  { kind: 'combat', label: 'Combat', entry: 'combat_turn' },
  { kind: 'exploration', label: 'Exploration', entry: 'exploration_turn' },
  { kind: 'libs', label: 'Library', entry: null },
]
let activeEngramKind: EngramKind = 'combat'
let activeEngramIndex = 0
const activeEngramList = (): NamedEngram[] => engrams[activeEngramKind]
const activeEngram = (): NamedEngram | undefined => activeEngramList()[activeEngramIndex]
const activeEngramEntry = (): 'combat_turn' | 'exploration_turn' | null =>
  ENGRAM_KINDS.find((k) => k.kind === activeEngramKind)?.entry ?? null

function uniqueEngramName(kind: EngramKind): string {
  const base = kind === 'libs' ? 'lib' : kind
  let n = 1
  while (engrams[kind].some((e) => e.name === `${base}${n}`)) n += 1
  return `${base}${n}`
}
function starterFor(kind: EngramKind): string {
  if (kind === 'combat') return DEFAULT_COMBAT_PROGRAM
  if (kind === 'exploration') return DEFAULT_EXPLORATION_PROGRAM
  return '# shared helpers — import this by name, then name.fn(...)\n# def weakest(senses):\n#     return senses.enemies.lowest_hp\n'
}

/** Persist + validate an engram edit; republish libs so `import` sees the change. */
function onEngramChange(src: string): void {
  const e = activeEngram()
  if (e === undefined) return
  e.src = src
  engramEditor.setError(toEditorError(checkProgram(src, activeEngramEntry())))
  if (activeEngramKind === 'libs') syncLibraries()
  persist()
}
let engramEditor: CodeEditorHandle = mountTextarea(engramMountEl, engramErrorEl, onEngramChange)

function renderEngramManager(): void {
  const locked = editingLocked()
  engramTabsEl.replaceChildren()
  for (const k of ENGRAM_KINDS) {
    const tab = document.createElement('button')
    tab.className = k.kind === activeEngramKind ? 'tab active' : 'tab'
    tab.textContent = `${k.label} (${engrams[k.kind].length})`
    tab.addEventListener('click', () => { activeEngramKind = k.kind; activeEngramIndex = 0; renderEngramManager() })
    engramTabsEl.appendChild(tab)
  }
  const list = activeEngramList()
  if (activeEngramIndex >= list.length) activeEngramIndex = Math.max(0, list.length - 1)
  engramSelectEl.replaceChildren()
  list.forEach((e, i) => {
    const opt = document.createElement('option')
    opt.value = String(i)
    opt.textContent = e.name
    if (i === activeEngramIndex) opt.selected = true
    engramSelectEl.appendChild(opt)
  })
  engramSelectEl.disabled = locked || list.length === 0
  engramNewBtn.disabled = locked
  engramRenameBtn.disabled = locked || list.length === 0
  engramDeleteBtn.disabled = locked || list.length === 0
  const e = activeEngram()
  engramEditor.setValue(e?.src ?? '')
  engramEditor.setReadOnly(locked || e === undefined)
  engramEditor.setError(e === undefined ? null : toEditorError(checkProgram(e.src, activeEngramEntry())))
}

engramSelectEl.addEventListener('change', () => { activeEngramIndex = Number(engramSelectEl.value); renderEngramManager() })
engramNewBtn.addEventListener('click', () => {
  if (editingLocked()) return
  engrams[activeEngramKind] = [...activeEngramList(), { name: uniqueEngramName(activeEngramKind), src: starterFor(activeEngramKind) }]
  activeEngramIndex = activeEngramList().length - 1
  if (activeEngramKind === 'libs') syncLibraries()
  renderEngramManager(); renderEngramLoaders(); persist()
})
engramRenameBtn.addEventListener('click', () => {
  const e = activeEngram()
  if (e === undefined || editingLocked()) return
  const name = window.prompt('Engram name', e.name)?.trim()
  if (name === undefined || name === '') return
  e.name = name
  if (activeEngramKind === 'libs') syncLibraries()
  renderEngramManager(); renderEngramLoaders(); persist()
})
engramDeleteBtn.addEventListener('click', () => {
  if (editingLocked() || activeEngram() === undefined) return
  engrams[activeEngramKind] = activeEngramList().filter((_, i) => i !== activeEngramIndex)
  activeEngramIndex = 0
  if (activeEngramKind === 'libs') syncLibraries()
  renderEngramManager(); renderEngramLoaders(); persist()
})

// --- Workshop loaders (copy-on-assign onto golems) --------------------------
function fillLoader(sel: HTMLSelectElement, list: NamedEngram[]): void {
  sel.replaceChildren()
  const ph = document.createElement('option')
  ph.value = ''
  ph.textContent = list.length > 0 ? 'Load engram…' : '(none yet)'
  sel.appendChild(ph)
  list.forEach((e, i) => {
    const o = document.createElement('option')
    o.value = String(i)
    o.textContent = e.name
    sel.appendChild(o)
  })
  sel.value = ''
}
function renderEngramLoaders(): void {
  const locked = editingLocked()
  const hasHero = roster[activeHero] !== undefined
  fillLoader(loadCombatEl, engrams.combat)
  fillLoader(loadExEl, engrams.exploration)
  loadCombatEl.disabled = locked || !hasHero || engrams.combat.length === 0
  saveCombatBtn.disabled = locked || !hasHero
  loadExEl.disabled = locked || engrams.exploration.length === 0
  saveExBtn.disabled = locked
}
function upsertEngram(list: NamedEngram[], name: string, src: string): NamedEngram[] {
  const i = list.findIndex((e) => e.name === name)
  if (i < 0) return [...list, { name, src }]
  const copy = [...list]
  copy[i] = { name, src }
  return copy
}
loadCombatEl.addEventListener('change', () => {
  const hero = roster[activeHero] as Hero | undefined
  const e = engrams.combat[Number(loadCombatEl.value)]
  if (hero === undefined || e === undefined || editingLocked()) return
  hero.program = e.src // copy-on-assign
  renderCodeBrain(); persist()
})
loadExEl.addEventListener('change', () => {
  const e = engrams.exploration[Number(loadExEl.value)]
  if (e === undefined || editingLocked()) return
  explorationProgram = e.src // copy-on-assign
  renderExCodeBrain(); persist()
})
saveCombatBtn.addEventListener('click', () => {
  const hero = roster[activeHero] as Hero | undefined
  if (hero === undefined || editingLocked()) return
  const name = window.prompt('Save combat engram as', uniqueEngramName('combat'))?.trim()
  if (name === undefined || name === '') return
  engrams.combat = upsertEngram(engrams.combat, name, hero.program ?? '')
  renderEngramLoaders(); persist()
})
saveExBtn.addEventListener('click', () => {
  if (editingLocked()) return
  const name = window.prompt('Save exploration engram as', uniqueEngramName('exploration'))?.trim()
  if (name === undefined || name === '') return
  engrams.exploration = upsertEngram(engrams.exploration, name, explorationProgram)
  renderEngramLoaders(); persist()
})

// Upgrade the Workshop's combat + exploration editors to CodeMirror (lazy chunk; the
// engram-manager editor stays a textarea since its kind/entry change per tab). On failure
// we simply keep the textareas.
async function upgradeEditorsToCodeMirror(): Promise<void> {
  try {
    const { mountCodeMirror } = await import('./lang/editor-cm')
    codeEditor = mountCodeMirror(codeMountEl, codeErrorEl, onCodeChange, {
      entry: 'combat_turn', kind: 'combat',
      placeholder: 'Engram.combat_turn:\n    return attack(senses.enemies.lowest_hp)',
    })
    exCodeEditor = mountCodeMirror(exCodeMountEl, exCodeErrorEl, onExCodeChange, {
      entry: 'exploration_turn', kind: 'exploration', placeholder: EX_PLACEHOLDER,
    })
    renderCodeBrain()
    renderExCodeBrain()
  } catch (err) {
    log.error('[editor] CodeMirror failed to load; staying on the textarea', err)
  }
}
void upgradeEditorsToCodeMirror()

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
  // roster holds (0–4 golems). Each golem is built from its authored stat block; a
  // golem with no authored stats is unbuilt (ZERO_STATS → 0 HP).
  return roster.map((hero) => makeGolem({
    id: hero.simId,
    name: hero.name,
    stats: hero.stats ?? ZERO_STATS,
    procedure: procedureFor(hero),
    program: programOf(hero),
  }))
}

/** A golem's code brain if it has a non-empty one, else undefined (so the slot
 *  `procedure` path runs). An all-whitespace program is treated as "no program". */
function programOf(hero: Hero): string | undefined {
  const src = hero.program
  return src !== undefined && src.trim() !== '' ? src : undefined
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
  if (roster.length === 0) return // need at least one golem to delve
  freezeBuild() // committing to a delve locks the point-buy: spent points become permanent
  lastDelveLog = [] // a fresh run — the previous journal no longer applies
  delve = startDelve(party(), newSeed(), explorationProcedure(), levelById(selectedLevelId), explorationProgram.trim() === '' ? undefined : explorationProgram)
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
  saveSlot(activeSlot, { roster, activeHero, exploration, explorationProgram, library, engrams, clearedLevels, insight, unlocked, mode, delve })
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
  ensureStats() // give every loaded hero an editable stat block (additive on next save)
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
  explorationProgram = ''
  library = ''
  engrams = { combat: [], exploration: [], libs: [] }
  syncLibraries()
  migrateToCode()
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
  explorationProgram = saved.explorationProgram ?? ''
  library = saved.library ?? ''
  engrams = {
    combat: saved.engrams?.combat ?? [],
    exploration: saved.engrams?.exploration ?? [],
    libs: saved.engrams?.libs ?? [],
  }
  migrateLibrary() // fold legacy single `library` into engrams.libs as "lib"
  syncLibraries()
  migrateToCode()
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

function makeButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.title = title
  btn.addEventListener('click', onClick)
  return btn
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
    const empty = roster.length === 0
    launch.disabled = empty
    const hint = empty
      ? 'Forge a golem in the Workshop first'
      : `${levelById(selectedLevelId).name} — never the same twice`
    runBarEl.append(launch, makeHint(hint))
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
          : delve.status === 'left'
            ? 'Your golems withdrew to town'
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
    const { slots } = level.topology
    const mandatory = slots.filter((sl) => sl.optional !== true).length
    meta.textContent = mandatory === slots.length ? `${mandatory} rooms` : `${mandatory}–${slots.length} rooms`

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

  if (openBuilding === 'library') { renderEngramManager(); renderTrainer() }
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
  renderCores() // the point-buy stat editor + budget meter track the active golem
}

// --- Point-buy core editor (slice d-3) --------------------------------------
// The player authors each golem's six stats here, within a shared build budget.
// Stats live on the persisted Hero; the budget math is the pure party.ts.

const STAT_ROWS: ReadonlyArray<{ key: keyof Stats; label: string; hint: string }> = [
  { key: 'might', label: 'Might', hint: 'attack damage (− target Ward)' },
  { key: 'ward', label: 'Ward', hint: 'flat damage reduction' },
  { key: 'fortitude', label: 'Fortitude', hint: 'HP pool' },
  { key: 'attunement', label: 'Attunement', hint: 'skill potency (Mend)' },
  { key: 'poise', label: 'Poise', hint: 'Strain tolerance before overdraw' },
  { key: 'celerity', label: 'Celerity', hint: 'turn frequency' },
]

/** This golem's current stat block (an unbuilt golem reads as all-zeros). */
function statsOf(hero: Hero): Stats {
  return hero.stats ?? ZERO_STATS
}

/** This golem's FROZEN floor — the points committed on a past Descend, which can no
 *  longer be refunded. Absent (a golem forged this town visit) = an all-zero floor,
 *  so every point spent on it is still refundable until the next Descend. */
function committedOf(hero: Hero): Stats {
  return hero.committed ?? ZERO_STATS
}

/** A golem is FROZEN once it has been taken on a Descend — its chassis and committed
 *  stats are permanent (can't be removed/refunded; stats only rise from the floor). */
function isFrozen(hero: Hero | undefined): boolean {
  return hero?.committed !== undefined
}

/** Materialise a stat block on every hero that lacks one (legacy/edge), so the editor
 *  edits a real object. */
function ensureStats(): void {
  roster.forEach((_, i) => {
    roster[i].stats ??= { ...ZERO_STATS }
  })
}

/** Every golem's current stat block — the input to the budget math. */
function rosterStats(): Stats[] {
  return roster.map(statsOf)
}

/** Budget points still unspent (negative = over budget). */
function budgetLeft(): number {
  return BUILD_BUDGET - buildCost(rosterStats())
}

/** A unique `hero-N` sim id not already used by the roster. */
function freshSimId(): string {
  const nums = roster.map((h) => Number.parseInt(h.simId.replace('hero-', ''), 10)).filter((n) => !Number.isNaN(n))
  return `hero-${Math.max(0, ...nums) + 1}`
}

/** Freeze the current allocation: every golem's committed floor becomes its current
 *  stats, so the points spent this town visit can never be refunded. Called on Descend
 *  — the act of committing to a delve is what locks the build in. */
function freezeBuild(): void {
  roster.forEach((_, i) => {
    roster[i].committed = { ...statsOf(roster[i]) }
  })
}

function adjustStat(key: keyof Stats, delta: number): void {
  if (editingLocked()) return
  const hero = roster[activeHero] as Hero | undefined
  if (hero === undefined) return
  ensureStats()
  const { stats } = hero
  if (stats === undefined) return
  const next = stats[key] + delta
  if (next > STAT_CAP) return
  if (next < committedOf(hero)[key]) return // can't refund a frozen point — only spend above the floor
  if (delta > 0 && budgetLeft() < 1) return // can't overspend the budget
  stats[key] = next
  renderTabs() // cascades the stat editor + budget; refreshes the tab's HP readout
  saveNow()
}

function addGolem(): void {
  if (editingLocked() || roster.length >= GOLEM_MAX || budgetLeft() < CHASSIS_COST) return
  roster.push({
    simId: freshSimId(),
    name: `Golem ${roster.length + 1}`,
    stats: { ...ZERO_STATS },
    rows: freshGolemRows(),
    program: DEFAULT_COMBAT_PROGRAM,
  })
  activeHero = roster.length - 1
  renderTabs()
  renderEditor()
  renderRunBar() // roster 0→≥1 flips the Descend button from disabled — refresh it
  saveNow()
}

function removeGolem(): void {
  // Only a golem forged THIS town visit (not yet frozen on a Descend) can be disbanded
  // — a committed golem is permanent. Refunds its chassis + pending points.
  if (editingLocked() || isFrozen(roster[activeHero])) return
  roster.splice(activeHero, 1)
  activeHero = Math.max(0, Math.min(activeHero, roster.length - 1))
  renderTabs()
  renderEditor()
  renderRunBar() // back to 0 golems re-disables Descend (and restores the hint)
  saveNow()
}

function renderCoreBudget(): void {
  coreBudgetEl.replaceChildren()
  const locked = editingLocked()
  const left = budgetLeft()
  const meter = document.createElement('div')
  meter.className = left < 0 ? 'budget over' : 'budget'
  const count = roster.length === 0 ? 'no golems yet' : `${roster.length} golem${roster.length > 1 ? 's' : ''}`
  meter.textContent = left < 0
    ? `Budget ${BUILD_BUDGET - left} / ${BUILD_BUDGET} · ${count} · over by ${-left}`
    : `Budget ${BUILD_BUDGET - left} / ${BUILD_BUDGET} · ${count} · ${left} left`
  const add = makeButton('+ Golem', 'Forge another golem (costs 3 chassis)', addGolem)
  add.disabled = locked || roster.length >= GOLEM_MAX || left < CHASSIS_COST
  const rem = makeButton('− Golem', 'Disband this golem (only before it has delved)', removeGolem)
  rem.disabled = locked || roster.length === 0 || isFrozen(roster[activeHero])
  coreBudgetEl.append(meter, add, rem)
}

function renderStatEditor(): void {
  statEditorEl.replaceChildren()
  const hero = roster[activeHero] as Hero | undefined
  if (hero === undefined) {
    const empty = document.createElement('div')
    empty.className = 'stat-empty'
    empty.textContent = 'No golem selected — forge one with “+ Golem” to spend your build budget.'
    statEditorEl.append(empty)
    return
  }
  const locked = editingLocked()
  const stats = statsOf(hero)
  const floor = committedOf(hero) // frozen points: can't be lowered past here
  const left = budgetLeft()
  for (const { key, label, hint } of STAT_ROWS) {
    const row = document.createElement('div')
    row.className = 'stat-row'
    const name = document.createElement('span')
    name.className = 'stat-name'
    name.textContent = label
    name.title = hint
    const dec = makeButton('−', `Lower ${label}`, () => { adjustStat(key, -1); })
    dec.disabled = locked || stats[key] <= floor[key] // can't refund a frozen point
    const val = document.createElement('span')
    val.className = 'stat-val'
    val.textContent = String(stats[key])
    if (floor[key] > 0) val.title = `${floor[key]} locked (already delved)`
    const inc = makeButton('+', `Raise ${label}`, () => { adjustStat(key, 1); })
    inc.disabled = locked || stats[key] >= STAT_CAP || left < 1
    row.append(name, dec, val, inc)
    statEditorEl.append(row)
  }
}

function renderCores(): void {
  renderCoreBudget()
  renderStatEditor()
}

// Built with DOM APIs (not innerHTML) — safe, and keeps live event handlers.
// The Workshop authors behaviour as CODE now (the slot Procedure editor was retired).
// These two keep their names — many call sites refresh "the editor" — but each just
// syncs its code editor(s) to the active golem / party.
function renderEditor(): void {
  enabledLis = [] // no slot rows to highlight anymore; keeps highlightFiringProtocol a no-op
  renderCodeBrain()
  renderEngramLoaders()
}

function renderExEditor(): void {
  renderExCodeBrain()
  renderEngramLoaders()
}

// Map a delve-log kind to one of the existing log-entry colour classes.
const LOG_CLASS: Record<string, string> = { explore: 'defend', enter: 'flee', combat: 'attack', clear: 'heal', end: 'counter', boon: 'heal' }

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
  const activeId = (roster[activeHero] as Hero | undefined)?.simId
  if (last === undefined || activeId === undefined || last.actorId !== activeId) return
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

// The log-kind → sound map, ASSEMBLED FROM CONTENT (not a hardcoded switch): each
// Skill and Command declares its own `sfx` (an opaque key), and we collect them here,
// validating each against the audio module's SfxId set. A skill's log-kind is its
// `kind` (heal/defend); a command's is its id (attack). So adding a skill with a sound
// is a field in its content file — this map picks it up, no edit here.
const KIND_SFX = ((): Map<string, SfxId> => {
  const m = new Map<string, SfxId>()
  const put = (logKind: string, key: string | undefined): void => {
    if (key === undefined) return
    if (!isSfxId(key)) throw new Error(`Unknown sfx id "${key}" for "${logKind}"`)
    m.set(logKind, key)
  }
  for (const s of SKILLS) put(s.kind, s.sfx) // heal → heal, defend → defend
  for (const c of COMMANDS) put(c.id, c.sfx) // attack → attack (useSkill/flee declare none)
  return m
})()

// Pick the clip for a log entry. The acting maneuver's own sound comes from the
// content map; the perspective sounds stay view rules: an enemy's blow (your golem
// TAKING a hit) and a counter both play `hit` — "damage to a hero", not a content
// sound. `flee` is silent.
function sfxFor(e: GameState['log'][number], battle: GameState): SfxId | null {
  if (e.kind === 'counter') return 'hit'
  if (e.kind === 'attack') {
    const actor = battle.units.find((u) => u.id === e.actorId)
    if (actor?.side !== 'hero') return 'hit' // your golem is taking the hit
  }
  return KIND_SFX.get(e.kind) ?? null
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
