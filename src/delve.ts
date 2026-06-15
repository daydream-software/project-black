// The DELVE state machine — PURE and headless (slice 8a-2). The party crawls a
// generated dungeon on its own, driven by an Exploration Protocol (the same
// WHEN <State> → DO grammar as combat, over dungeon Subjects/Predicates/Moves),
// fighting the monster rooms it enters and hunting the objective.
//
// Constraints baked in (see the slice-8 plan):
// - FRONTIER exploration: the party only navigates through cells it has SEEN; the
//   `target` is invalid until its room is discovered (the `known` predicate gates
//   it). It cannot path through unknown space.
// - TERMINATION: every step makes progress or flips to a terminal status
//   (cleared / dead / stuck); a defensive cap guarantees no infinite catch-up.
// - The generated dungeon is stored WHOLE in the state (never regenerated); the
//   whole state is JSON-serialisable (save/offline-replay safe).
// - The log records the exploration DECISION (which rule fired), not just moves.

import { generateDungeon, roomAt, floorNeighbours, dirBetween, type Dungeon, type Dir } from './dungeon'
import { makeBattle, step, restToConvergence, type Combatant, type GameState } from './sim'
import { LEVELS, type LevelConfig } from './levels'
import { entranceCell } from './content/exploration/navigation'
import { EX_SUBJECTS_BY_ID } from './content/exploration/subjects'
import { EX_PREDICATES_BY_ID } from './content/exploration/predicates'
import { EX_MOVES_BY_ID } from './content/exploration/moves'

// --- Exploration Protocol: WHEN <Subject + Predicate> → Move ----------------
//
// The exploration twin of the combat rule language. Like combat, the ENGINE knows no
// variants — each vocabulary piece carries its own behaviour (content/exploration/),
// and decideExploration only orchestrates. A Subject is a dungeon destination that
// knows how to step toward itself and whether it's reachable; a Predicate tests the
// state (the `known` predicate asks its Subject); a Move turns the Subject + state
// into the next cell. Adding a destination / move / condition is a new content file.

export interface ExSubjectDef {
  id: string
  label: string
  order: number
  unlock?: string
  /** Next cell to step toward this subject from the party's position (-1 if none). */
  stepToward: (s: DelveState) => number
  /** Is this subject currently discovered & pathable? (gates the `known` predicate.) */
  reachable: (s: DelveState) => boolean
}

export interface ExPredicateDef {
  id: string
  label: string
  order: number
  unlock?: string
  /** Holds for the current delve state. `known` consults its Subject's `reachable`. */
  holds: (s: DelveState, subject: ExSubjectDef) => boolean
}

export interface ExMoveDef {
  id: string
  label: string
  order: number
  unlock?: string
  /** The cell the party moves to: its OWN `pos` = rest in place, -1 = no move. */
  resolve: (s: DelveState, subject: ExSubjectDef) => number
}

// One exploration rule: WHEN <Subject + Predicate> → DO <Move>. Like a combat
// Protocol, it references its vocab by **id** (serialisable — so a saved in-progress
// delve round-trips through JSON); the delve resolves the behaviour-bearing defs from
// the registries at runtime.
export interface ExProtocol {
  subject: string
  predicate: string
  move: string
  label: string
}

// The party's whole exploration program: an ordered list of Protocols (priority =
// order). The exploration twin of sim.ts's Procedure.
export type ExProcedure = ExProtocol[]

/** Default exploration Procedure: beeline to the objective once seen, else explore.
 *  Id-based (the same ids the editor persists) — protocol.test pins that the compiled
 *  DEFAULT_EX_ROWS equal this, so the two can't drift. */
export const DEFAULT_EXPLORATION: ExProcedure = [
  { subject: 'target', predicate: 'known', move: 'head', label: 'Target · known → head toward' },
  { subject: 'unexplored', predicate: 'always', move: 'head', label: 'Unexplored · Always → head toward' },
]

// --- Delve state ------------------------------------------------------------

export type DelveStatus = 'delving' | 'cleared' | 'dead' | 'stuck'

