// The reaction registry — one file per reaction definition, each listening for a
// battle-event `kind`. A unit OWNS reactions as serialisable refs ({id, params}); the
// engine resolves the behaviour here by id at emit time (the reaction twin of
// SKILLS_BY_ID). The glob lives only here (see ../../registry.ts).
import type { ReactionDef } from '../../../sim'
import { mapById } from '../../registry'

const mods = import.meta.glob<ReactionDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const REACTIONS_BY_ID = mapById(mods)
