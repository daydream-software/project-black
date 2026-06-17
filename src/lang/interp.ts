// The Inscription INTERPRETER — a tree-walking evaluator of the parsed AST, PURE and
// deterministic (docs/INSCRIPTION-LANG.md §9). No persistent program counter: a host
// calls one entry function per turn and reads back its return value. The interpreter
// OWNS the whole namespace (host objects + builtins injected by the caller), so there
// is no clock / randomness / host escape — determinism and the sandbox come for free.
// A per-run FUEL budget bounds loops/recursion; overrun throws FuelError.

import { parse, type Module, type Stmt, type Expr } from './parser'

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeError'
  }
}
export class FuelError extends RuntimeError {
  constructor() {
    super('instruction budget exceeded')
    this.name = 'FuelError'
  }
}

// --- Runtime values ----------------------------------------------------------

export type LangValue =
  | number | string | boolean | null
  | LangValue[]
  | Set<LangValue>
  | Map<LangValue, LangValue>
  | LangFunc
  | Builtin
  | HostObject

export interface HostObject {
  host: true
  get: (name: string) => LangValue
  /** Optional human/gibberish rendering for `record`. */
  repr?: () => string
}
export class Builtin {
  constructor(
    public fn: (args: LangValue[]) => LangValue,
    public name = '<builtin>',
  ) {}
}
export class LangFunc {
  constructor(
    public params: string[],
    public body: Stmt[],
    public closure: Env,
    public name: string,
  ) {}
}

export function isHost(v: LangValue): v is HostObject {
  // The only LangValue object carrying a `host` key is HostObject (host: true), so the
  // key's presence is the guard — no value compare needed.
  return typeof v === 'object' && v !== null && 'host' in v
}

// --- Environment -------------------------------------------------------------

export class Env {
  private readonly vars = new Map<string, LangValue>()
  private readonly globalNames = new Set<string>()
  constructor(
    public parent: Env | null = null,
    public globalEnv: Env | null = null,
  ) {
    if (globalEnv === null) this.globalEnv = this
  }
  // globalEnv is set to `this` in the constructor when null, so it's never actually null;
  // this getter encodes that so call sites need no `!`/cast.
  get globalScope(): Env { return this.globalEnv ?? this }
  declareGlobal(name: string): void {
    this.globalNames.add(name)
  }
  get(name: string): LangValue {
    if (this.globalNames.has(name)) return this.globalScope.get(name)
    const local = this.vars.get(name) // values are LangValue (never undefined) ⇒ undefined = absent
    if (local !== undefined) return local
    if (this.parent !== null) return this.parent.get(name)
    throw new RuntimeError(`name '${name}' is not defined`)
  }
  has(name: string): boolean {
    if (this.vars.has(name)) return true
    return this.parent?.has(name) ?? false
  }
  set(name: string, value: LangValue): void {
    if (this.globalNames.has(name)) { this.globalScope.vars.set(name, value); return }
    this.vars.set(name, value)
  }
}

// --- Control-flow signals (thrown, not returned) -----------------------------
// They extend Error (so `throw`ing them is well-typed) but carry no stack cost beyond
// the message; they're always caught at the loop/call boundary, never surfaced.

class ReturnSignal extends Error {
  constructor(public value: LangValue) { super('return') }
}
class BreakSignal extends Error {
  constructor() { super('break') }
}
class ContinueSignal extends Error {
  constructor() { super('continue') }
}

// --- Truthiness / equality ---------------------------------------------------

export function truthy(v: LangValue): boolean {
  if (v === null || v === false) return false
  if (v === true) return true
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (v instanceof Set) return v.size > 0
  if (v instanceof Map) return v.size > 0
  return true
}

function langEq(a: LangValue, b: LangValue): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  return false
}

// --- Interpreter -------------------------------------------------------------

export interface Program {
  module: Module
}

const cache = new Map<string, Program>()

// The player's shared libraries (name → source), set by the editor. The deciders read
// this so `import` works without threading library source through the sim/delve state.
let registeredLibraries: Record<string, string> = {}
export function setLibraries(libs: Record<string, string>): void { registeredLibraries = libs }
export function libraries(): Record<string, string> { return registeredLibraries }

/** Parse (and cache by source) a program. Throws Lex/Parse errors. */
export function compile(src: string): Program {
  const hit = cache.get(src)
  if (hit !== undefined) return hit
  const program: Program = { module: parse(src) }
  cache.set(src, program)
  return program
}

