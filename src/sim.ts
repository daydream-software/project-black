// Deterministic combat simulation.
//
// This module is PURE: no DOM, no canvas, no timers, no randomness. Given the
// same inputs it always produces the same outputs. That is what makes it testable
// in a way that genuinely fails when the logic breaks, and what keeps a delve
// reproducible so the journal is trustworthy. (There is no offline catch-up — a
// delve resumes in real time; see docs/ARCHITECTURE.md.)
//
// The rule language (see docs/VOCABULARY.md):
//   Protocol  = WHEN <State> → DO <Maneuver>
//   State     = Subject + Predicate     (the Subject IS the target — no picker)
//   Maneuver  = Command + Object         (Attack / Use Skill · X / Use Item · Y / Flee)
//   Procedure = ordered Protocols; first State that holds wins (priority = order)
//
// Grammar symmetry: the State's Subject is WHO is acted on; the Maneuver's
// Object is WHAT is wielded (the chosen skill/item). Attack and Flee take no
// Object, just as a bare predicate needs no qualifier.

// Monster stat blocks are content (one file per monster); the bestiary map is
// assembled by glob. Only a runtime VALUE import — the monster files depend on this
// module for TYPES only (erased), so there is no import cycle.
import { MONSTERS } from './content/monsters'
// Skill effects are content too (content/skills/), dispatched by id; same erased-type
// dependency, no cycle. Combat primitives sim uses internally come from combat-core.
import { SKILLS_BY_ID } from './content/skills'
import { SUBJECTS_BY_ID } from './content/subjects'
import { PREDICATES_BY_ID } from './content/predicates'
import { DAMAGE_MODIFIERS } from './content/combat/modifiers'
import { REACTIONS_BY_ID } from './content/combat/reactions'
import { attackDamage, poolFor, golemPoolFor, golemCelerity, recovery } from './combat-core'

export type Side = 'hero' | 'enemy'

/**
 * The six stats (see docs/COMBAT-SYSTEM.md — the canonical reference). Each owns
 * a distinct lever; a build is a point in this space. Compact 0–12 scale: a point
 * is defined by its *cadence effect*, so the displayed number IS the impact.
 *
 *   Might      physical damage dealt by Attack
 *   Ward       FLAT reduction on ALL incoming damage (anti-swarm: trivialises
 *              chip, barely dents a big hit) — distinct from Fortitude's buffer
 *   Fortitude  health pool — maxHp = fortitude × HP_PER_FORTITUDE
 *   Attunement potency of skills (the strength of Mend / other arcane Maneuvers)
 *   Poise      Strain tolerance — how much channeling before overdraw bites
 *              Fortitude. STORED but not yet wired (Strain is a later slice).
 *   Celerity   action frequency / turn order. STORED but not yet wired — turn
 *              order is still fixed round-robin; CTB is a later slice.
 */
/** Thrown when a golem's authored program genuinely fails (compile / runtime / fuel /
 *  a locked construct) — distinct from "no program" or "no action this turn". Lives here,
 *  the shared dep both the language layer and delve.ts import, so neither cycles. The delve
 *  loop catches it and ends the delve LOUD (status `stuck`) instead of papering it over. */
export class ProgramError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProgramError'
  }
}

export interface Stats {
  might: number
  ward: number
  fortitude: number
  attunement: number
  poise: number
  celerity: number
}

