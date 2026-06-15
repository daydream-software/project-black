// The pure dungeon-navigation PRIMITIVES an exploration content file composes — the
// delve twin of content/combat/targeting.ts. Factored out of delve.ts so the
// Subject / Predicate / Move content can use them WITHOUT importing delve.ts at
// runtime (they depend only on the DelveState *type*, erased), keeping the graph a
// DAG: delve → content → navigation → dungeon, with no cycle.

import { roomCenter, cellIndex, floorNeighbours, type Dungeon } from '../../dungeon'
import type { DelveState } from '../../delve'
import type { Combatant } from '../../sim'

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

/** First step on the shortest path from `from` to `goal` through `passable` cells
 *  (the goal itself is always allowed). -1 if unreachable. */
export function stepTowardKnown(d: Dungeon, from: number, goal: number, passable: (c: number) => boolean): number {
  if (from === goal) return from
  const prev = new Map<number, number>()
  const seen = new Set<number>([from])
  const queue = [from]
  // for-of over a growing array: the iterator re-reads length, so pushed cells are
  // visited — a standard BFS queue walk.
  for (const cur of queue) {
    for (const nb of floorNeighbours(d, cur)) {
      if (seen.has(nb) || (nb !== goal && !passable(nb))) continue
      seen.add(nb)
      prev.set(nb, cur)
      if (nb === goal) return firstStep(prev, from, goal)
      queue.push(nb)
    }
  }
  return -1
}

/** Step toward (and finally into) the nearest exploration frontier. -1 if none. */
export function stepTowardFrontier(d: Dungeon, from: number, explored: boolean[]): number {
  // already at the edge of the known? step straight into the unknown
  for (const nb of floorNeighbours(d, from)) if (!explored[nb]) return nb
  const prev = new Map<number, number>()
  const seen = new Set<number>([from])
  const queue = [from]
  for (const cur of queue) {
    for (const nb of floorNeighbours(d, cur)) {
      if (!explored[nb] || seen.has(nb)) continue // only travel through the known
      seen.add(nb)
      prev.set(nb, cur)
      if (floorNeighbours(d, nb).some((n2) => !explored[n2])) return firstStep(prev, from, nb) // nb is a frontier
      queue.push(nb)
    }
  }
  return -1
}

/** The entrance cell (where a retreat heads). */
export function entranceCell(d: Dungeon): number {
  const c = roomCenter(d.rooms[d.entranceRoomId])
  return cellIndex(d, c.x, c.y)
}

/** The nearest explored cell of the objective room, or -1 if undiscovered. */
export function knownObjectiveCell(s: DelveState): number {
  const obj = s.dungeon.rooms[s.dungeon.objectiveRoomId]
  let best = -1
  let bestDist = Infinity
  for (let { y } = obj; y < obj.y + obj.h; y += 1) {
    for (let { x } = obj; x < obj.x + obj.w; x += 1) {
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

/** Average HP% of the living party (0 if all down) — what the party-HP predicates read. */
export function partyHpPct(party: Combatant[]): number {
  const living = party.filter((u) => u.hp > 0)
  if (living.length === 0) return 0
  return (living.reduce((a, u) => a + u.hp / u.maxHp, 0) / living.length) * 100
}

/** The standard "have I seen this cell?" passability used when pathing to a goal. */
export function knownIn(s: DelveState): (c: number) => boolean {
  return (c: number) => s.explored[c]
}
