// Procedural dungeon generation — PURE and seeded (the first consumer of rng.ts).
//
// A dungeon is a grid of cells (wall / floor) with rectangular rooms joined by
// L-shaped corridors. Generation is deterministic: the same seed always yields
// the same dungeon. The grid is the spatial substrate the first-person "scrying"
// view (slice 8b) will render; the delve state machine (slice 8a-2) walks it.
//
// Invariant we guarantee (and test): the dungeon is CONNECTED — every floor cell,
// and in particular the objective room, is reachable from the entrance. That is
// what lets the explorer in 8a-2 always make progress (no unreachable target).

import { makeRng, int, range, type Rng } from './rng'

export type RoomType = 'entrance' | 'monster' | 'empty' | 'target'

export interface Room {
  id: number
  x: number
  y: number
  w: number
  h: number
  type: RoomType
}

export interface Dungeon {
  width: number
  height: number
  /** Row-major; true = floor (walkable), false = wall. Length width*height. */
  cells: boolean[]
  rooms: Room[]
  entranceRoomId: number
  objectiveRoomId: number
}

/**
 * The knobs a level config feeds into generation. The **grid is part of the
 * config** so a bigger level is actually bigger — not just more rooms crammed into
 * the same box (slice 10a). `rooms` is the total room count *including* the
 * entrance and target; `packs` is how many of the interior rooms hold a monster
 * pack (clamped to the interior rooms actually placed). Both ranges are inclusive.
 */
export interface GenConfig {
  width: number
  height: number
  rooms: [number, number]
  packs: [number, number]
}

/** Default for the lone caller until levels are wired (10a-3) — ~the pre-10a feel. */
export const DEFAULT_GEN: GenConfig = { width: 21, height: 15, rooms: [5, 6], packs: [1, 2] }

const PLACE_ATTEMPTS = 200

export function cellIndex(d: { width: number }, x: number, y: number): number {
  return y * d.width + x
}

export function roomCenter(r: Room): { x: number; y: number } {
  return { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }
}

/** The room a cell belongs to, or -1 for corridors / walls. */
export function roomAt(d: Dungeon, cell: number): number {
  const x = cell % d.width
  const y = (cell / d.width) | 0
  for (const r of d.rooms) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.id
  }
  return -1
}

/** Facing / step direction: 0=N, 1=E, 2=S, 3=W (indexes DX/DY). */
export type Dir = 0 | 1 | 2 | 3

// 4-neighbours in a FIXED order (N, E, S, W) so any nearest/tie-break that walks
// them is deterministic.
export const DX = [0, 1, 0, -1]
export const DY = [-1, 0, 1, 0]

/** Floor-cell neighbours of `cell`, in fixed N,E,S,W order. */
export function floorNeighbours(d: Dungeon, cell: number): number[] {
  const x = cell % d.width
  const y = (cell / d.width) | 0
  const out: number[] = []
  for (let k = 0; k < 4; k += 1) {
    const nx = x + DX[k]
    const ny = y + DY[k]
    if (nx < 0 || ny < 0 || nx >= d.width || ny >= d.height) continue
    const ni = ny * d.width + nx
    if (d.cells[ni]) out.push(ni)
  }
  return out
}

/** Direction from `from` to an adjacent cell `to`. */
export function dirBetween(width: number, from: number, to: number): Dir {
  const d = to - from
  if (d === -width) return 0
  if (d === 1) return 1
  if (d === width) return 2
  return 3
}

/** BFS floor distances from `start` (cell index). Unreachable = Infinity. */
export function bfsDistances(d: Dungeon, start: number): number[] {
  const dist = new Array<number>(d.cells.length).fill(Infinity)
  if (!d.cells[start]) return dist
  dist[start] = 0
  const queue = [start]
  for (const cell of queue) {
    const x = cell % d.width
    const y = (cell / d.width) | 0
    for (let k = 0; k < 4; k += 1) {
      const nx = x + DX[k]
      const ny = y + DY[k]
      if (nx < 0 || ny < 0 || nx >= d.width || ny >= d.height) continue
      const ni = ny * d.width + nx
      if (d.cells[ni] && dist[ni] === Infinity) {
        dist[ni] = dist[cell] + 1
        queue.push(ni)
      }
    }
  }
  return dist
}

function rectsOverlap(a: Room, b: { x: number; y: number; w: number; h: number }, margin: number): boolean {
  return (
    a.x - margin < b.x + b.w &&
    a.x + a.w + margin > b.x &&
    a.y - margin < b.y + b.h &&
    a.y + a.h + margin > b.y
  )
}

/* eslint-disable no-param-reassign -- carve* fill the caller-owned grid buffer in
   place (the cells array is local to generateDungeon); the generator idiom. */
