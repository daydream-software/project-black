// Combat State predicates — the condition a Protocol tests on its subject. One file
// per predicate; the glob lives only here (see ../registry.ts).
import type { PredicateDef } from '../../sim'
import { collect, mapById } from '../registry'

const mods = import.meta.glob<PredicateDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const PREDICATES = collect(mods) // ordered, for the editor dropdown
export const PREDICATES_BY_ID = mapById(mods) // by id, for the sim's runtime dispatch
