// Exploration moves — the DO of a delve Protocol (a move carries no skill). One file
// per move; the glob lives only here (see ../../registry.ts).
import type { ExMoveDef } from '../../../delve'
import { collect, mapById } from '../../registry'

const mods = import.meta.glob<ExMoveDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const EX_MOVES = collect(mods) // ordered, for the editor dropdown
export const EX_MOVES_BY_ID = mapById(mods) // by id, for the delve's runtime dispatch
