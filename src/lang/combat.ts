// The COMBAT host context: wraps a Combatant + the battle's units into the language's
// namespace (`me`, `senses`, `Skills`, builtins) and runs a unit's `program` as its
// per-turn brain, producing a `Decision` the engine already understands. Reuses the
// shipped targeting primitives (content/combat/targeting.ts) so `senses` picks match
// the slot system exactly. lang → sim (types) only; sim never imports lang (DI hook).

import type { Combatant, Decision, Maneuver, SkillId } from '../sim'
import { livingAllies, livingEnemies, pickLowestHp, pickHighestHp, pickFirst } from '../content/combat/targeting'
import { SKILLS_BY_ID } from '../content/skills'
import {
  compile, Interp, baseBuiltins, Builtin, isHost, libraries,
  type LangValue, type HostObject,
} from './interp'

/** A value the combat builtins return; the decider maps it to a Decision. `host:true`
 *  so it's a valid LangValue, but the player never reads its attributes. */
class CombatAction implements HostObject {
  host = true as const
  constructor(public maneuver: Maneuver, public targetId: string | null) {}
  get(name: string): LangValue { throw new Error(`action has no attribute '${name}'`) }
}

/** Wrap one Combatant as a host object: the readable, perceivable facts + a private
 *  `__id__` the action builtins use to resolve the target. */
function unitHost(u: Combatant): HostObject {
  return {
    host: true,
    get(name: string): LangValue {
      switch (name) {
        case 'hp': return u.hp
        case 'max_hp': return u.maxHp
        case 'hp_pct': return (u.hp / u.maxHp) * 100
        case 'name': return u.name
        case 'is_boss': return u.isBoss ?? false
        case 'defending': return u.defending
        case 'might': return u.might
        case 'ward': return u.ward
        case 'fortitude': return u.fortitude
        case 'attunement': return u.attunement
        case 'poise': return u.poise
        case 'celerity': return u.celerity
        case '__id__': return u.id
        default: throw new Error(`unit has no attribute '${name}'`)
      }
    },
    repr: () => u.name,
  }
}

/** A picker-collection host: `.lowest_hp` / `.highest_hp` / `.first`, plus `len()` and
 *  iteration. Mirrors a Subject's candidate set. */
function collectionHost(list: Combatant[]): HostObject {
  return {
    host: true,
    get(name: string): LangValue {
      switch (name) {
        case 'lowest_hp': { const u = pickLowestHp(list); return u === null ? null : unitHost(u) }
        case 'highest_hp': { const u = pickHighestHp(list); return u === null ? null : unitHost(u) }
        case 'first': { const u = pickFirst(list); return u === null ? null : unitHost(u) }
        case '__len__': return list.length
        case '__iter__': return list.map(unitHost)
        default: throw new Error(`collection has no attribute '${name}'`)
      }
    },
  }
}

/** The `Skills` enum: PascalCase member (`Skills.Mend`) → the SkillId string (`'mend'`),
 *  built from the content registry so a new skill file just appears. */
function skillsEnum(): HostObject {
  const byMember = new Map<string, SkillId>()
  for (const id of SKILLS_BY_ID.keys()) {
    const member = id.charAt(0).toUpperCase() + id.slice(1)
    byMember.set(member, id as SkillId)
  }
  return {
    host: true,
    get(name: string): LangValue {
      const id = byMember.get(name)
      if (id === undefined) throw new Error(`unknown skill 'Skills.${name}'`)
      return id
    },
  }
}

function unitId(v: LangValue): string | null {
  if (v === null) return null
  if (isHost(v)) return v.get('__id__') as string
  throw new Error('expected a unit target')
}

/** The combat namespace for one decision: host objects + action builtins + the
 *  `len`/`set`/`print` base. `senses` is passed as the entry arg, not injected here. */
function combatGlobals(self: Combatant, interp: Interp): Record<string, LangValue> {
  return {
    ...baseBuiltins(interp),
    me: unitHost(self),
    Skills: skillsEnum(),
    attack: new Builtin((a) => new CombatAction({ command: 'attack' }, unitId(a[0])), 'attack'),
    use: new Builtin((a) => new CombatAction({ command: 'useSkill', skill: a[0] as SkillId }, unitId(a[1])), 'use'),
    flee: new Builtin(() => new CombatAction({ command: 'flee' }, null), 'flee'),
    wait: new Builtin(() => null, 'wait'),
  }
}

function sensesHost(self: Combatant, units: Combatant[]): HostObject {
  return {
    host: true,
    get(name: string): LangValue {
      switch (name) {
        case 'allies': return collectionHost(livingAllies(self, units))
        case 'enemies': return collectionHost(livingEnemies(self, units))
        case 'alone': return livingAllies(self, units).filter((u) => u.id !== self.id).length === 0
        default: throw new Error(`senses has no attribute '${name}'`)
      }
    },
  }
}

/** The engine's no-rule fallback, identical to `decide()`'s: hit the nearest enemy. */
function fallback(self: Combatant, units: Combatant[], reason: string): Decision {
  const enemy = units.find((u) => u.hp > 0 && u.side !== self.side)
  return { protocolIndex: -1, maneuver: { command: 'attack' }, targetId: enemy?.id ?? null, reason }
}

/**
 * Run `self.program` as a combat brain → a Decision. The DI entry point registered on
 * `sim.setProgramDecider`. Any compile/runtime error or fuel overrun degrades to the
 * engine fallback (never aborts the battle) — the slot system's safety net, preserved.
 */
export function decideCombatFromProgram(self: Combatant, units: Combatant[]): Decision {
  const src = self.program
  if (src === undefined) return fallback(self, units, 'no program — attack')
  try {
    const program = compile(src)
    const interp = new Interp()
    const result = interp.run(program, 'combat_turn', [sensesHost(self, units)], combatGlobals(self, interp), libraries())
    if (result instanceof CombatAction) {
      return { protocolIndex: -1, maneuver: result.maneuver, targetId: result.targetId, reason: 'inscription' }
    }
    return fallback(self, units, 'inscription: no action — attack')
  } catch (e) {
    return fallback(self, units, `inscription error: ${(e as Error).message}`)
  }
}
