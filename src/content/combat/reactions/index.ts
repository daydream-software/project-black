// Reactions to battle events (action / damage / heal), each listening for one event
// `kind` and fired by the engine in priority `order`. One file per reaction; the glob
// lives only here (see ../../registry.ts).
import type { Reaction } from '../../../sim'
import { collect } from '../../registry'

const mods = import.meta.glob<Reaction>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const REACTIONS = collect(mods)