export interface Combatant extends Stats {
  /** Stable identity used for targeting and the decision log. */
  id: string
  name: string
  side: Side
  hp: number
  maxHp: number
  /** Set when the unit Defends; halves incoming damage until its next turn. */
  defending: boolean
  /**
   * CTB scheduler clock (battle-scoped): time until this unit's next turn — the
   * unit with the LEAST charge acts next, so higher Celerity (smaller `recovery`)
   * means more frequent turns. Reset each battle by `makeBattle` (unlike `strain`,
   * which is delve-scoped and persists). Optional/absent defaults to `recovery`.
   */
  charge?: number
  /** This unit's own ordered rule list. */
  procedure: Procedure
  /**
   * Accumulated arcane Strain (see docs/COMBAT-SYSTEM.md). Each skill cast adds to
   * it; while `strain ≤ poise` casting is free, beyond Poise the overflow frays the
   * caster's Fortitude (overdraw). It is a **delve-scoped budget** — it persists
   * across fights and rests and only cools at the tower (a fresh delve starts at 0).
   * Optional/absent = 0 (defensive: a save written before Strain reads as 0).
   */
  strain?: number
  /**
   * The reactive half of this unit's authored intelligence: serialisable references
   * to the reactions it owns (the Hex Warden's counter-heal is one). Like the
   * Procedure, these come from the unit's definition — we author monsters', the
   * player will author golems' later. Absent = purely proactive (e.g. a slime). The
   * behaviour is resolved from the reaction registry by id at emit time.
   */
  reactions?: ReactionRef[]
  /** Render hint: draw larger / mark as a boss. */
  isBoss?: boolean
  /**
   * The player-authored CODE brain (Inscription program source) — set when this golem
   * is run by a program instead of slot `procedure`. **Serialisable: a string, never a
   * closure** (the DelveState round-trips through JSON); compiled + cached at runtime.
   * Absent ⇒ the `procedure` (slot) path runs. Wired via `setProgramDecider` (DI), so
   * sim.ts never imports the language module (no cycle). See docs/INSCRIPTION-LANG.md.
   */
  program?: string
}

// The pure combat primitives (poolFor / attackDamage / healAmount / overdraw /
// recovery + their constants) live in combat-core.ts so skill effect files can use
// them without a sim ↔ skills import cycle. Re-exported here so `from './sim'`
// imports across the app are unchanged.
export {
  HP_PER_FORTITUDE,
  poolFor,
  BASE_GOLEM_HP,
  golemPoolFor,
  BASE_GOLEM_CELERITY,
  golemCelerity,
  MIN_DAMAGE,
  attackDamage,
  healAmount,
  MEND_STRAIN,
  overdraw,
  SCHED_BASE,
  recovery,
} from './combat-core'

/** This unit's current scheduler charge, defaulting to a fresh `recovery` if a
 *  save predates the CTB field (defensive — never NaN). */
function chargeOf(u: Combatant): number {
  return u.charge ?? recovery(u.celerity)
}

/** The living unit scheduled to act next: least charge, ties broken by lowest
 *  index (deterministic). Returns -1 if nothing is alive. */
function nextActor(units: Combatant[]): number {
  let best = -1
  for (let i = 0; i < units.length; i += 1) {
    if (units[i].hp <= 0) continue
    if (best === -1 || chargeOf(units[i]) < chargeOf(units[best])) best = i
  }
  return best
}

/**
 * The next `n` unit ids in CTB order, WITHOUT mutating or applying any actions —
 * a pure projection (clone charges, run pick/advance/reset n times) that assumes
 * current HP. Shares `nextActor` with `step` so the carousel can never disagree
 * with the real schedule. Drives the turn-order carousel.
 */
export function upcomingTurns(units: Combatant[], n: number): string[] {
  let sim = units.map((u) => ({ ...u, charge: chargeOf(u) }))
  const order: string[] = []
  for (let k = 0; k < n; k += 1) {
    const idx = nextActor(sim)
    if (idx < 0) break
    const m = chargeOf(sim[idx])
    sim = sim.map((u) => (u.hp > 0 ? { ...u, charge: chargeOf(u) - m } : u))
    order.push(sim[idx].id)
    sim[idx] = { ...sim[idx], charge: recovery(sim[idx].celerity) }
  }
  return order
}

// --- State = Subject + Predicate -------------------------------------------
//
// The interpretation of each vocabulary piece is NOT in this engine — it lives in
// the content file for that item (content/subjects, content/predicates), which
// carries its own behaviour. The engine only orchestrates (filter-then-pick). So a
// new predicate or pick strategy is a new content file, never an edit here.

/** A combat State subject: which living units it considers (`candidates`, the who)
 *  and how it narrows to one (`pick`). Both come from the content file under
 *  content/subjects/ — the engine never enumerates subject/pick variants.
 *  id/label/order/unlock are the editor face (a CatalogItem). */
export interface SubjectDef {
  id: string
  label: string
  order: number
  unlock?: string
  candidates: (self: Combatant, units: Combatant[]) => Combatant[]
  pick: (list: Combatant[]) => Combatant | null
}

/** A combat State predicate: does it hold for a unit? The test (and any threshold it
 *  closes over) lives in the content file under content/predicates/. */
export interface PredicateDef {
  id: string
  label: string
  order: number
  unlock?: string
  holds: (unit: Combatant) => boolean
}

