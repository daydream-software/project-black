// Combat State subjects — the "who" a Protocol acts on. One file per subject; this
// index is the ONLY place the glob lives (see ../registry.ts). The `!./index.ts`
// negative pattern keeps the index from importing its own (default-less) self.
import type { SubjectDef } from '../../sim'
import { collect } from '../registry'

const mods = import.meta.glob<SubjectDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const SUBJECTS = collect(mods)
