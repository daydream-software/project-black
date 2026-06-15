// PURE, seeded generation of a dungeon ROOM GRAPH from an authored level skeleton
// (see docs/DUNGEON-SYSTEM.md). Slice 1 of the dungeon rework: the graph + hybrid
// generation, headless + tested. It REPLACES the spatial cell grid (dungeon.ts) with a
// graph of typed rooms joined by corridors — but is additive for now (the delve still
// runs on the old grid until the migration slice), so the branch stays green.
//
// Hybrid = authored identity + roguelite variation: a level authors a TOPOLOGY (a
// forced shape — a slot-graph of nodes + corridors), with mandatory/optional slots and
// per-slot type specs, plus a monster pool. The seeded fill picks which optional rooms
// appear and resolves each slot's concrete type — fixed for the run, varied between
// descents. Connectivity is guaranteed by construction (see generateGraph).

import { makeRng, int, pick, type Rng } from './rng'

export type RoomType = 'entrance' | 'fight' | 'loot' | 'buff' | 'boss'

/** A slot's type in an authored topology: a fixed type, a seeded `oneOf` choice, or
 *  `mystery` (the ??? room) which resolves to one of fight/loot/buff at generation. */
export type SlotType = RoomType | { oneOf: RoomType[] } | 'mystery'

export interface Slot {
  id: string
  type: SlotType
  /** Optional slots may be absent on a given descent (seeded coin flip); default =
   *  mandatory. AUTHORING RULE: the mandatory slots + the corridors BETWEEN mandatory
   *  slots must form a connected backbone — an optional slot may attach to it but never
   *  be the sole bridge between mandatory rooms, so dropping it can't disconnect the
   *  level (the entrance always reaches the boss). */
  optional?: boolean
}

export interface Topology {
  slots: Slot[]
  /** Corridors as undirected [slotId, slotId] pairs. */
  edges: Array<[string, string]>
}

export interface LevelSkeleton {
  id: string
  name: string
  topology: Topology
  /** Monster ids a `fight` room's pack is drawn from (the delve rolls the pack on
   *  entry). Authored per level. */
  monsterPool: string[]
  /** Monster id the `boss` room spawns. Per-level (no more hardcoded Warden-everywhere). */
  boss: string
}

/** A concrete room in a generated graph (a present slot with its resolved type). */
export interface RoomNode {
  id: string
  type: RoomType
}

export interface Corridor {
  a: string
  b: string
}

export interface DungeonGraph {
  rooms: RoomNode[]
  corridors: Corridor[]
  entranceId: string
  bossId: string
  /** rng state after generation (resume the stream for later seeded steps). */
  rngState: number
}

const MYSTERY: readonly RoomType[] = ['fight', 'loot', 'buff']

/** Resolve a slot's type spec to a concrete RoomType (seeded for choice/mystery). */
function resolveType(spec: SlotType, rng: Rng): RoomType {
  if (spec === 'mystery') return pick(rng, MYSTERY)
  if (typeof spec === 'object') return pick(rng, spec.oneOf)
  return spec
}

/** The present slots: mandatory always, optional by a seeded coin flip. */
function presentSlots(slots: Slot[], rng: Rng): Set<string> {
  const present = new Set<string>()
  for (const slot of slots) {
    if (slot.optional !== true || int(rng, 2) === 1) present.add(slot.id)
  }
  return present
}

/** Undirected adjacency among the present slots (edges with both endpoints present). */
function buildAdjacency(edges: Array<[string, string]>, present: Set<string>): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  const addDir = (a: string, b: string): void => {
    const list = adj.get(a) ?? []
    list.push(b)
    adj.set(a, list)
  }
  for (const [a, b] of edges) {
    if (present.has(a) && present.has(b)) {
      addDir(a, b)
      addDir(b, a)
    }
  }
  return adj
}

/** Every node reachable from `start` through the adjacency (BFS). */
function reachableFrom(start: string, adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>([start])
  const queue = [start]
  // for-of over a growing array re-reads length → a standard BFS walk.
  for (const cur of queue) {
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb)
        queue.push(nb)
      }
    }
  }
  return seen
}

/** The single present room of a given type (entrance / boss). Throws on 0 or >1 — an
 *  authoring error (a level must have exactly one entrance and one boss, both mandatory). */
function soleRoomOfType(typeOf: Map<string, RoomType>, type: RoomType): string {
  const ids = [...typeOf].filter(([, t]) => t === type).map(([id]) => id)
  if (ids.length !== 1) throw new Error(`level must have exactly one ${type} room, found ${ids.length}`)
  return ids[0]
}

/**
 * Seeded fill of a level skeleton into a concrete, connected room graph.
 *
 * Mandatory slots are always present; optional ones flip a coin. Each present slot's
 * type is resolved (mystery → fight/loot/buff, oneOf → one). The graph is then trimmed
 * to the rooms REACHABLE from the entrance — so the result is connected by construction
 * (a present-but-orphaned optional, linked only through an absent slot, is dropped).
 * The authoring rule (mandatory backbone is self-connected) guarantees every mandatory
 * room — including the boss — survives; we assert it. Deterministic in `seed`.
 */
export function generateGraph(level: LevelSkeleton, seed: number): DungeonGraph {
  const rng = makeRng(seed)
  const { slots, edges } = level.topology

  const present = presentSlots(slots, rng)
  const typeOf = new Map<string, RoomType>()
  for (const slot of slots) {
    if (present.has(slot.id)) typeOf.set(slot.id, resolveType(slot.type, rng))
  }

  const entranceId = soleRoomOfType(typeOf, 'entrance')
  const bossId = soleRoomOfType(typeOf, 'boss')

  const adj = buildAdjacency(edges, present)
  const reachable = reachableFrom(entranceId, adj)
  if (!reachable.has(bossId)) throw new Error('level topology disconnects the boss from the entrance')

  const rooms: RoomNode[] = [...typeOf]
    .filter(([id]) => reachable.has(id))
    .map(([id, type]) => ({ id, type }))
  const corridors: Corridor[] = edges
    .filter(([a, b]) => reachable.has(a) && reachable.has(b))
    .map(([a, b]) => ({ a, b }))

  return { rooms, corridors, entranceId, bossId, rngState: rng.s }
}
