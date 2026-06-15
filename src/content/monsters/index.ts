// The monster bestiary — one file per monster, looked up by id (not listed in
// order), so the factories in sim.ts and future per-level spawn tables can pull a
// stat block by name. The glob lives only here (see ../registry.ts).
import type { MonsterDef } from '../../sim'
import { indexById } from '../registry'

const mods = import.meta.glob<MonsterDef>(['./*.ts', '!./index.ts'], {
  eager: true,
  import: 'default',
})

export const MONSTERS = indexById(mods)
