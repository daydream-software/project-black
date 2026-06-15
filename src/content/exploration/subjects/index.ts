// Exploration subjects — the dungeon "who/what" the party-wide delve Procedure acts
// on. One file per subject; the glob lives only here (see ../../registry.ts).
import type { ExSubjectDef } from '../../../delve'
import { collect } from '../../registry'

const mods = import.meta.glob<ExSubjectDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const EX_SUBJECTS = collect(mods)