export interface DelveLogEntry {
  turn: number
  kind: 'explore' | 'enter' | 'combat' | 'clear' | 'end'
  reason: string
  detail: string
}

export interface DelveState {
  seed: number
  levelId: string // which level this delve is a run of (first-clear tracking, 10a)
  rng: number // live rng state (starts where generation left off)
  dungeon: Dungeon // stored whole; never regenerated
  party: Combatant[] // hero units; HP/deaths persist across the delve
  pos: number // party cell index
  facing: Dir
  explored: boolean[] // fog of war (length = cells.length)
  clearedRooms: boolean[] // length = rooms.length
  exploration: ExProcedure
  battle: GameState | null // active combat, or null when exploring
  status: DelveStatus
  turn: number
  log: DelveLogEntry[]
}

const MAX_DELVE_STEPS = 4000 // defensive cap — a healthy delve ends far sooner

// --- Fog-of-war reveal + frontier pathfinding -------------------------------

/** Reveal a cell, its floor neighbours, and (if it's in a room) the whole room. */
function reveal(d: Dungeon, cell: number, explored: boolean[]): void {
  /* eslint-disable no-param-reassign -- fills the caller-owned fog buffer in place
     (callers pass `s.explored.slice()`, a local copy); the fog-of-war idiom. */
  explored[cell] = true
  for (const nb of floorNeighbours(d, cell)) explored[nb] = true
  const rid = roomAt(d, cell)
  if (rid >= 0) {
    const r = d.rooms[rid]
    for (let {y} = r; y < r.y + r.h; y += 1) for (let {x} = r; x < r.x + r.w; x += 1) explored[y * d.width + x] = true
  }
  /* eslint-enable no-param-reassign */
}

// --- Exploration decision: the engine only orchestrates ---------------------
// The navigation primitives (BFS to a goal / to the frontier, objective + entrance
// cells, party HP) live in content/exploration/navigation.ts; the Subject/Predicate/
// Move behaviour lives in their content files. This layer just runs filter-then-move.

interface ExDecision {
  reason: string
  step: number // next cell to move to (party's own pos = rest), or -1 = no move
}

/** One Protocol's decision: resolve its vocab from the registries by id (a stale id →
 *  inert), then if its Predicate holds, ask its Move for the next cell. -1 (no move)
 *  means the rule doesn't apply — scan continues. */
function protocolStep(s: DelveState, protocol: ExProtocol): ExDecision | null {
  const subject = EX_SUBJECTS_BY_ID.get(protocol.subject)
  const predicate = EX_PREDICATES_BY_ID.get(protocol.predicate)
  const move = EX_MOVES_BY_ID.get(protocol.move)
  if (subject === undefined || predicate === undefined || move === undefined) return null
  if (!predicate.holds(s, subject)) return null
  const step = move.resolve(s, subject)
  return step === -1 ? null : { reason: protocol.label, step }
}

/** Scan the Procedure top-to-bottom; the first Protocol that yields a move wins. */
export function decideExploration(s: DelveState): ExDecision {
  for (const protocol of s.exploration) {
    const decided = protocolStep(s, protocol)
    if (decided !== null) return decided
  }
  return { reason: 'no rule applied', step: -1 }
}

// --- Start + step -----------------------------------------------------------

export function startDelve(
  party: Combatant[],
  seed: number,
  exploration: ExProcedure = DEFAULT_EXPLORATION,
  level: LevelConfig = LEVELS[0],
): DelveState {
  const { dungeon, rngState } = generateDungeon(seed, level)
  const pos = entranceCell(dungeon)
  const explored = new Array<boolean>(dungeon.cells.length).fill(false)
  reveal(dungeon, pos, explored)
  return {
    seed,
    levelId: level.id,
    rng: rngState,
    dungeon,
    party,
    pos,
    facing: 2, // facing South to start
    explored,
    clearedRooms: new Array<boolean>(dungeon.rooms.length).fill(false),
    exploration,
    battle: null,
    status: 'delving',
    turn: 0,
    log: [],
  }
}

function logged(s: DelveState, turn: number, e: Omit<DelveLogEntry, 'turn'>): DelveLogEntry[] {
  return [...s.log, { turn, ...e }].slice(-60)
}

