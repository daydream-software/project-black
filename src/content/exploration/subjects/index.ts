// Exploration subjects — the dungeon "who/what" the party-wide delve Procedure acts
// on. One file per subject; the glob lives only here (see ../../registry.ts).
import type { Option } from '../../registry'
import type { ExSubject } from '../../../delve'
import { collect } from '../../registry'

const mods = import.meta.glob<Option<ExSubject>>(['./*.ts', '!./index.ts'], {
  eager: true,
  import: 'default',
})

export const EX_SUBJECTS = collect(mods)