/** A compiled combat rule's State references its Subject/Predicate by **id** (the
 *  same ids the editor persists), NOT by holding the behaviour-bearing defs. The
 *  engine resolves the def from the content registry at runtime (like a skill id).
 *  This keeps a Procedure — and thus a saved in-progress delve — fully serialisable:
 *  functions never end up in the JSON. A stale id resolves to nothing → the rule is
 *  inert (it doesn't crash a resumed delve). */
export interface State {
  subject: string
  predicate: string
}

/** A passive damage modifier folded into every Attack's resolution (content/combat/
 *  modifiers/). Lets a status like Defending alter incoming damage WITHOUT the engine
 *  knowing what "defending" means — it just folds whatever is registered. */
export interface DamageModifier {
  id: string
  order: number
  apply: (damage: number, attacker: Combatant, target: Combatant) => number
}

/**
 * Something that happened in a battle that content can react to. A discriminated
 * union so the set of reactable moments grows by adding a variant — `action` (any
 * maneuver resolved — e.g. a counterspell), `damage` (a hit landed — e.g. thorns),
 * `heal` (HP restored — e.g. the slice-4 counter-heal wall). `units` is the live
 * (cloned) roster the reaction may read/mutate. (Exploration moments — onMove / trap —
 * are a separate DelveEvent union emitted by the delve layer, same pattern.)
 */
export type CombatEvent =
  | { kind: 'action'; actor: Combatant; maneuver: Maneuver; units: Combatant[] }
  | { kind: 'damage'; target: Combatant; source: Combatant; amount: number; units: Combatant[] }
  | { kind: 'heal'; healed: Combatant; source: Combatant; units: Combatant[] }

/** A reference a unit OWNS to one of its reactions: the reaction's `id` plus any
 *  parameters (e.g. counter-heal's `value`). SERIALISABLE data — this is what lives on
 *  a Combatant and survives a save, the reaction twin of a Maneuver's skill id. The
 *  behaviour is resolved from the reaction registry by id at emit time. */
export interface ReactionRef {
  id: string
  /** A single numeric parameter (e.g. counter-heal strength); extend as reactions need. */
  value?: number
}

/** A reaction's design-time definition (content/combat/reactions/): which event `kind`
 *  it listens for, and `react` — run AS its owner when the engine emits that event,
 *  reading the owner's `ref` for parameters, mutating the cloned units in place and
 *  returning log entries. Dispatched by id (the counter-heal wall is just one), so
 *  adding a reaction is dropping a file — no engine edit. */
export interface ReactionDef {
  id: string
  kind: CombatEvent['kind']
  react: (event: CombatEvent, owner: Combatant, ref: ReactionRef, meta: { turn: number; round: number }) => LogEntry[]
}

// --- Maneuver = Command + which --------------------------------------------

/** Skills are the "Use Skill" Objects (Attack and Flee are their own commands). */
export type SkillId = 'mend' | 'defend'

/** A skill's design-time definition: its editor face (id/label/order, optional
 *  `unlock`), its log/CSS `kind`, and its `effect` — the actual combat behaviour.
 *  One file per skill under content/skills/; the effect MUTATES the (already-cloned)
 *  actor/target in place and returns the journal detail line. `act` dispatches over
 *  these by id, so adding a skill is dropping a file — no central switch to edit. */
export interface SkillDef {
  id: SkillId
  label: string
  order: number
  kind: 'heal' | 'defend'
  unlock?: string
  /** The sound this skill plays, as an OPAQUE key (a plain string, so the pure sim
   *  never imports the audio module). The view validates it against its SfxId set and
   *  assembles the kind→sound map from the content — adding a skill's sound is a field
   *  here, not an edit to a central switch. */
  sfx?: string
  effect: (actor: Combatant, target: Combatant | null) => string
}

/**
 * A Maneuver mirrors a State: a Command plus (for some commands) an Object.
 * `attack` / `flee` take no Object; `useSkill` / `useItem` name which one
 * (`skill` / `item` ARE the Object). `useItem` is modelled but not yet wired —
 * composition stays open for later.
 */
export type Maneuver =
  | { command: 'attack' }
  | { command: 'flee' }
  | { command: 'useSkill'; skill: SkillId }
  | { command: 'useItem'; item: string }