/** Mid-fight: advance the battle one action; on a finish, resolve the room — a wipe
 *  (dead), a pack cleared, or the objective slain (delve cleared). */
function advanceCombat(s: DelveState, turn: number, current: GameState): DelveState {
  const d = s.dungeon
  const battle = step(current)
  const party = battle.units.filter((u) => u.side === 'hero').map((u) => ({ ...u }))
  if (battle.outcome === 'ongoing') {
    return { ...s, battle, turn, log: logged(s, turn, { kind: 'combat', reason: 'fighting', detail: battle.log.at(-1)?.detail ?? '' }) }
  }
  if (battle.outcome === 'defeat') {
    return { ...s, party, battle, turn, status: 'dead', log: logged(s, turn, { kind: 'end', reason: 'wiped out', detail: 'the party fell in the dungeon' }) }
  }
  // victory: the room is cleared
  const rid = roomAt(d, s.pos)
  const clearedRooms = s.clearedRooms.slice()
  if (rid >= 0) clearedRooms[rid] = true
  const wasObjective = rid === d.objectiveRoomId
  return {
    ...s,
    party,
    battle: null,
    clearedRooms,
    turn,
    status: wasObjective ? 'cleared' : 'delving',
    log: logged(s, turn, wasObjective
      ? { kind: 'end', reason: 'objective slain', detail: 'the delve is cleared!' }
      : { kind: 'clear', reason: 'room cleared', detail: 'the pack is dead' }),
  }
}

/** Exploring: decide and move one cell — rest in place, get stuck, or step (entering
 *  an uncleared monster/objective room starts a fight). */
function advanceMove(s: DelveState, turn: number): DelveState {
  const d = s.dungeon
  const decision = decideExploration(s)
  if (decision.step < 0) {
    return { ...s, turn, status: 'stuck', log: logged(s, turn, { kind: 'end', reason: 'no path forward', detail: 'the party is stuck' }) }
  }

  const next = decision.step
  if (next === s.pos) {
    // a 'rest' — NOT a movement step: the party tends itself off-combat by running
    // its own Mend rules to convergence (same Attunement potency, same Poise/Strain
    // budget as in combat). A party with no healer gets nothing; the Strain it spends
    // carries into the next fight. ("si c'est un repos, ce n'est pas un pas.")
    const { units: party, mends } = restToConvergence(s.party)
    const detail = mends > 0 ? `rest — ${mends} mend${mends > 1 ? 's' : ''}` : 'rest — nothing to mend'
    return { ...s, party, turn, log: logged(s, turn, { kind: 'explore', reason: decision.reason, detail }) }
  }

  const facing = dirBetween(d.width, s.pos, next)
  const explored = s.explored.slice()
  reveal(d, next, explored)

  // entering an uncleared monster room (or the objective) starts a fight
  const rid = roomAt(d, next)
  let battle: GameState | null = null
  let kind: DelveLogEntry['kind'] = 'explore'
  let detail = `move to cell ${next}`
  if (rid >= 0 && !s.clearedRooms[rid]) {
    const room = d.rooms[rid]
    if (room.type === 'monster') {
      battle = makeBattle(s.party, 'pack')
      kind = 'enter'
      detail = 'entered a monster room — fight!'
    } else if (room.type === 'target') {
      battle = makeBattle(s.party, 'warden')
      kind = 'enter'
      detail = 'reached the objective — the boss awaits!'
    }
  }

  return { ...s, pos: next, facing, explored, battle, turn, log: logged(s, turn, { kind, reason: decision.reason, detail }) }
}

/** Advance the delve by one tick: a combat action if mid-fight, else one move. */
export function stepDelve(s: DelveState): DelveState {
  if (s.status !== 'delving') return s
  const turn = s.turn + 1
  if (turn > MAX_DELVE_STEPS) {
    return { ...s, turn, status: 'stuck', log: logged(s, turn, { kind: 'end', reason: 'safety cap', detail: 'delve exceeded the step cap' }) }
  }
  if (s.battle !== null) return advanceCombat(s, turn, s.battle)
  return advanceMove(s, turn)
}
