// The buff registry — one file per buff (a run-scoped boon a buff room grants),
// dispatched by id when the party collects it. `BUFFS` is the ordered catalogue (for a
// level to draw a pool from / future UI); `BUFFS_BY_ID` resolves a collected id back to
// its behaviour at runtime (apply on pickup, onSpawn on each future enemy). The glob
// lives only here (see ../../registry.ts) — the delve twin of the trap/reaction registry.
import type { BuffDef } from '../../../delve'
import { collect, mapById } from '../../registry'

const mods = import.meta.glob<BuffDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const BUFFS = collect(mods)
export const BUFFS_BY_ID = mapById(mods)