export interface Protocol {
  state: State
  maneuver: Maneuver
  /** Human-readable text shown in the editor and the decision log. */
  label: string
}

/** A unit's ordered list of protocols (priority = order). */
export type Procedure = Protocol[]

export interface Decision {
  /** Index of the protocol that fired, or -1 for the default fallback. */
  protocolIndex: number
  maneuver: Maneuver
  /** The resolved target (the State's subject), or null if nothing applies. */
  targetId: string | null
  reason: string
  /** Lines the brain emitted via `record(...)` this turn — folded into the log as
   *  `note` entries (debug console). Optional: only code brains produce them. */
  notes?: string[]
}

// --- Target resolution: the engine's only job here is orchestration ---------

/**
 * Resolve a State to a concrete target unit, or null if the State does not hold.
 *
 * Order is FILTER-then-PICK: keep only the candidates the predicate passes, *then*
 * pick among those. That makes "Ally lowest-HP · HP<50%" mean "the most-hurt ally
 * that is also below 50%", not "the most-hurt ally, only if it happens to be below
 * 50%". An empty result means the State is false. The *behaviour* of each piece
 * (which candidates, how to pick, what the predicate tests) is supplied by the
 * Subject/Predicate content files — this function only wires them together.
 */
export function resolveTarget(state: State, self: Combatant, units: Combatant[]): Combatant | null {
  // Resolve the behaviour from the content registries by id (like a skill id). A stale
  // id (vocabulary churned since the row was saved) → undefined → the State is inert.
  const subject = SUBJECTS_BY_ID.get(state.subject)
  const predicate = PREDICATES_BY_ID.get(state.predicate)
  if (subject === undefined || predicate === undefined) return null
  return subject.pick(subject.candidates(self, units).filter((u) => predicate.holds(u)))
}

/** A decider for code-programmed golems (the Inscription interpreter), injected via
 *  `setProgramDecider` so sim.ts never imports the language module — no cycle, and the
 *  pure sim stays decoupled from the editor stack. */
type ProgramDecider = (self: Combatant, units: Combatant[]) => Decision
let programDecider: ProgramDecider | null = null
export function setProgramDecider(fn: ProgramDecider): void {
  programDecider = fn
}

/**
 * THE core function: run a unit's procedure. Scan its protocols top-to-bottom;
 * the first whose State resolves to a target wins, and that target is what the
 * Maneuver acts on. Falls back to attacking the nearest enemy. A golem carrying a
 * `program` (code brain) is delegated to the registered program decider instead.
 */
export function decide(self: Combatant, units: Combatant[]): Decision {
  if (self.program !== undefined && programDecider !== null) return programDecider(self, units)
  for (let i = 0; i < self.procedure.length; i += 1) {
    const protocol = self.procedure[i]
    const target = resolveTarget(protocol.state, self, units)
    if (target !== null) {
      return { protocolIndex: i, maneuver: protocol.maneuver, targetId: target.id, reason: protocol.label }
    }
  }
  const enemy = units.find((u) => u.hp > 0 && u.side !== self.side)
  return {
    protocolIndex: -1,
    maneuver: { command: 'attack' },
    targetId: enemy?.id ?? null,
    reason: 'no protocol matched — attack',
  }
}

/** The log/CSS family a maneuver belongs to (drives colour in the UI). A skill's
 *  kind comes from its definition; an unknown/stale skill id (e.g. a pre-rename
 *  'cure' row) falls back to 'attack' — it's already inert in `applyManeuver`. */
export function maneuverKind(m: Maneuver): 'attack' | 'heal' | 'defend' | 'flee' {
  if (m.command === 'attack') return 'attack'
  if (m.command === 'flee') return 'flee'
  if (m.command === 'useItem') return 'heal'
  // A persisted row can carry a stale skill id (e.g. pre-rename 'cure') the registry
  // no longer has — `.get` returns undefined for it, and it's already inert below.
  return SKILLS_BY_ID.get(m.skill)?.kind ?? 'attack'
}

// ---------------------------------------------------------------------------
// Game state + advancement
// ---------------------------------------------------------------------------

export type Outcome = 'ongoing' | 'victory' | 'defeat'

/** Log/CSS family. `counter` is the enemy's reactive punish, not a maneuver. */
export type LogKind = 'attack' | 'heal' | 'defend' | 'flee' | 'counter' | 'note'

