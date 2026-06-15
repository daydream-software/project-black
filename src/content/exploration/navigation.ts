// The pure ROOM-GRAPH navigation primitives an exploration content file composes (the
// delve twin of content/combat/targeting.ts). Factored out of delve.ts so the Subject
// / Predicate / Move content can use them without importing delve.ts at runtime (they
// depend only on the DelveState *type*, erased), keeping a DAG: delve → content →
// navigation → mapgraph, no cycle.
//
// Movement is room-to-room over corridors. Pathing travels only through EXPLORED rooms
// (where the party has been); the final step may enter an adjacent unexplored room.

import type { DungeonGraph, RoomType } from '../../mapgraph'
import type { DelveState } from '../../delve'
import type { Combatant } from '../../sim'

/** Room ids directly connected to `room` by a corridor. */
export function neighbours(graph: DungeonGraph, room: string): string[] {
  const out: string[] = []
  for (const c of graph.corridors) {
    if (c.a === room) out.push(c.b)
    else if (c.b === room) out.push(c.a)
  }
  return out
}

/** BFS the first step from `from` toward `goal`, travelling only through rooms that
 *  pass `canPass` (the goal itself is always enterable). '' if unreachable. */
function firstStep(graph: DungeonGraph, from: string, goal: string, canPass: (r: string) => boolean): string {
  if (from === goal) return from
  const prev = new Map<string, string>()
  const seen = new Set<string>([from])
  const queue = [from]
  for (const cur of queue) {
    for (const nb of neighbours(graph, cur)) {
      if (seen.has(nb) || (nb !== goal && !canPass(nb))) continue
      seen.add(nb)
      prev.set(nb, cur)
      if (nb === goal) return stepBack(prev, from, goal)
      queue.push(nb)
    }
  }
  return ''
}

/** Walk parents back to the first move out of `from`. */
function stepBack(prev: Map<string, string>, from: string, goal: string): string {
  let cur = goal
  let parent = prev.get(cur)
  while (parent !== undefined && parent !== from) {
    cur = parent
    parent = prev.get(cur)
  }
  return parent === from ? cur : ''
}

/** True once the party has entered this room. */
export function isExplored(s: DelveState, room: string): boolean {
  return s.explored.includes(room)
}

/** Known = explored, OR adjacent to an explored room (the 1-hop TYPE peek). */
export function isKnown(s: DelveState, room: string): boolean {
  if (isExplored(s, room)) return true
  return neighbours(s.graph, room).some((nb) => isExplored(s, nb))
}

/** Next step toward a known goal room, pathing through explored rooms (entering the
 *  goal on the last step). '' if the goal isn't known/reachable. */
export function stepTowardRoom(s: DelveState, goal: string): string {
  if (!isKnown(s, goal)) return ''
  return firstStep(s.graph, s.pos, goal, (r) => isExplored(s, r))
}

/** Next step toward the nearest UNEXPLORED room (the frontier): an explored room with
 *  an unexplored neighbour, then step into it. '' if everything reachable is explored. */
export function stepTowardFrontier(s: DelveState): string {
  // adjacent unexplored? step straight in.
  for (const nb of neighbours(s.graph, s.pos)) if (!isExplored(s, nb)) return nb
  const prev = new Map<string, string>()
  const seen = new Set<string>([s.pos])
  const queue = [s.pos]
  for (const cur of queue) {
    for (const nb of neighbours(s.graph, cur)) {
      if (!isExplored(s, nb) || seen.has(nb)) continue // travel only through the known
      seen.add(nb)
      prev.set(nb, cur)
      if (neighbours(s.graph, nb).some((n2) => !isExplored(s, n2))) return stepBack(prev, s.pos, nb)
      queue.push(nb)
    }
  }
  return ''
}

/** A room of the given type that the party can route to RIGHT NOW: known (peeked or
 *  explored) via the 1-hop type peek, not yet entered (so it's a fresh objective), and
 *  reachable through explored rooms. '' if none — lets a rule say "head for a loot room
 *  if one is in sight". First reachable candidate in graph order (deterministic). */
export function knownRoomOfType(s: DelveState, type: RoomType): string {
  for (const r of s.graph.rooms) {
    if (r.type === type && !isExplored(s, r.id) && isKnown(s, r.id) && stepTowardRoom(s, r.id) !== '') return r.id
  }
  return ''
}

/** Average HP% of the living party (0 if all down) — what the party-HP predicates read. */
export function partyHpPct(party: Combatant[]): number {
  const living = party.filter((u) => u.hp > 0)
  if (living.length === 0) return 0
  return (living.reduce((a, u) => a + u.hp / u.maxHp, 0) / living.length) * 100
}
