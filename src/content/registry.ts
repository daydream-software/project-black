// The content registry: every piece of *extensible* game content (rule-editor
// vocabulary, skills, monsters) lives as one file per item under src/content/, and
// each category's `index.ts` assembles them with `import.meta.glob` — so adding
// content means dropping a file in a folder, never editing a central import wall.
//
// Two invariants this helper enforces (see docs/ARCHITECTURE.md):
//  - **id is the save contract.** Persisted rows reference items by `id`; a file's
//    NAME is cosmetic, its `id` must never change. Duplicate ids are a bug → throw.
//  - **order is explicit.** `import.meta.glob` keys sort by filename, NOT by intent,
//    so every item carries an `order` and `collect` sorts on it — dropdown order can
//    never silently depend on how files happen to be named.

/** A rule-editor dropdown choice: a stable `id` (persisted), a `label` (shown +
 *  journaled), an `order` (sort key for the dropdown), and a `make()` that builds the
 *  model value the sim consumes. `unlock` (slice 10b) gates the option behind a
 *  Trainer purchase — absent = always available; present = offered once its id is in
 *  the profile's `unlocked`. Shared by the combat and exploration editors. */
export interface Option<T> {
  id: string
  label: string
  order: number
  make: () => T
  unlock?: string
}

/** Assemble a category's glob record into an ordered list: de-dupe ids (a clash is a
 *  programmer error, not stale player data → throw), then sort by explicit `order`.
 *  Pure, so a category index is just `collect(import.meta.glob(...))`. */
export function collect<T extends { id: string; order: number }>(mods: Record<string, T>): T[] {
  const items = Object.values(mods)
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`Duplicate content id: ${item.id}`)
    seen.add(item.id)
  }
  return [...items].sort((a, b) => a.order - b.order)
}

/** Assemble a glob record into a by-id map (for content looked up by id rather than
 *  listed in order — e.g. the monster bestiary). De-dupes ids like `collect`. */
export function indexById<T extends { id: string }>(mods: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const item of Object.values(mods)) {
    if (item.id in out) throw new Error(`Duplicate content id: ${item.id}`)
    out[item.id] = item
  }
  return out
}