export class Interp {
  private fuel: number
  private libraries: Record<string, string> = {}
  output: string[] = []
  constructor(fuelBudget = 10_000) {
    this.fuel = fuelBudget
  }
  private burn(): void {
    this.fuel -= 1
    if (this.fuel <= 0) throw new FuelError()
  }

  /** Define the module's top-level `def`s into `globals`, then call `entry(args)`.
   *  `libraries` (name → source) back the `import` statement — player-authored helper
   *  files exposed as `name.fn()` (TFWR-style). */
  run(
    program: Program,
    entry: string,
    args: LangValue[],
    globals: Record<string, LangValue>,
    libraries: Record<string, string> = {},
  ): LangValue {
    this.libraries = libraries
    const genv = new Env()
    for (const [k, v] of Object.entries(globals)) genv.set(k, v)
    for (const stmt of program.module.body) {
      if (stmt.k === 'func') genv.set(stmt.name, new LangFunc(stmt.params, stmt.body, genv, stmt.name))
      // `Engram.combat_turn:` registers a 0-param function named by its entry (senses ambient).
      else if (stmt.k === 'entry') genv.set(stmt.entry, new LangFunc([], stmt.body, genv, stmt.entry))
      else this.exec(stmt, genv)
    }
    const fn = genv.has(entry) ? genv.get(entry) : null
    if (!(fn instanceof LangFunc)) throw new RuntimeError(`'${entry}' is not defined as a function`)
    // Arity tolerance: an `Engram.X:` entry is 0-param (senses is ambient); a legacy
    // `def combat_turn(senses):` is 1-param — pass senses only if it expects it.
    return this.call(fn, fn.params.length === 0 ? [] : args)
  }

  call(fn: LangValue, args: LangValue[]): LangValue {
    if (fn instanceof Builtin) return fn.fn(args)
    if (fn instanceof LangFunc) {
      if (args.length !== fn.params.length) throw new RuntimeError(`${fn.name}() expects ${fn.params.length} args, got ${args.length}`)
      const env = new Env(fn.closure, fn.closure.globalEnv)
      fn.params.forEach((p, i) => { env.set(p, args[i]); })
      try {
        for (const stmt of fn.body) this.exec(stmt, env)
      } catch (e) {
        if (e instanceof ReturnSignal) return e.value
        throw e
      }
      return null
    }
    throw new RuntimeError('object is not callable')
  }

  private execBlock(body: Stmt[], env: Env): void {
    for (const stmt of body) this.exec(stmt, env)
  }

  // Split into simple statements (here) and control/compound (execControl) so each
  // dispatch stays under the complexity cap — same behaviour, grouped by kind.
  private exec(stmt: Stmt, env: Env): void {
    this.burn()
    switch (stmt.k) {
      case 'func': env.set(stmt.name, new LangFunc(stmt.params, stmt.body, env, stmt.name)); return
      // entry blocks are registered at the top level (run); inert if nested
      case 'entry': env.set(stmt.entry, new LangFunc([], stmt.body, env, stmt.entry)); return
      case 'return': throw new ReturnSignal(stmt.value === null ? null : this.eval(stmt.value, env))
      case 'expr': this.eval(stmt.value, env); return
      case 'assign': this.assign(stmt.target, this.eval(stmt.value, env), env); return
      case 'pass': return
      default: this.execControl(stmt, env)
    }
  }

  /** Control-flow / compound statements (if / loops / break / continue / global / import). */
  private execControl(stmt: Stmt, env: Env): void {
    switch (stmt.k) {
      case 'if': this.execBlock(truthy(this.eval(stmt.test, env)) ? stmt.body : stmt.orelse, env); return
      case 'while': case 'for': this.execLoop(stmt, env); return
      case 'break': throw new BreakSignal()
      case 'continue': throw new ContinueSignal()
      case 'global': for (const n of stmt.names) env.declareGlobal(n); return
      case 'import': this.importLibrary(stmt.name, env); return
      // exec() only routes control/compound kinds here; simple kinds never reach this.
      default: throw new RuntimeError(`cannot execute statement '${stmt.k}'`)
    }
  }

