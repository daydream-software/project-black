// Combat State predicates — the condition a Protocol tests on its subject. One file
// per predicate; the glob lives only here (see ../registry.ts).
import type { Option } from '../registry'
import type { State } from '../../sim'
import { collect } from '../registry'

const mods = import.meta.glob<Option<State['predicate']>>(['./*.ts', '!./index.ts'], {
  eager: true,
  import: 'default',
})

export const PREDICATES = collect(mods)
