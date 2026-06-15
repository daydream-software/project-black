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

/** A HIDDEN (secret) room: present in the graph but undiscoverable by normal crawling. */
export function isHidden(s: DelveState, room: string): boolean {
  return s.graph.rooms.find((r) => r.id === room)?.hidden === true
}

/** Known = explored, OR revealed by a vision buff, OR adjacent to an explored room (the
 *  1-hop TYPE peek) — BUT a hidden room is never peeked: only being explored or revealed
 *  makes it known (so a secret room stays secret until a buff uncovers it). */
export function isKnown(s: DelveState, room: string): boolean {
  if (isExplored(s, room) || s.revealed.includes(room)) return true
  if (isHidden(s, room)) return false
  return neighbours(s.graph, room).some((nb) => isExplored(s, nb))
}

/** Next step toward a known goal room, pathing through explored rooms (entering the
 *  goal on the last step). '' if the goal isn't known/reachable. */
export function stepTowardRoom(s: DelveState, goal: string): string {
  if (!isKnown(s, goal)) return ''
  return firstStep(s.graph, s.pos, goal, (r) => isExplored(s, r))
}

/** Step toward a KNOWN goal, EXPLORING toward it (feed-routing). Unlike stepTowardRoom
 *  — which only walks already-explored rooms, so it stalls at the frontier — this heads
 *  along the shortest graph path to the goal, opening one unexplored room per step. So a
 *  revealed-but-distant room (a vision buff, a future hidden boss) becomes a destination
 *  the party works toward, NEVER teleporting through unseen space: each step enters the
 *  next room and fights/discovers it. It won't path THROUGH a hidden room (a secret room
 *  is a wall until revealed-and-entered); the goal itself is always enterable on the last
 *  step. "revealed ≠ explored": knowledge gives a direction, not a free through-path. */
export function stepTowardKnown(s: DelveState, goal: string): string {
  if (!isKnown(s, goal)) return ''
  return firstStep(s.graph, s.pos, goal, (r) => isExplored(s, r) || !isHidden(s, r))
}

/** Next step toward the nearest UNEXPLORED room (the frontier): an explored room with
 *  an unexplored neighbour, then step into it. '' if everything reachable is explored. */
export function stepTowardFrontier(s: DelveState): string {
  // a room the party may discover by crawling: unexplored AND not a hidden secret room
  // (the frontier explorer must never blunder into a hidden room — only a reveal opens it).
  const isOpenFrontier = (room: string): boolean => !isExplored(s, room) && !isHidden(s, room)
  // adjacent open frontier? step straight in.
  for (const nb of neighbours(s.graph, s.pos)) if (isOpenFrontier(nb)) return nb
  const prev = new Map<string, string>()
  const seen = new Set<string>([s.pos])
  const queue = [s.pos]
  for (const cur of queue) {
    for (const nb of neighbours(s.graph, cur)) {
      if (!isExplored(s, nb) || seen.has(nb)) continue // travel only through the known
      seen.add(nb)
      prev.set(nb, cur)
      if (neighbours(s.graph, nb).some(isOpenFrontier)) return stepBack(prev, s.pos, nb)
      queue.push(nb)
    }
  }
  return ''
}

/** A room of the given type the party can route to: KNOWN (peeked OR revealed by a vision
 *  buff), not yet entered (a fresh objective). The party feed-routes toward it — heading
 *  there even across unexplored ground (opening rooms en route), so a revealed loot room
 *  on the far side of the map is a valid "head for loot" target, not just an adjacent one.
 *  '' if none. First candidate in graph order (deterministic). */
export function knownRoomOfType(s: DelveState, type: RoomType): string {
  for (const r of s.graph.rooms) {
    if (r.type === type && !isExplored(s, r.id) && isKnown(s, r.id) && stepTowardKnown(s, r.id) !== '') return r.id
  }
  return ''
}

/** Average HP% of the living party (0 if all down) — what the party-HP predicates read. */
export function partyHpPct(party: Combatant[]): number {
  const living = party.filter((u) => u.hp > 0)
  if (living.length === 0) return 0
  return (living.reduce((a, u) => a + u.hp / u.maxHp, 0) / living.length) * 100
}
