// Passive damage modifiers, folded into every Attack's resolution in priority
// `order`. One file per modifier; the glob lives only here (see ../../registry.ts).
import type { DamageModifier } from '../../../sim'
import { collect } from '../../registry'

const mods = import.meta.glob<DamageModifier>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const DAMAGE_MODIFIERS = collect(mods)
