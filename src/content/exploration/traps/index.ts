// The trap registry — one file per trap, dispatched by id when the party traverses a
// corridor that owns it (the delve twin of the combat reaction registry). The glob
// lives only here (see ../../registry.ts).
import type { TrapDef } from '../../../delve'
import { mapById } from '../../registry'

const mods = import.meta.glob<TrapDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const TRAPS_BY_ID = mapById(mods)
