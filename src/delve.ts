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

import {
  generateDungeon,
  roomCenter,
  roomAt,
  cellIndex,
  floorNeighbours,
  dirBetween,
  type Dungeon,
  type Dir,
} from './dungeon'
import { makeBattle, step, restToConvergence, type Combatant, type GameState } from './sim'
import { LEVELS, type LevelConfig } from './levels'

// --- Exploration Protocol: WHEN <Subject + Predicate> → Move ----------------

export type ExSubject =
  | { what: 'target' } // the objective room
  | { what: 'unexplored' } // the exploration frontier
  | { what: 'exit' } // the entrance (for retreat)

export type ExPredicate =
  | { p: 'always' }
  | { p: 'known' } // a subject of this kind is currently discovered & reachable
  | { p: 'partyHpPctBelow'; value: number }

export type ExMove = 'headToward' | 'retreat' | 'rest'

// One exploration rule: WHEN <State> → DO <Move>. A single Protocol, mirroring a
// combat Protocol in sim.ts (Procedure = Protocol[] there too).
export interface ExProtocol {
  subject: ExSubject
  predicate: ExPredicate
  move: ExMove
  label: string
}

// The party's whole exploration program: an ordered list of Protocols (priority =
// order). The exploration twin of sim.ts's Procedure.
export type ExProcedure = ExProtocol[]

/** Default (hardcoded) exploration Procedure: beeline to the objective once seen,
 *  else explore. */
export const DEFAULT_EXPLORATION: ExProcedure = [
  { subject: { what: 'target' }, predicate: { p: 'known' }, move: 'headToward', label: 'Target · known → head toward' },
  { subject: { what: 'unexplored' }, predicate: { p: 'always' }, move: 'headToward', label: 'Unexplored · Always → head toward' },
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
  explored[cell] = true
  for (const nb of floorNeighbours(d, cell)) explored[nb] = true
  const rid = roomAt(d, cell)
  if (rid >= 0) {
    const r = d.rooms[rid]
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) explored[y * d.width + x] = true
  }
}

/** First step on the shortest path from `from` to `goal` through `passable`
 *  cells (the goal itself is always allowed). -1 if unreachable. */
function stepTowardKnown(d: Dungeon, from: number, goal: number, passable: (c: number) => boolean): number {
  if (from === goal) return from
  const prev = new Map<number, number>()
  const seen = new Set<number>([from])
  const queue = [from]
  for (let h = 0; h < queue.length; h++) {
    for (const nb of floorNeighbours(d, queue[h])) {
      if (seen.has(nb) || (nb !== goal && !passable(nb))) continue
      seen.add(nb)
      prev.set(nb, queue[h])
      if (nb === goal) return firstStep(prev, from, goal)
      queue.push(nb)
    }
  }
  return -1
}

/** Step toward (and finally into) the nearest exploration frontier. -1 if none. */
function stepTowardFrontier(d: Dungeon, from: number, explored: boolean[]): number {
  // already at the edge of the known? step straight into the unknown
  for (const nb of floorNeighbours(d, from)) if (!explored[nb]) return nb
  const prev = new Map<number, number>()
  const seen = new Set<number>([from])
  const queue = [from]
  for (let h = 0; h < queue.length; h++) {
    for (const nb of floorNeighbours(d, queue[h])) {
      if (!explored[nb] || seen.has(nb)) continue // only travel through the known
      seen.add(nb)
      prev.set(nb, queue[h])
      if (floorNeighbours(d, nb).some((n2) => !explored[n2])) return firstStep(prev, from, nb) // nb is a frontier
      queue.push(nb)
    }
  }
  return -1
}

/** Reconstruct the first step of a BFS path (walk parents back to `from`). */
function firstStep(prev: Map<number, number>, from: number, goal: number): number {
  let cur = goal
  let parent = prev.get(cur)
  while (parent !== undefined && parent !== from) {
    cur = parent
    parent = prev.get(cur)
  }
  return parent === from ? cur : -1
}

// --- Exploration decision ---------------------------------------------------

function entranceCell(d: Dungeon): number {
  const c = roomCenter(d.rooms[d.entranceRoomId])
  return cellIndex(d, c.x, c.y)
}

/** The nearest explored cell of the objective room, or -1 if undiscovered. */
function knownObjectiveCell(s: DelveState): number {
  const obj = s.dungeon.rooms[s.dungeon.objectiveRoomId]
  let best = -1
  let bestDist = Infinity
  for (let y = obj.y; y < obj.y + obj.h; y++) {
    for (let x = obj.x; x < obj.x + obj.w; x++) {
      const c = y * s.dungeon.width + x
      if (!s.explored[c]) continue
      const dist = Math.abs(x - (s.pos % s.dungeon.width)) + Math.abs(y - ((s.pos / s.dungeon.width) | 0))
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    }
  }
  return best
}

function partyHpPct(party: Combatant[]): number {
  const living = party.filter((u) => u.hp > 0)
  if (living.length === 0) return 0
  return (living.reduce((a, u) => a + u.hp / u.maxHp, 0) / living.length) * 100
}

interface ExDecision {
  reason: string
  step: number // next cell to move to, or -1 if the rule yields no move
}

/** The move for one Protocol, or null if its State doesn't hold / yields no step. */
function protocolStep(s: DelveState, protocol: ExProtocol): ExDecision | null {
  const d = s.dungeon
  const known = (c: number): boolean => s.explored[c]

  // resolve the subject to a goal cell + whether it's currently "known"
  let goal = -1
  if (protocol.subject.what === 'exit') goal = entranceCell(d)
  else if (protocol.subject.what === 'target') goal = knownObjectiveCell(s)
  // 'unexplored' has no fixed goal — it's the frontier (handled by the move)

  const isKnown =
    protocol.subject.what === 'unexplored'
      ? stepTowardFrontier(d, s.pos, s.explored) !== -1
      : goal !== -1

  // predicate
  if (protocol.predicate.p === 'known' && !isKnown) return null
  if (protocol.predicate.p === 'partyHpPctBelow' && partyHpPct(s.party) >= protocol.predicate.value) return null

  // move → step
  let step = -1
  if (protocol.move === 'rest') step = s.pos // rest in place (no move)
  else if (protocol.move === 'retreat') step = stepTowardKnown(d, s.pos, entranceCell(d), known)
  else if (protocol.subject.what === 'unexplored') step = stepTowardFrontier(d, s.pos, s.explored)
  else if (goal !== -1) step = stepTowardKnown(d, s.pos, goal, known)

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

/** Advance the delve by one tick: a combat action if mid-fight, else one move. */
export function stepDelve(s: DelveState): DelveState {
  if (s.status !== 'delving') return s
  const d = s.dungeon
  const turn = s.turn + 1
  if (turn > MAX_DELVE_STEPS) {
    return { ...s, turn, status: 'stuck', log: logged(s, turn, { kind: 'end', reason: 'safety cap', detail: 'delve exceeded the step cap' }) }
  }

  // --- mid-combat: advance the fight ---
  if (s.battle !== null) {
    const battle = step(s.battle)
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

  // --- exploring: decide and move one cell ---
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
