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

import { generateGraph, type DungeonGraph, type RoomType, type LevelSkeleton, type Corridor } from './mapgraph'
import { makeBattleFrom, step, restToConvergence, type Combatant, type GameState, type ReactionRef } from './sim'
import { LEVELS } from './levels'
import { makeRng, range, pick } from './rng'
import { EX_SUBJECTS_BY_ID } from './content/exploration/subjects'
import { EX_PREDICATES_BY_ID } from './content/exploration/predicates'
import { EX_MOVES_BY_ID } from './content/exploration/moves'
import { TRAPS_BY_ID } from './content/exploration/traps'
import { BUFFS_BY_ID } from './content/exploration/buffs'

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
  /** Next ROOM to step toward this subject from the party's room ('' if none). */
  stepToward: (s: DelveState) => string
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
  /** The ROOM the party moves to: its OWN `pos` = rest in place, '' = no move. */
  resolve: (s: DelveState, subject: ExSubjectDef) => string
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

export type DelveStatus = 'delving' | 'cleared' | 'dead' | 'stuck' | 'left'

export interface DelveLogEntry {
  turn: number
  kind: 'explore' | 'enter' | 'combat' | 'clear' | 'end' | 'trap' | 'boon'
  reason: string
  detail: string
}

/** A trap a corridor OWNS (content/exploration/traps/), dispatched by id. It fires when
 *  the party traverses the corridor: returns the party after its effect + a journal
 *  detail. The delve twin of a combat reaction — owned by the map, not a unit. */
export interface TrapDef {
  id: string
  trigger: (party: Combatant[], ref: ReactionRef) => { party: Combatant[]; detail: string }
}

/** A run-scoped BOON a buff room grants (content/exploration/buffs/), dispatched by id.
 *  A buff is one standalone file carrying its whole behaviour:
 *  - `apply` is the one-shot transform when it's COLLECTED (double a party stat, full
 *    heal, reveal the map) — pure, returns the new delve state.
 *  - `onSpawn` is an optional LASTING hook: it rewrites each enemy built for the rest of
 *    the run (e.g. halving Fortitude) — the foes don't exist at pickup, so this can't be
 *    an `apply`. Only the collected buff IDS persist (serialisable); both hooks are
 *    resolved from the registry at runtime — the delve twin of a combat reaction. */
export interface BuffDef {
  id: string
  label: string
  order: number
  apply?: (s: DelveState) => DelveState
  onSpawn?: (enemy: Combatant) => Combatant
}

export interface DelveState {
  seed: number
  levelId: string // which level this delve is a run of (first-clear tracking, 10a)
  level: LevelSkeleton // the level's roll-time content (monster/buff pools, boss), carried
  // WHOLE so the delve is self-contained — rolls read this, never a global registry lookup.
  rng: number // live rng state (starts where generation left off; advances on pack rolls)
  graph: DungeonGraph // the room graph, stored whole; never regenerated
  party: Combatant[] // hero units; HP/deaths persist across the delve
  pos: string // current room id
  explored: string[] // room ids the party has ENTERED (fog of war; serialisable)
  cleared: string[] // fight/boss room ids already cleared
  resolved: string[] // reward rooms (buff/loot) already collected — never re-grants
  revealed: string[] // room ids whose TYPE is known beyond the 1-hop peek (vision buffs)
  buffs: string[] // ids of run-scoped boons collected (apply ran; onSpawn folds on spawn)
  exploration: ExProcedure
  // The party's CODE navigator (Inscription source). When present + non-empty it
  // OVERRIDES the `exploration` slot rows (via the DI program decider). Serialisable.
  explorationProgram?: string
  // Party-wide, delve-scoped Memory the navigator builds (serialisable JSON; the
  // program owns its shape). Absent = empty. Resets each delve (a fresh dungeon).
  memory?: unknown
  // Consecutive no-op rests (a rest that mended nothing). Used to break an infinite
  // rest loop — past IDLE_REST_CAP the delve flips to `stuck`. Absent = 0.
  idleRests?: number
  battle: GameState | null // active combat, or null when exploring
  status: DelveStatus
  turn: number
  log: DelveLogEntry[]
}

const MAX_DELVE_STEPS = 4000 // defensive cap — a healthy delve ends far sooner
const IDLE_REST_CAP = 3 // consecutive no-op rests (mended nothing) before the delve is stuck

