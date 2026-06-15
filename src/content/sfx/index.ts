// The sound registry — one file per sound, each pointing to its own .ogg asset. The
// audio engine (sfx.ts) plays by id from this map; nothing here hardcodes the set of
// sounds. The glob lives only here (see ../registry.ts).
import type { SfxDef } from '../../sfx'
import { mapById } from '../registry'

const mods = import.meta.glob<SfxDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const SFX = mapById(mods)
