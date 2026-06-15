import type { SfxDef } from '../../sfx'
import url from '../../audio/golem-attack.ogg?url'

// A hero golem's own blow. One file per sound: it points to its OWN asset, so adding
// a sound is dropping a file here (+ its .ogg) — never editing a central enum/map.
export default { id: 'attack', url } satisfies SfxDef