export interface LogEntry {
  turn: number
  round: number
  actorId: string
  actorName: string
  kind: LogKind
  targetName: string | null
  protocolIndex: number
  reason: string
  detail: string
}

export interface GameState {
  /** All combatants, heroes first then enemies, in fixed action order. */
  units: Combatant[]
  turn: number // total unit-actions taken
  round: number
  /** Index in `units` of the unit that acted last (-1 before the first action). */
  cursor: number
  log: LogEntry[]
  outcome: Outcome
  /** The `record(...)` lines the actor emitted on THIS step (overwritten each step,
   *  last-step-only). The delve folds them into its journal. Transient. */
  stepNotes?: string[]
}


/** A unit's defining fields (everything except the derived hp/maxHp/defending). */
type UnitSpec = Stats & {
  id: string
  name: string
  side: Side
  procedure: Procedure
  reactions?: ReactionRef[]
  isBoss?: boolean
  program?: string
}

/** A monster's design-time definition: its full authored intelligence — a stat block,
 *  a `procedure` (the same WHEN→DO rules a golem runs, authored by US), and any
 *  `reactions` it owns (the Hex Warden's counter-heal). No `side`/derived hp (the
 *  factory applies those). One file per monster under content/monsters/, assembled
 *  into `MONSTERS`. `id` is the bestiary key (monsters aren't persisted — not a save
 *  contract); the factory templates the runtime id/name for packs. */
export interface MonsterDef extends Stats {
  id: string
  name: string
  procedure: Procedure
  reactions?: ReactionRef[]
  isBoss?: boolean
}

/** Build a Combatant from a stat block: maxHp derives from Fortitude, hp starts
 *  full. Keeps every builder honest about the stat → pool relationship. */
function makeUnit(base: UnitSpec): Combatant {
  const maxHp = poolFor(base.fortitude)
  return { ...base, hp: maxHp, maxHp, defending: false, strain: 0 }
}

// Monster definitions (stats + procedure + reactions) live in content/monsters/; these
// factories just stamp the runtime side and, for packs, an index-templated id/name.
/** The bestiary entry for an id, throwing on a miss (a level pool / builder calling
 *  with a bad id is an authoring error, not stale player data). */
function requireMonster(defId: string): MonsterDef {
  const def = MONSTERS.get(defId)
  if (def === undefined) throw new Error(`unknown monster: ${defId}`)
  return def
}

export function makeEnemy(index: number): Combatant {
  const def = requireMonster('slime')
  return makeUnit({ ...def, id: `enemy-${index}`, name: `${def.name} #${index}`, side: 'enemy' })
}

/** Build one monster Combatant from a bestiary id with an explicit runtime id + name. */
export function makeMonster(defId: string, id: string, name: string): Combatant {
  return makeUnit({ ...requireMonster(defId), id, name, side: 'enemy' })
}

/** Build an encounter against the given party from an explicit list of monster ids —
 *  the content-driven spawn (a room's rolled pack / the level's boss), replacing the
 *  hardcoded `pack`/`warden`. Packs get index-templated names; a lone foe keeps its
 *  bestiary name. Battle-scoped resets (defending/charge) like makeBattle. */
export function makeBattleFrom(heroes: Combatant[], monsterIds: string[]): GameState {
  const multi = monsterIds.length > 1
  const enemies = monsterIds.map((mid, i) => {
    const { name } = requireMonster(mid)
    return makeMonster(mid, `enemy-${i + 1}`, multi ? `${name} #${i + 1}` : name)
  })
  const units = [...heroes.map((h) => ({ ...h })), ...enemies].map((u) => ({
    ...u,
    defending: false,
    charge: recovery(u.celerity),
  }))
  return { units, turn: 0, round: 0, cursor: -1, log: [], outcome: 'ongoing' }
}

export function makeWarden(): Combatant {
  // Runtime id 'enemy-1' (monsters aren't persisted; the bestiary id is 'hex-warden').
  return makeUnit({ ...requireMonster('hex-warden'), id: 'enemy-1', side: 'enemy' })
}

/** Build a hero golem from an AUTHORED stat block + its Procedure — the generic,
 *  player-facing builder the point-buy editor feeds. (makeWarrior/makeHealer below
 *  are the fixed reference blocks used as test fixtures and the starting party.) */