// --- Exploration decision: the engine only orchestrates ---------------------
// The navigation primitives (BFS to a goal / to the frontier, objective + entrance
// cells, party HP) live in content/exploration/navigation.ts; the Subject/Predicate/
// Move behaviour lives in their content files. This layer just runs filter-then-move.

export interface ExDecision {
  reason: string
  step: string // room to move to (party's own pos = rest), or '' = no move
  /** The party chooses to LEAVE the delve (withdraw to town). `retreat()` at the
   *  entrance, or an explicit `leave()`. Takes priority over step/rest. */
  leave?: boolean
  /** Updated, serialisable party Memory when a code navigator decided this step
   *  (opaque JSON owned by the language module). Absent on the slot path. */
  memory?: unknown
}

/** A code navigator for the party (the Inscription exploration interpreter), injected
 *  via `setExplorationProgramDecider` so delve.ts never imports the language module. */
type ExProgramDecider = (s: DelveState) => ExDecision
let exProgramDecider: ExProgramDecider | null = null
export function setExplorationProgramDecider(fn: ExProgramDecider): void {
  exProgramDecider = fn
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
  return step === '' ? null : { reason: protocol.label, step }
}

/** Scan the Procedure top-to-bottom; the first Protocol that yields a move wins. */
export function decideExploration(s: DelveState): ExDecision {
  if (s.explorationProgram !== undefined && s.explorationProgram.trim() !== '' && exProgramDecider !== null) {
    return exProgramDecider(s)
  }
  for (const protocol of s.exploration) {
    const decided = protocolStep(s, protocol)
    if (decided !== null) return decided
  }
  return { reason: 'no rule applied', step: '' }
}

// --- Start + step -----------------------------------------------------------

export function startDelve(
  party: Combatant[],
  seed: number,
  exploration: ExProcedure = DEFAULT_EXPLORATION,
  level: LevelSkeleton = LEVELS[0],
  explorationProgram?: string,
): DelveState {
  const graph = generateGraph(level, seed)
  return {
    seed,
    levelId: level.id,
    level,
    rng: graph.rngState,
    graph,
    party,
    pos: graph.entranceId, // start in the entrance room (already explored)
    explored: [graph.entranceId],
    cleared: [],
    resolved: [],
    revealed: [],
    buffs: [],
    exploration,
    explorationProgram,
    battle: null,
    status: 'delving',
    turn: 0,
    log: [],
  }
}

function logged(s: DelveState, turn: number, e: Omit<DelveLogEntry, 'turn'>): DelveLogEntry[] {
  return [...s.log, { turn, ...e }].slice(-60)
}

/** The concrete type of a room id, or undefined if it isn't in the graph. */
function roomType(s: DelveState, id: string): RoomType | undefined {
  return s.graph.rooms.find((r) => r.id === id)?.type
}

/** Roll the encounter a fight/boss room spawns from the level's content, advancing the
 *  delve rng (so the pack is fixed for the run, varied between descents). */
function rollEncounter(s: DelveState, type: RoomType): { ids: string[]; rng: number } {
  const { level } = s
  const rng = makeRng(s.rng)
  if (type === 'boss') return { ids: [level.boss], rng: rng.s }
  const n = level.monsterPool.length === 0 ? 0 : range(rng, 2, 3)
  const ids = Array.from({ length: n }, () => pick(rng, level.monsterPool))
  return { ids, rng: rng.s }
}

/** Roll which buff a buff room grants from the level's authored pool, advancing the
 *  delve rng (fixed for the run, varied between descents — like a pack roll). '' when
 *  the level authors no buff pool. */
function rollBuff(s: DelveState): { id: string; rng: number } {
  const { buffPool = [] } = s.level
  if (buffPool.length === 0) return { id: '', rng: s.rng }
  const rng = makeRng(s.rng)
  return { id: pick(rng, buffPool), rng: rng.s }
}

/** Fold every collected buff's `onSpawn` over a freshly built battle's ENEMY units (the
 *  boss is an enemy too, so this covers it). Heroes are untouched — their buffs already
 *  landed via `apply` on pickup. A buff without `onSpawn` is inert here. */
function applyEnemyBuffs(battle: GameState, buffIds: string[]): GameState {
  const hooks = buffIds.map((id) => BUFFS_BY_ID.get(id)?.onSpawn).filter((h) => h !== undefined)
  if (hooks.length === 0) return battle
  const units = battle.units.map((u) => (u.side === 'enemy' ? hooks.reduce((e, hook) => hook(e), u) : u))
  return { ...battle, units }
}

