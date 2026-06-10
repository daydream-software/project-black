// The Trainer's catalogue + the pure buy logic (slice 10b). An Unlockable maps an
// `id` (the same id an editor Option carries in its `unlock` field) to player-facing
// name / description / Insight cost. Buying spends Insight and adds the id to the
// profile's `unlocked` set; the editor then offers that vocabulary. One placeholder
// item for now — the real catalogue (which items, costs, order) is deferred content.

export interface Unlockable {
  id: string
  name: string
  desc: string
  cost: number
}

export const UNLOCKABLES: Unlockable[] = [
  {
    id: 'enemy-most-hp',
    name: 'Focus: biggest threat',
    desc: 'Learn to target the enemy with the most HP — a new combat Subject, “Enemy · most HP”.',
    cost: 1,
  },
]

export function unlockableById(id: string): Unlockable | undefined {
  return UNLOCKABLES.find((u) => u.id === id)
}

export function isOwned(unlocked: readonly string[], id: string): boolean {
  return unlocked.includes(id)
}

export function canAfford(insight: number, id: string): boolean {
  const u = unlockableById(id)
  return u !== undefined && insight >= u.cost
}

export interface BuyResult {
  insight: number
  unlocked: string[]
  bought: boolean
}

/** Buy an unlockable: if it's already owned, unknown, or unaffordable, nothing
 *  changes. Otherwise spend its cost and add it to `unlocked`. Pure & testable. */
export function buy(id: string, insight: number, unlocked: readonly string[]): BuyResult {
  const u = unlockableById(id)
  if (u === undefined || isOwned(unlocked, id) || insight < u.cost) {
    return { insight, unlocked: [...unlocked], bought: false }
  }
  return { insight: insight - u.cost, unlocked: [...unlocked, id], bought: true }
}