export function makeGolem(spec: { id: string; name: string; stats: Stats; procedure: Procedure; program?: string }): Combatant {
  const u = makeUnit({ id: spec.id, name: spec.name, side: 'hero', ...spec.stats, procedure: spec.procedure, program: spec.program })
  // Golems get flat floors on top of their authored stats (monsters don't — they keep
  // the raw formulas): +BASE_GOLEM_HP on the Fortitude pool, and +BASE_GOLEM_CELERITY
  // on cadence (eff Celerity = 3 + authored, monotonic — every point still counts).
  const maxHp = golemPoolFor(spec.stats.fortitude)
  return { ...u, hp: maxHp, maxHp, celerity: golemCelerity(spec.stats.celerity) }
}

/** The two reference stat blocks (compact 0–12 scale): a Sentinel (Bulwark — Ward +
 *  Fortitude, tanks and hits) and a Mender (Channeler — Attunement + Poise, fragile,
 *  mends). The starting party authors these; the point-buy editor can re-spec them. */
export const SENTINEL_STATS: Stats = { might: 5, ward: 2, fortitude: 10, attunement: 0, poise: 0, celerity: 5 }
export const MENDER_STATS: Stats = { might: 3, ward: 0, fortitude: 5, attunement: 5, poise: 6, celerity: 6 }

export function makeWarrior(procedure: Procedure): Combatant {
  return makeGolem({ id: 'hero-1', name: 'Sentinel', stats: SENTINEL_STATS, procedure })
}

export function makeHealer(procedure: Procedure): Combatant {
  return makeGolem({ id: 'hero-2', name: 'Mender', stats: MENDER_STATS, procedure })
}

export type EncounterId = 'duo' | 'pack' | 'warden'

export interface Encounter {
  id: EncounterId
  name: string
  hint: string
}

export const ENCOUNTERS: Encounter[] = [
  { id: 'duo', name: 'Two Slimes', hint: 'A gentle opener.' },
  { id: 'pack', name: 'Slime Pack', hint: 'A naive Procedure clears it.' },
  { id: 'warden', name: 'Hex Warden', hint: 'Punishes healing — the first wall.' },
]

function encounterEnemies(id: EncounterId): Combatant[] {
  switch (id) {
    case 'warden':
      return [makeWarden()]
    case 'duo':
      return [makeEnemy(1), makeEnemy(2)]
    case 'pack':
      return [makeEnemy(1), makeEnemy(2), makeEnemy(3)]
  }
}

/**
 * Build an encounter from EXISTING hero Combatants (HP, deaths, Procedures and
 * Strain carry in — Strain is delve-scoped). What's reset to a clean slate is
 * battle-scoped: a fresh `defending` flag, a fresh CTB `charge`, and a fresh
 * log/cursor.
 */
export function makeBattle(heroes: Combatant[], encounter: EncounterId): GameState {
  const units = [...heroes.map((h) => ({ ...h })), ...encounterEnemies(encounter)].map((u) => ({
    ...u,
    defending: false,
    charge: recovery(u.celerity), // battle-scoped: every fight starts the cadence fresh
  }))
  return { units, turn: 0, round: 0, cursor: -1, log: [], outcome: 'ongoing' }
}

/** Convenience: a one-off encounter against a freshly-built default party. */
export function initialState(warriorProc: Procedure, healerProc: Procedure, encounter: EncounterId = 'pack'): GameState {
  return makeBattle([makeWarrior(warriorProc), makeHealer(healerProc)], encounter)
}


/** Apply a resolved maneuver to the cloned units; return the log detail string. */
/* eslint-disable no-param-reassign -- actor/target/units below are step()'s local
   CLONES (the agreed data-oriented sim core): mutating their fields is intentional,
   never touches the caller's objects, and step() reads them back into a fresh
   immutable GameState. The whole resolution cluster shares this contract. */

/** Resolve a Mend onto its target: heal by Attunement, then bite the caster's own
 *  Fortitude for any Strain past Poise (Mend is a Fortitude → heal converter — same
 *  path in combat and at rest, "c'est Mend pareil"). */
/** Resolve an Attack onto its target: base damage = Might − Ward (floored), then the
 *  registered passive damage modifiers fold in (e.g. Defending halves it). Attack is a
 *  Command (not a skill), so it lives here, not in the skill registry; the modifiers
 *  are content, so the engine never branches on a status like "defending". */
