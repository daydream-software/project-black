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

// The progression tree. The language starts minimal — these unlock features + vocabulary.
// `id` matches a content `unlock` field (skills) or a `lang-*` feature gate (gate.ts).
export const UNLOCKABLES: Unlockable[] = [
  {
    id: 'lang-if',
    name: 'Branching · if',
    desc: 'Make decisions: “if … : …”. Without it, an engram can only do one fixed thing.',
    cost: 1,
  },
  {
    id: 'skill-mend',
    name: 'Skill · Mend',
    desc: 'Heal an ally with “use(Skills.Mend, target)”. Locked until learned.',
    cost: 1,
  },
  {
    id: 'lang-loops',
    name: 'Loops · for / while',
    desc: 'Repeat: iterate over senses.enemies / senses.exits, scan and search.',
    cost: 2,
  },
  {
    id: 'lang-comprehensions',
    name: 'Comprehensions',
    desc: 'Build lists/sets inline: “[x for x in senses.enemies if …]”.',
    cost: 2,
  },
  {
    id: 'lang-def',
    name: 'Helper functions · def',
    desc: 'Define your own functions to reuse logic across an engram.',
    cost: 2,
  },
  {
    id: 'lang-import',
    name: 'Libraries · import',
    desc: 'Reuse shared library engrams across golems with “import <name>”.',
    cost: 2,
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
