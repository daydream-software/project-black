// Exploration predicates — the condition the party-wide delve Procedure tests. One
// file per predicate; the glob lives only here (see ../../registry.ts).
import type { ExPredicateDef } from '../../../delve'
import { collect, mapById } from '../../registry'

const mods = import.meta.glob<ExPredicateDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const EX_PREDICATES = collect(mods) // ordered, for the editor dropdown
export const EX_PREDICATES_BY_ID = mapById(mods) // by id, for the delve's runtime dispatch