/** Mid-fight: advance the battle one action; on a finish, resolve the room — a wipe
 *  (dead), a pack cleared, or the objective slain (delve cleared). */
function advanceCombat(s: DelveState, turn: number, current: GameState): DelveState {
  const battle = step(current)
  const party = battle.units.filter((u) => u.side === 'hero').map((u) => ({ ...u }))
  if (battle.outcome === 'ongoing') {
    return { ...s, battle, turn, log: logged(s, turn, { kind: 'combat', reason: 'fighting', detail: battle.log.at(-1)?.detail ?? '' }) }
  }
  if (battle.outcome === 'defeat') {
    return { ...s, party, battle, turn, status: 'dead', log: logged(s, turn, { kind: 'end', reason: 'wiped out', detail: 'the party fell in the dungeon' }) }
  }
  // victory: this room is cleared
  const wasBoss = s.pos === s.graph.bossId
  const cleared = s.cleared.includes(s.pos) ? s.cleared : [...s.cleared, s.pos]
  return {
    ...s,
    party,
    battle: null,
    cleared,
    turn,
    status: wasBoss ? 'cleared' : 'delving',
    log: logged(s, turn, wasBoss
      ? { kind: 'end', reason: 'objective slain', detail: 'the delve is cleared!' }
      : { kind: 'clear', reason: 'room cleared', detail: 'the pack is dead' }),
  }
}

/** Exploring: decide and move one room — rest in place, get stuck, or step into a room
 *  (an uncleared fight/boss room starts a fight from the level's content). */
interface RoomEntry {
  battle: GameState | null
  rng: number
  kind: DelveLogEntry['kind']
  detail: string
}

/** What entering `room` produces: an uncleared fight/boss room starts a fight rolled
 *  from the level's content (advancing the rng); anything else is just a step in. */
function enterRoom(s: DelveState, room: string): RoomEntry {
  const type = roomType(s, room)
  if ((type === 'fight' || type === 'boss') && !s.cleared.includes(room)) {
    const rolled = rollEncounter(s, type)
    return {
      battle: applyEnemyBuffs(makeBattleFrom(s.party, rolled.ids), s.buffs),
      rng: rolled.rng,
      kind: 'enter',
      detail: type === 'boss' ? 'reached the objective — the boss awaits!' : 'entered a monster room — fight!',
    }
  }
  return { battle: null, rng: s.rng, kind: 'explore', detail: `enter the ${type ?? '?'} room` }
}

/** The corridor between two rooms (undirected), or undefined if they aren't joined. */
function corridorBetween(graph: DungeonGraph, a: string, b: string): Corridor | undefined {
  return graph.corridors.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a))
}

/** Fire every trap a traversed corridor owns (resolved by id), threading the party
 *  through each. Returns the party after the traps + their journal entries. */
function springTraps(party: Combatant[], corridor: Corridor | undefined, turn: number): { party: Combatant[]; entries: DelveLogEntry[] } {
  let current = party
  const entries: DelveLogEntry[] = []
  for (const ref of corridor?.reactions ?? []) {
    const trap = TRAPS_BY_ID.get(ref.id)
    if (trap === undefined) continue
    const fired = trap.trigger(current, ref)
    current = fired.party
    entries.push({ turn, kind: 'trap', reason: 'a corridor trap', detail: fired.detail })
  }
  return { party: current, entries }
}

