// The monster bestiary — one file per monster, looked up by id (not listed in
// order), so the factories in sim.ts and future per-level spawn tables can pull a
// stat block by name. The glob lives only here (see ../registry.ts).
import type { MonsterDef } from '../../sim'
import { mapById } from '../registry'

const mods = import.meta.glob<MonsterDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

// A Map (not a record): a lookup by a level's monster-pool id may miss, and `.get()`
// returns `MonsterDef | undefined` so the factories must handle it (a bad pool id
// throws loudly rather than silently producing a broken monster).
export const MONSTERS = mapById(mods)
