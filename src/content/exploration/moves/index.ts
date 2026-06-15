// Exploration moves — the DO of a delve Protocol (a move carries no skill). One file
// per move; the glob lives only here (see ../../registry.ts).
import type { Option } from '../../registry'
import type { ExMove } from '../../../delve'
import { collect } from '../../registry'

const mods = import.meta.glob<Option<ExMove>>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const EX_MOVES = collect(mods)