  /** A `while` / `for` loop, with break/continue handled identically for both. */
  private execLoop(stmt: Extract<Stmt, { k: 'while' } | { k: 'for' }>, env: Env): void {
    const run = (): boolean => { // run the body once; false ⇒ break out
      this.burn()
      try { this.execBlock(stmt.body, env) } catch (e) {
        if (e instanceof BreakSignal) return false
        if (!(e instanceof ContinueSignal)) throw e
      }
      return true
    }
    if (stmt.k === 'while') {
      while (truthy(this.eval(stmt.test, env))) { if (!run()) break }
      return
    }
    for (const item of iterate(this.eval(stmt.iter, env))) {
      env.set(stmt.var, item)
      if (!run()) break
    }
  }

  /** `import x` — compile library `x`'s source and expose its top-level `def`s as a
   *  namespace host object bound to `x` (so `x.fn()` calls them). Library functions
   *  close over the importing GLOBAL scope, so they can use the same host builtins
   *  (attack/use/move/…) and `me`/`senses` the main program sees. */
  private importLibrary(name: string, env: Env): void {
    if (!(name in this.libraries)) throw new RuntimeError(`no library '${name}'`)
    const src = this.libraries[name]
    const genv = env.globalScope
    const libEnv = new Env(genv, genv)
    for (const stmt of compile(src).module.body) {
      if (stmt.k === 'func') libEnv.set(stmt.name, new LangFunc(stmt.params, stmt.body, libEnv, stmt.name))
      else this.exec(stmt, libEnv)
    }
    const ns: HostObject = { host: true, get: (member: string): LangValue => libEnv.get(member) }
    env.set(name, ns)
  }

  private assign(target: Expr, value: LangValue, env: Env): void {
    if (target.k === 'name') { env.set(target.id, value); return }
    if (target.k === 'index') {
      const obj = this.eval(target.obj, env)
      const idx = this.eval(target.index, env)
      if (obj instanceof Map) { obj.set(idx, value); return }
      if (Array.isArray(obj) && typeof idx === 'number') { obj[idx] = value; return }
      throw new RuntimeError('object does not support item assignment')
    }
    throw new RuntimeError('invalid assignment target')
  }

  private eval(e: Expr, env: Env): LangValue {
    this.burn()
    switch (e.k) {
      case 'num': return e.value
      case 'str': return e.value
      case 'bool': return e.value
      case 'none': return null
      case 'name': return env.get(e.id)
      case 'list': return e.items.map((it) => this.eval(it, env))
      case 'set': return new Set(e.items.map((it) => this.eval(it, env)))
      case 'dict': {
        const m = new Map<LangValue, LangValue>()
        for (const [k, v] of e.pairs) m.set(this.eval(k, env), this.eval(v, env))
        return m
      }
      case 'comp': return this.comprehension(e, env)
      case 'unary': {
        const v = this.eval(e.operand, env)
        if (e.op === 'not') return !truthy(v)
        if (e.op === '-') return -num(v)
        return num(v)
      }
      case 'bool_op': {
        const l = this.eval(e.left, env)
        if (e.op === 'and') return truthy(l) ? this.eval(e.right, env) : l
        return truthy(l) ? l : this.eval(e.right, env)
      }
      case 'compare': return compare(e.op, this.eval(e.left, env), this.eval(e.right, env))
      case 'binary': return binary(e.op, this.eval(e.left, env), this.eval(e.right, env))
      case 'attr': return getAttr(this.eval(e.obj, env), e.name)
      case 'index': return getIndex(this.eval(e.obj, env), this.eval(e.index, env))
      case 'call': {
        const fn = this.eval(e.fn, env)
        const args = e.args.map((a) => this.eval(a, env))
        return this.call(fn, args)
      }
    }
  }

  private comprehension(e: Extract<Expr, { k: 'comp' }>, env: Env): LangValue {
    const out: LangValue[] = []
    for (const item of iterate(this.eval(e.iter, env))) {
      this.burn()
      const inner = new Env(env, env.globalEnv)
      inner.set(e.var, item)
      if (e.cond !== null && !truthy(this.eval(e.cond, inner))) continue
      out.push(this.eval(e.element, inner))
    }
    return e.kind === 'set' ? new Set(out) : out
  }

}

// --- Value operations (pure; the interpreter's dynamic dispatch over LangValue) ---
// Free functions, not Interp methods: they take no `this`, only their operands.