function carveRoom(cells: boolean[], width: number, r: { x: number; y: number; w: number; h: number }): void {
  for (let {y} = r; y < r.y + r.h; y += 1) for (let {x} = r; x < r.x + r.w; x += 1) cells[y * width + x] = true
}

function carveH(cells: boolean[], width: number, x1: number, x2: number, y: number): void {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) cells[y * width + x] = true
}

function carveV(cells: boolean[], width: number, y1: number, y2: number, x: number): void {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) cells[y * width + x] = true
}
/* eslint-enable no-param-reassign */

/**
 * Generate a connected dungeon from `seed`. Returns the dungeon plus the advanced
 * rng state, so the delve can keep rolling deterministically from where
 * generation left off (rather than re-seeding).
 */
/** Place up to `targetRooms` non-overlapping rooms (placement may fall short in a
 *  tight grid — the connectivity test pins that a valid config still gives ≥ 2). */
function placeRooms(rng: Rng, gen: GenConfig): Room[] {
  const { width, height } = gen
  const rooms: Room[] = []
  const targetRooms = range(rng, gen.rooms[0], gen.rooms[1])
  for (let a = 0; a < PLACE_ATTEMPTS && rooms.length < targetRooms; a += 1) {
    const w = range(rng, 3, 5)
    const h = range(rng, 3, 5)
    const x = range(rng, 1, width - w - 2)
    const y = range(rng, 1, height - h - 2)
    const cand = { x, y, w, h }
    if (rooms.some((r) => rectsOverlap(r, cand, 1))) continue
    rooms.push({ id: rooms.length, x, y, w, h, type: 'empty' })
  }
  return rooms
}

/** Connect each room to the previous one with an L-corridor → a spanning chain →
 *  the whole dungeon is connected. */
function carveCorridors(rng: Rng, cells: boolean[], width: number, rooms: Room[]): void {
  for (let i = 1; i < rooms.length; i += 1) {
    const a = roomCenter(rooms[i - 1])
    const b = roomCenter(rooms[i])
    if (int(rng, 2) === 0) {
      carveH(cells, width, a.x, b.x, a.y)
      carveV(cells, width, a.y, b.y, b.x)
    } else {
      carveV(cells, width, a.y, b.y, a.x)
      carveH(cells, width, a.x, b.x, b.y)
    }
  }
}

/** The room whose centre is farthest (by corridor distance) from the entrance, so
 *  the delve has somewhere to go. */
function farthestRoomId(dungeon: Dungeon, rooms: Room[]): number {
  const entranceCenter = roomCenter(rooms[0])
  const dist = bfsDistances(dungeon, cellIndex(dungeon, entranceCenter.x, entranceCenter.y))
  let best = -1
  let id = dungeon.objectiveRoomId
  for (const r of rooms) {
    const c = roomCenter(r)
    const d = dist[cellIndex(dungeon, c.x, c.y)]
    if (d !== Infinity && d > best) {
      best = d
      id = r.id
    }
  }
  return id
}

/** Type the rooms: entrance (room 0), target (farthest), then exactly `packCount` of
 *  the remaining interior rooms become monster packs — a chosen count, not a per-room
 *  coin flip, so a level's `packs` range actually controls how many fights there are. */
function assignRoomTypes(rng: Rng, rooms: Room[], dungeon: Dungeon, gen: GenConfig): void {
  for (const r of rooms) {
    r.type = r.id === dungeon.entranceRoomId ? 'entrance' : r.id === dungeon.objectiveRoomId ? 'target' : 'empty'
  }
  const interior = rooms.filter((r) => r.type === 'empty')
  const packCount = Math.min(range(rng, gen.packs[0], gen.packs[1]), interior.length)
  for (let i = interior.length - 1; i > 0; i -= 1) {
    // Fisher–Yates: a seeded, deterministic pick of which interior rooms fight.
    const j = int(rng, i + 1)
    ;[interior[i], interior[j]] = [interior[j], interior[i]]
  }
  for (let i = 0; i < packCount; i += 1) interior[i].type = 'monster'
}

export function generateDungeon(seed: number, gen: GenConfig = DEFAULT_GEN): { dungeon: Dungeon; rngState: number } {
  const rng = makeRng(seed)
  const { width, height } = gen
  const cells = new Array<boolean>(width * height).fill(false)
  const rooms = placeRooms(rng, gen)

  for (const r of rooms) carveRoom(cells, width, r)
  carveCorridors(rng, cells, width, rooms)

  const dungeon: Dungeon = {
    width,
    height,
    cells,
    rooms,
    entranceRoomId: 0,
    objectiveRoomId: 0,
  }
  dungeon.objectiveRoomId = farthestRoomId(dungeon, rooms)
  assignRoomTypes(rng, rooms, dungeon, gen)

  return { dungeon, rngState: rng.s }
}