function advanceMove(s0: DelveState, turn: number): DelveState {
  const decision = decideExploration(s0)
  // A code navigator returns updated Memory; fold it in so it persists across turns (and
  // into the save). The slot path leaves `memory` untouched.
  const s: DelveState = decision.memory !== undefined ? { ...s0, memory: decision.memory } : s0
  if (decision.leave === true) {
    // the party chooses to withdraw (retreat at the entrance, or an explicit leave()) —
    // end the delve and head back to town, distinct from being stuck or wiped.
    return { ...s, turn, status: 'left', log: logged(s, turn, { kind: 'end', reason: decision.reason, detail: 'the party withdrew to town' }) }
  }
  if (decision.step === '') {
    return { ...s, turn, status: 'stuck', log: logged(s, turn, { kind: 'end', reason: 'no path forward', detail: 'the party is stuck' }) }
  }

  const next = decision.step
  if (next === s.pos) {
    // a 'rest' — NOT a movement step: the party tends itself off-combat by running its
    // own Mend rules to convergence (same Attunement/Poise/Strain budget as in combat).
    // ("si c'est un repos, ce n'est pas un pas.")
    const { units: party, mends } = restToConvergence(s.party)
    // A rest that mends NOTHING changes nothing (same HP, pos, fog) — repeating it is an
    // infinite no-op (e.g. a low-HP party that can't heal, or a fully-explored party at
    // full HP that keeps retreating to the entrance). Count consecutive idle rests; past
    // the cap, END the delve as STUCK so it returns to town instead of resting forever.
    const idle = mends > 0 ? 0 : (s.idleRests ?? 0) + 1
    if (idle >= IDLE_REST_CAP) {
      return { ...s, party, turn, idleRests: idle, status: 'stuck', log: logged(s, turn, { kind: 'end', reason: decision.reason, detail: 'no progress — the party is stuck (cannot heal or reach more rooms)' }) }
    }
    const detail = mends > 0 ? `rest — ${mends} mend${mends > 1 ? 's' : ''}` : 'rest — nothing to mend'
    return { ...s, party, turn, idleRests: idle, log: logged(s, turn, { kind: 'explore', reason: decision.reason, detail }) }
  }

  const explored = s.explored.includes(next) ? s.explored : [...s.explored, next]
  // traverse the corridor: any traps it owns spring on the party on the way through
  const trapped = springTraps(s.party, corridorBetween(s.graph, s.pos, next), turn)
  const baseLog = [...s.log, ...trapped.entries].slice(-60)
  if (trapped.party.every((u) => u.hp <= 0)) {
    const wiped: DelveLogEntry = { turn, kind: 'end', reason: 'wiped out', detail: 'the party fell to a trap' }
    return { ...s, party: trapped.party, pos: next, explored, turn, status: 'dead', log: [...baseLog, wiped].slice(-60) }
  }
  const moved: DelveState = { ...s, party: trapped.party, pos: next, explored, turn, idleRests: 0 }
  const reward = grantReward(moved, baseLog, decision.reason, turn)
  if (reward !== null) return reward

  const e = enterRoom(moved, next)
  const entry: DelveLogEntry = { turn, kind: e.kind, reason: decision.reason, detail: e.detail }
  return { ...moved, battle: e.battle, rng: e.rng, log: [...baseLog, entry].slice(-60) }
}

/** Collecting a BUFF/LOOT room — a multi-field state delta (party + revealed + buffs +
 *  rng + resolved + log) that doesn't fit `enterRoom`'s RoomEntry, so it's its own
 *  branch (the twin of the `rest` branch). Returns null when `room` isn't an uncollected
 *  reward room → the caller falls through to the normal `enterRoom`. Gated on `resolved`
 *  so re-entering a reward room never re-grants. */
function grantReward(moved: DelveState, baseLog: DelveLogEntry[], reason: string, turn: number): DelveState | null {
  const type = roomType(moved, moved.pos)
  if ((type !== 'buff' && type !== 'loot') || moved.resolved.includes(moved.pos)) return null
  const resolved = [...moved.resolved, moved.pos]

  if (type === 'loot') {
    // Loot = the non-Insight haul (currency/gear) — slice-10 territory, symbolic for now:
    // mark the room looted + journal it; the reward economy lands later.
    const entry: DelveLogEntry = { turn, kind: 'clear', reason, detail: 'found loot — a glint in the rubble' }
    return { ...moved, resolved, log: [...baseLog, entry].slice(-60) }
  }

  // a buff room: roll a boon from the level's pool and COLLECT it — apply lands now,
  // onSpawn folds on every future enemy. An empty pool / stale id → a safe rest stop.
  const { id, rng } = rollBuff(moved)
  const buff = BUFFS_BY_ID.get(id)
  if (buff === undefined) {
    const entry: DelveLogEntry = { turn, kind: 'explore', reason, detail: 'a still shrine — nothing answers' }
    return { ...moved, resolved, rng, log: [...baseLog, entry].slice(-60) }
  }
  const granted = buff.apply?.({ ...moved, rng }) ?? { ...moved, rng }
  const entry: DelveLogEntry = { turn, kind: 'boon', reason, detail: `boon gained — ${buff.label}` }
  return { ...granted, resolved, buffs: [...granted.buffs, id], log: [...baseLog, entry].slice(-60) }
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