function iterate(v: LangValue): LangValue[] {
  if (Array.isArray(v)) return v
  if (v instanceof Set) return [...v]
  if (v instanceof Map) return [...v.keys()]
  if (typeof v === 'string') return Array.from(v)
  if (isHost(v)) {
    const items = v.get('__iter__')
    if (Array.isArray(items)) return items
  }
  throw new RuntimeError('object is not iterable')
}

function num(v: LangValue): number {
  if (typeof v === 'number') return v
  throw new RuntimeError('expected a number')
}

function binary(op: string, a: LangValue, b: LangValue): LangValue {
  if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b
  const x = num(a)
  const y = num(b)
  switch (op) {
    case '+': return x + y
    case '-': return x - y
    case '*': return x * y
    case '/': return x / y
    case '//': return Math.floor(x / y)
    case '%': return ((x % y) + y) % y
    case '**': return x ** y
  }
  throw new RuntimeError(`bad operator ${op}`)
}

function compare(op: string, a: LangValue, b: LangValue): LangValue {
  if (op === '==') return langEq(a, b)
  if (op === '!=') return !langEq(a, b)
  if (op === 'in' || op === 'not in') {
    const found = contains(b, a)
    return op === 'in' ? found : !found
  }
  const x = num(a)
  const y = num(b)
  switch (op) {
    case '<': return x < y
    case '<=': return x <= y
    case '>': return x > y
    case '>=': return x >= y
  }
  throw new RuntimeError(`bad comparison ${op}`)
}

function contains(container: LangValue, item: LangValue): boolean {
  if (Array.isArray(container)) return container.some((c) => langEq(c, item))
  if (container instanceof Set) return container.has(item)
  if (container instanceof Map) return container.has(item)
  if (typeof container === 'string' && typeof item === 'string') return container.includes(item)
  throw new RuntimeError('argument is not a container')
}

/** Resolve a (possibly negative) sequence index, bounds-checked. */
function seqIndex(len: number, idx: number): number {
  const i = idx < 0 ? len + idx : idx
  if (i < 0 || i >= len) throw new RuntimeError('index out of range')
  return i
}

function getIndex(obj: LangValue, idx: LangValue): LangValue {
  if (obj instanceof Map) {
    const v = obj.get(idx) // values are LangValue (never undefined) ⇒ undefined = absent key
    if (v === undefined) throw new RuntimeError('key not found')
    return v
  }
  if (Array.isArray(obj) && typeof idx === 'number') return obj[seqIndex(obj.length, idx)]
  if (typeof obj === 'string' && typeof idx === 'number') return obj[seqIndex(obj.length, idx)]
  throw new RuntimeError('object is not subscriptable')
}

function getAttr(obj: LangValue, name: string): LangValue {
  if (isHost(obj)) return obj.get(name)
  if (Array.isArray(obj)) return listMethod(obj, name)
  if (obj instanceof Set) return setMethod(obj, name)
  if (obj instanceof Map) return dictMethod(obj, name)
  throw new RuntimeError(`no attribute '${name}'`)
}

function listMethod(list: LangValue[], name: string): Builtin {
  switch (name) {
    case 'append': return new Builtin((a) => { list.push(a[0]); return null }, 'append')
    case 'pop': return new Builtin((a) => {
      const i = a.length > 0 ? num(a[0]) : list.length - 1
      const [v] = list.splice(i < 0 ? list.length + i : i, 1)
      return v ?? null
    }, 'pop')
    case 'contains': return new Builtin((a) => list.some((c) => langEq(c, a[0])), 'contains')
  }
  throw new RuntimeError(`list has no attribute '${name}'`)
}

function setMethod(set: Set<LangValue>, name: string): Builtin {
  switch (name) {
    case 'add': return new Builtin((a) => { set.add(a[0]); return null }, 'add')
    case 'discard': return new Builtin((a) => { set.delete(a[0]); return null }, 'discard')
  }
  throw new RuntimeError(`set has no attribute '${name}'`)
}

function dictMethod(map: Map<LangValue, LangValue>, name: string): Builtin {
  switch (name) {
    case 'get': return new Builtin((a) => { const v = map.get(a[0]); return v === undefined ? (a[1] ?? null) : v }, 'get')
    case 'setdefault': return new Builtin((a) => {
      if (!map.has(a[0])) map.set(a[0], a[1] ?? null)
      return map.get(a[0]) ?? null
    }, 'setdefault')
    case 'pop': return new Builtin((a) => {
      const v = map.get(a[0])
      if (v === undefined) return a[1] ?? null
      map.delete(a[0])
      return v
    }, 'pop')
    case 'update': return new Builtin((a) => {
      const other = a[0]
      if (other instanceof Map) for (const [k, v] of other) map.set(k, v)
      return null
    }, 'update')
    case 'keys': return new Builtin(() => [...map.keys()], 'keys')
  }
  throw new RuntimeError(`dict has no attribute '${name}'`)
}

