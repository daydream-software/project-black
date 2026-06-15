// Reactions to a unit being healed, fired (in priority `order`) after a heal lands.
// One file per reaction; the glob lives only here (see ../../registry.ts).
import type { HealReaction } from '../../../sim'
import { collect } from '../../registry'

const mods = import.meta.glob<HealReaction>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const HEAL_REACTIONS = collect(mods)
