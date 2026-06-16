// The EXPLORATION host context: the party-wide `exploration_turn(senses)` brain over a
// POV view of the room graph (docs/INSCRIPTION-LANG.md §4). Perception is local — the
// current room + its corridors (1-hop peek of neighbour TYPE, hidden rooms excluded) —
// and rooms are identified by an OPAQUE per-delve `sigil` (gibberish glyphs). Tier-1
// engine nav (`unexplored_exit` / `retreat`) reuses navigation.ts; tier-2 is the
// player's own DFS over a persistent `Memory`. lang → delve/navigation (types/pure fns).

import type { DelveState, ExDecision } from '../delve'
import type { RoomType } from '../mapgraph'
import { ProgramError } from '../sim'
import { checkGates, unlocked } from './gate'
import {
  neighbours, isHidden, isKnown, isExplored, stepTowardFrontier, stepTowardRoom, partyHpPct,
} from '../content/exploration/navigation'
import {
  compile, Interp, baseBuiltins, Builtin, isHost, valueToJson, jsonToValue, libraries,
  type LangValue, type HostObject, type Json,
} from './interp'

/** A move the exploration builtins return; the decider maps it to a room id (`step`)
 *  or, when `leave` is set, to withdrawing from the delve. */
class ExploreAction implements HostObject {
  host = true as const
  constructor(public step: string, public leave = false) {}
  get(name: string): LangValue { throw new Error(`move has no attribute '${name}'`) }
}

// --- Opaque per-delve sigils (gibberish glyphs; equality/hash only) -----------
const GLYPHS = [...'⟁ᚦᛟᚷᚱᚨᛚᚲᚹᛜᛶᛞᛒᛗᛘᛤᚠᚾ']
function hash32(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h >>> 0
}
/** A stable, opaque glyph string for a room WITHIN this delve (seeded by `seed`+id), so
 *  two delves give unrelated sigils and a printed sigil is unusable as a literal. */
function sigil(s: DelveState, room: string): string {
  let h = hash32(`${s.seed}:${room}`)
  let out = ''
  for (let i = 0; i < 5; i += 1) {
    out += GLYPHS[h % GLYPHS.length]
    h = Math.floor(h / GLYPHS.length)
    if (i === 1) out += '·'
  }
  return out
}

function roomTypeOf(s: DelveState, id: string): RoomType | null {
  return s.graph.rooms.find((r) => r.id === id)?.type ?? null
}

/** An exit (corridor) host: the neighbour's sigil + 1-hop peeked type + explored flag,
 *  with a private `__room__` the `move` builtin steps into. */
function exitHost(s: DelveState, room: string): HostObject {
  return {
    host: true,
    get(name: string): LangValue {
      switch (name) {
        case 'beyond': return sigil(s, room)
        case 'leads_to': return isKnown(s, room) ? roomTypeOf(s, room) : null
        case 'explored': return isExplored(s, room)
        case '__room__': return room
        default: throw new Error(`exit has no attribute '${name}'`)
      }
    },
    repr: () => sigil(s, room),
  }
}

/** Corridors out of the current room the party can perceive: hidden rooms stay invisible
 *  until a vision buff reveals them. Stable order (corridor/graph order) for determinism. */
function visibleExits(s: DelveState): string[] {
  return neighbours(s.graph, s.pos).filter((nb) => !isHidden(s, nb) || s.revealed.includes(nb))
}

function roomHost(s: DelveState): HostObject {
  return {
    host: true,
    get(name: string): LangValue {
      switch (name) {
        case 'sigil': return sigil(s, s.pos)
        case 'type': return roomTypeOf(s, s.pos)
        case 'cleared': return s.cleared.includes(s.pos)
        case 'resolved': return s.resolved.includes(s.pos)
        case 'is_objective': return s.pos === s.graph.bossId
        default: throw new Error(`room has no attribute '${name}'`)
      }
    },
  }
}

function sensesHost(s: DelveState): HostObject {
  return {
    host: true,
    get(name: string): LangValue {
      switch (name) {
        case 'exits': return visibleExits(s).map((nb) => exitHost(s, nb))
        case 'room': return roomHost(s)
        case 'unexplored_exit': {
          const step = stepTowardFrontier(s) // engine nav: next hop toward the frontier
          return step === '' ? null : exitHost(s, step)
        }
        default: throw new Error(`senses has no attribute '${name}'`)
      }
    },
  }
}