/** The standard builtins shared by every host context (len, set, record, min/max). */
export function baseBuiltins(interp: Interp): Record<string, LangValue> {
  return {
    len: new Builtin((a) => {
      const v = a[0]
      if (Array.isArray(v)) return v.length
      if (typeof v === 'string') return v.length
      if (v instanceof Set) return v.size
      if (v instanceof Map) return v.size
      throw new RuntimeError('object has no len()')
    }, 'len'),
    set: new Builtin((a) => {
      if (a.length === 0) return new Set<LangValue>()
      const v = a[0]
      if (Array.isArray(v)) return new Set(v)
      if (v instanceof Set) return new Set(v)
      throw new RuntimeError('set() expects a list')
    }, 'set'),
    // `record(...)` writes one line to the delve JOURNAL — the in-fiction debug console
    // (renamed from `print`; never gated — debugging must never cost Insight). The decider
    // drains `interp.output` after the turn and the delve folds each line in as a `note`.
    record: new Builtin((a) => {
      interp.output.push(a.map((v) => reprValue(v)).join(' '))
      return null
    }, 'record'),
  }
}

/** Max `record(...)` lines kept from a single turn — a backstop so a `record` inside a
 *  loop (once `lang-loops` unlocks) can't flood the journal or bloat the save blob. */
export const MAX_NOTES_PER_TURN = 20

/** Cap a turn's recorded lines, replacing the overflow with a "… N more" marker. */
export function capNotes(lines: readonly string[]): string[] {
  if (lines.length <= MAX_NOTES_PER_TURN) return [...lines]
  return [...lines.slice(0, MAX_NOTES_PER_TURN), `… ${lines.length - MAX_NOTES_PER_TURN} more`]
}

// --- Serialisation (for delve-scoped Memory round-tripping through the save) ------
// Memory is a player-mutated dict that must JSON-serialise deterministically so a
// delve resumes exactly. Sets/dicts get tagged forms; functions/host objects are not
// serialisable (they never legitimately live in Memory) and encode as null.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export function valueToJson(v: LangValue): Json {
  if (v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(valueToJson)
  if (v instanceof Set) return { __set: [...v].map(valueToJson) }
  if (v instanceof Map) return { __dict: [...v].map(([k, val]) => [valueToJson(k), valueToJson(val)] as Json) }
  return null
}

export function jsonToValue(j: Json): LangValue {
  if (j === null || typeof j === 'boolean' || typeof j === 'number' || typeof j === 'string') return j
  if (Array.isArray(j)) return j.map(jsonToValue)
  // j is now a Json object: `{ [k: string]: Json }`, so member access needs no cast.
  const set = j.__set
  if (Array.isArray(set)) return new Set(set.map(jsonToValue))
  const dict = j.__dict
  if (Array.isArray(dict)) {
    const entries: Array<[LangValue, LangValue]> = []
    for (const pair of dict) if (Array.isArray(pair)) entries.push([jsonToValue(pair[0]), jsonToValue(pair[1])])
    return new Map(entries)
  }
  return null
}

function reprColl(v: LangValue[] | Set<LangValue> | Map<LangValue, LangValue>): string {
  if (Array.isArray(v)) return `[${v.map(reprValue).join(', ')}]`
  if (v instanceof Set) return `{${[...v].map(reprValue).join(', ')}}`
  return `{${[...v].map(([k, val]) => `${reprValue(k)}: ${reprValue(val)}`).join(', ')}}`
}

function reprObject(v: LangValue): string {
  if (isHost(v) && v.repr !== undefined) return v.repr()
  if (v instanceof Builtin || v instanceof LangFunc) return `<function ${v.name}>`
  return '<object>'
}

/** A debug rendering of a value (drives `record` → the journal). */
export function reprValue(v: LangValue): string {
  if (v === null) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number' || typeof v === 'string') return String(v)
  if (Array.isArray(v) || v instanceof Set || v instanceof Map) return reprColl(v)
  return reprObject(v)
}