function applyAttack(actor: Combatant, target: Combatant | null): string {
  if (target !== null && target.side !== actor.side && target.hp > 0) {
    const before = target.hp
    const base = attackDamage(actor, target)
    const dmg = DAMAGE_MODIFIERS.reduce((d, mod) => mod.apply(d, actor, target), base)
    target.hp = Math.max(0, target.hp - dmg)
    let detail = `ATTACK −${dmg} → ${target.name} (HP ${before} → ${target.hp})`
    if (target.hp <= 0) detail += ` • ${target.name} defeated!`
    return detail
  }
  return `${actor.name}'s maneuver has no valid target — no effect`
}

function applyManeuver(actor: Combatant, target: Combatant | null, maneuver: Maneuver): string {
  if (maneuver.command === 'flee') return `FLEE — ${actor.name} tries to disengage (no effect yet)`
  if (maneuver.command === 'attack') return applyAttack(actor, target)
  if (maneuver.command === 'useSkill') {
    // Dispatch over the skill registry (content/skills/). An unknown/stale id (e.g.
    // a pre-rename 'cure' row) has no entry → `.get` is undefined → inert, the turn
    // is consumed (matches the documented pre-rename behaviour).
    return SKILLS_BY_ID.get(maneuver.skill)?.effect(actor, target) ?? `${actor.name}'s maneuver has no valid target — no effect`
  }
  // a useItem we haven't wired — treated as attack-less
  return `${actor.name}'s maneuver has no valid target — no effect`
}

/** CTB heartbeat: subtract the winner's charge from every living unit (so the winner
 *  reaches 0 = now), then the winner pays a fresh `recovery` to queue its next turn. */
function advanceCharges(units: Combatant[], actorIdx: number): void {
  const spent = chargeOf(units[actorIdx])
  for (const u of units) if (u.hp > 0) u.charge = chargeOf(u) - spent
  const actor = units[actorIdx]
  actor.defending = false // its protection window closes as it gets to act again
  actor.charge = recovery(actor.celerity)
}

/* eslint-enable no-param-reassign */

/** Fire the matching reactions OWNED by each living unit and collect their log entries
 *  (they mutate the cloned units in place). Each unit reacts with its own authored
 *  intelligence — the engine never references a specific reaction, it just asks every
 *  unit "do you react to this?". A unit's reactions fire in their listed order. */
function emit(event: CombatEvent, meta: { turn: number; round: number }): LogEntry[] {
  const entries: LogEntry[] = []
  for (const owner of event.units) {
    if (owner.hp <= 0) continue
    for (const ref of owner.reactions ?? []) {
      // Resolve the reaction's behaviour from the registry by id (the ref is just data);
      // a stale id → undefined → skipped, so a resumed delve never crashes.
      const def = REACTIONS_BY_ID.get(ref.id)
      if (def?.kind === event.kind) entries.push(...def.react(event, owner, ref, meta))
    }
  }
  return entries
}

/** The events one resolved maneuver produces — `action` always, plus `damage`/`heal`
 *  when the target's HP changed — each emitted to its reactions. Kept out of `step`
 *  so the emit fan-out doesn't inflate the step's branching. */
function reactionsForAction(
  actor: Combatant,
  maneuver: Maneuver,
  target: Combatant | null,
  hpBefore: number,
  kind: LogKind,
  units: Combatant[],
  meta: { turn: number; round: number },
): LogEntry[] {
  const entries = emit({ kind: 'action', actor, maneuver, units }, meta)
  if (target !== null && target.hp < hpBefore) {
    entries.push(...emit({ kind: 'damage', target, source: actor, amount: hpBefore - target.hp, units }, meta))
  }
  if (kind === 'heal' && target !== null && target.hp > hpBefore) {
    entries.push(...emit({ kind: 'heal', healed: target, source: actor, units }, meta))
  }
  return entries
}

/** Find the targeted unit in the (cloned) roster by id, or null. */
function findTargetById(units: Combatant[], targetId: string | null): Combatant | null {
  if (targetId === null) return null
  return units.find((u) => u.id === targetId) ?? null
}

/** Judge the battle from who is still standing. */
function outcomeOf(units: Combatant[]): Outcome {
  const heroesAlive = units.some((u) => u.side === 'hero' && u.hp > 0)
  const enemiesAlive = units.some((u) => u.side === 'enemy' && u.hp > 0)
  return heroesAlive ? (enemiesAlive ? 'ongoing' : 'victory') : 'defeat'
}

