// Exploration predicates — the condition the party-wide delve Procedure tests. One
// file per predicate; the glob lives only here (see ../../registry.ts).
import type { Option } from '../../registry'
import type { ExPredicate } from '../../../delve'
import { collect } from '../../registry'

const mods = import.meta.glob<Option<ExPredicate>>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const EX_PREDICATES = collect(mods)