/** `RoomType` enum: `RoomType.Fight` → 'fight' (the same string `room.type` returns). */
function roomTypeEnum(): HostObject {
  const members: Record<string, RoomType> = { Entrance: 'entrance', Fight: 'fight', Loot: 'loot', Buff: 'buff', Boss: 'boss' }
  return {
    host: true,
    get(name: string): LangValue {
      const v = members[name]
      if (v === undefined) throw new Error(`unknown RoomType.${name}`)
      return v
    },
  }
}

function exitRoom(v: LangValue): string {
  if (isHost(v)) return v.get('__room__') as string
  throw new Error('move() expects an exit')
}

function exploreGlobals(s: DelveState, interp: Interp, memory: LangValue): Record<string, LangValue> {
  return {
    ...baseBuiltins(interp),
    Memory: memory,
    RoomType: roomTypeEnum(),
    party: { host: true, get: (n: string): LangValue => { if (n === 'hp_pct') return partyHpPct(s.party); throw new Error(`party has no attribute '${n}'`) } } as HostObject,
    move: new Builtin((a) => new ExploreAction(exitRoom(a[0])), 'move'),
    // `explore()` — the no-branch navigator: step toward the nearest unexplored room, or
    // WITHDRAW when everything reachable is explored. Lets the minimal language (no `if`)
    // still run a whole delve: `Engram.exploration_turn:\n    return explore()`.
    explore: new Builtin(() => {
      const step = stepTowardFrontier(s)
      return step === '' ? new ExploreAction(s.pos, true) : new ExploreAction(step)
    }, 'explore'),
    rest: new Builtin(() => new ExploreAction(s.pos), 'rest'),
    retreat: new Builtin(() => {
      // step toward the entrance; if already there (nowhere left to fall back), WITHDRAW
      // from the delve rather than collapse to a pointless rest.
      const step = stepTowardRoom(s, s.graph.entranceId)
      return step === '' || step === s.pos ? new ExploreAction(s.pos, true) : new ExploreAction(step)
    }, 'retreat'),
    leave: new Builtin(() => new ExploreAction(s.pos, true), 'leave'),
    wait: new Builtin(() => null, 'wait'),
  }
}

function actionOf(result: LangValue): { step: string; leave: boolean } {
  return result instanceof ExploreAction ? { step: result.step, leave: result.leave } : { step: '', leave: false }
}

/** The party's Memory map, decoded from the (serialisable) delve state. */
function decodeMemory(s: DelveState): Map<LangValue, LangValue> {
  const v = jsonToValue((s.memory ?? { __dict: [] }) as Json)
  return v instanceof Map ? v : new Map()
}

/**
 * Run the party's `explorationProgram` as the delve navigator → an ExDecision carrying
 * the next room (`step`) AND the updated, re-serialised `memory`. Registered on
 * `delve.setExplorationProgramDecider` (DI). A compile/runtime error or fuel overrun
 * degrades to engine frontier nav, so a broken program still crawls the delve.
 */
export function decideExplorationFromProgram(s: DelveState): ExDecision {
  const src = s.explorationProgram
  const memory = decodeMemory(s)
  const persist = (): Json => valueToJson(memory)
  if (src === undefined || src.trim() === '') {
    return { reason: 'no program', step: stepTowardFrontier(s), memory: persist() }
  }
  try {
    const program = compile(src)
    const gate = checkGates(program.module, unlocked()) // runtime enforcement (e.g. via import)
    if (!gate.ok) throw new ProgramError(`exploration: ${gate.message ?? 'locked construct'}`)
    const interp = new Interp()
    // `senses` ambient (for `Engram.exploration_turn:`) AND passed as the legacy arg.
    const senses = sensesHost(s)
    const result = interp.run(program, 'exploration_turn', [senses], { ...exploreGlobals(s, interp, memory), senses }, libraries())
    const a = actionOf(result)
    return { reason: 'inscription', step: a.step, leave: a.leave, memory: persist() }
  } catch (e) {
    if (e instanceof ProgramError) throw e
    throw new ProgramError(`exploration: ${(e as Error).message}`)
  }
}