/**
 * Advance the simulation by ONE unit-action (pure: returns a new state). The
 * next living unit in turn order acts per its Procedure; deaths are skipped, and
 * wrapping past the first living unit ticks the cosmetic round counter. Stepping a
 * finished battle is a no-op.
 */
export function step(state: GameState): GameState {
  if (state.outcome !== 'ongoing') return state

  const idx = nextActor(state.units)
  if (idx < 0) return state // no living units at all (defensive)

  const units = state.units.map((u) => ({ ...u }))
  advanceCharges(units, idx)
  const actor = units[idx]

  const turn = state.turn + 1
  // `round` is now a cosmetic counter (CTB has no clean wrap): tick it whenever the
  // first living unit takes a turn — a soft "the order came around" marker.
  const firstLiving = units.findIndex((u) => u.hp > 0)
  const round = state.round + (idx === firstLiving ? 1 : 0)

  const decision = decide(actor, units)
  const kind = maneuverKind(decision.maneuver)
  const target = findTargetById(units, decision.targetId)
  const hpBefore = target === null ? 0 : target.hp
  const detail = applyManeuver(actor, target, decision.maneuver)

  const mainEntry: LogEntry = {
    turn,
    round,
    actorId: actor.id,
    actorName: actor.name,
    kind,
    targetName: target === null ? null : target.name,
    protocolIndex: decision.protocolIndex,
    reason: decision.reason,
    detail,
  }

  // Emit the moments this action produced; registered reactions for each kind fold in
  // before we judge the outcome. The engine never names a specific reaction — the
  // slice-4 counter-heal wall is just a `heal` listener. `action`/`damage` have no
  // listeners yet, but emitting them is what makes the system generic (a new reaction
  // file just works); the fold is a no-op when nothing is registered.
  // `record(...)` lines the brain emitted this turn → `note` entries, placed BEFORE the
  // action so `log.at(-1)` stays the action (the delve mirror relies on that). `stepNotes`
  // carries them up so the delve can fold them into its journal too.
  const noteEntries: LogEntry[] = (decision.notes ?? []).map((line) => ({
    turn, round, actorId: actor.id, actorName: actor.name, kind: 'note',
    targetName: null, protocolIndex: -1, reason: 'record', detail: line,
  }))

  const reactionEntries = reactionsForAction(actor, decision.maneuver, target, hpBefore, kind, units, { turn, round })
  const entries = [...noteEntries, mainEntry, ...reactionEntries]

  return {
    units,
    turn,
    round,
    cursor: idx,
    log: [...state.log, ...entries].slice(-50),
    outcome: outcomeOf(units),
    stepNotes: decision.notes,
  }
}

/**
 * A REST (exploration): the party tends itself off-combat by running each living
 * golem's OWN Procedure against the party alone — no enemies. Attack/flee rules
 * resolve to null with no foes, so only Mend rules fire — "c'est Mend pareil":
 * the same skill, the same Attunement potency, the same Poise/Strain budget as in
 * combat (so resting is bounded, and a party with no healer gets nothing). It runs
 * to CONVERGENCE — passes repeat until one casts nothing (everyone is back above
 * their Mend thresholds) — so a rest is a single recovery EVENT, not a metered
 * per-step trickle ("si c'est un repos, ce n'est pas un pas"). Strain accrued here
 * carries on into the next fight; it only cools at the tower. Pure: returns fresh
 * units + how many Mends were cast.
 */
export function restToConvergence(party: Combatant[]): { units: Combatant[]; mends: number } {
  const units = party.map((u) => ({ ...u }))
  let mends = 0
  const cap = Math.max(1, units.length) * 16 // insurance against a pathological loop
  for (let pass = 0; pass < cap; pass += 1) {
    let castThisPass = false
    for (const actor of units) {
      if (actor.hp <= 0) continue
      const d = decide(actor, units)
      if (d.maneuver.command === 'useSkill' && d.maneuver.skill === 'mend' && d.targetId !== null) {
        applyManeuver(actor, units.find((u) => u.id === d.targetId) ?? null, d.maneuver)
        mends += 1
        castThisPass = true
      }
    }
    if (!castThisPass) break
  }
  return { units, mends }
}
