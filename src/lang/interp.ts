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
  get(name: string): LangValue
  /** Optional human/gibberish rendering for `print`. */
  repr?(): string
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
  return typeof v === 'object' && v !== null && (v as { host?: boolean }).host === true
}

// --- Environment -------------------------------------------------------------

export class Env {
  private vars = new Map<string, LangValue>()
  private globalNames = new Set<string>()
  constructor(
    public parent: Env | null = null,
    public globalEnv: Env | null = null,
  ) {
    if (globalEnv === null) this.globalEnv = this
  }
  declareGlobal(name: string): void {
    this.globalNames.add(name)
  }
  get(name: string): LangValue {
    if (this.globalNames.has(name)) return (this.globalEnv as Env).get(name)
    if (this.vars.has(name)) return this.vars.get(name) as LangValue
    if (this.parent !== null) return this.parent.get(name)
    throw new RuntimeError(`name '${name}' is not defined`)
  }
  has(name: string): boolean {
    if (this.vars.has(name)) return true
    return this.parent !== null && this.parent.has(name)
  }
  set(name: string, value: LangValue): void {
    if (this.globalNames.has(name)) { (this.globalEnv as Env).vars.set(name, value); return }
    this.vars.set(name, value)
  }
}

// --- Control-flow signals (thrown, not returned) -----------------------------

class ReturnSignal { constructor(public value: LangValue) {} }
class BreakSignal {}
class ContinueSignal {}

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
      else this.exec(stmt, genv)
    }
    const fn = genv.has(entry) ? genv.get(entry) : null
    if (!(fn instanceof LangFunc)) throw new RuntimeError(`'${entry}' is not defined as a function`)
    return this.call(fn, args)
  }

  call(fn: LangValue, args: LangValue[]): LangValue {
    if (fn instanceof Builtin) return fn.fn(args)
    if (fn instanceof LangFunc) {
      if (args.length !== fn.params.length) throw new RuntimeError(`${fn.name}() expects ${fn.params.length} args, got ${args.length}`)
      const env = new Env(fn.closure, fn.closure.globalEnv)
      fn.params.forEach((p, i) => env.set(p, args[i]))
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

  private exec(stmt: Stmt, env: Env): void {
    this.burn()
    switch (stmt.k) {
      case 'func':
        env.set(stmt.name, new LangFunc(stmt.params, stmt.body, env, stmt.name))
        return
      case 'return':
        throw new ReturnSignal(stmt.value === null ? null : this.eval(stmt.value, env))
      case 'expr':
        this.eval(stmt.value, env)
        return
      case 'assign':
        this.assign(stmt.target, this.eval(stmt.value, env), env)
        return
      case 'if':
        if (truthy(this.eval(stmt.test, env))) this.execBlock(stmt.body, env)
        else this.execBlock(stmt.orelse, env)
        return
      case 'while':
        while (truthy(this.eval(stmt.test, env))) {
          this.burn()
          try { this.execBlock(stmt.body, env) }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e }
        }
        return
      case 'for': {
        for (const item of this.iterate(this.eval(stmt.iter, env))) {
          this.burn()
          env.set(stmt.var, item)
          try { this.execBlock(stmt.body, env) }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e }
        }
        return
      }
      case 'break': throw new BreakSignal()
      case 'continue': throw new ContinueSignal()
      case 'pass': return
      case 'global': for (const n of stmt.names) env.declareGlobal(n); return
      case 'import': this.importLibrary(stmt.name, env); return
    }
  }

  /** `import x` — compile library `x`'s source and expose its top-level `def`s as a
   *  namespace host object bound to `x` (so `x.fn()` calls them). Library functions
   *  close over the importing GLOBAL scope, so they can use the same host builtins
   *  (attack/use/move/…) and `me`/`senses` the main program sees. */
  private importLibrary(name: string, env: Env): void {
    const src = this.libraries[name]
    if (src === undefined) throw new RuntimeError(`no library '${name}'`)
    const genv = env.globalEnv as Env
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

  private iterate(v: LangValue): LangValue[] {
    if (Array.isArray(v)) return v
    if (v instanceof Set) return [...v]
    if (v instanceof Map) return [...v.keys()]
    if (typeof v === 'string') return [...v]
    if (isHost(v)) {
      const items = v.get('__iter__')
      if (Array.isArray(items)) return items
    }
    throw new RuntimeError('object is not iterable')
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
        if (e.op === '-') return -(this.num(v))
        return this.num(v)
      }
      case 'bool_op': {
        const l = this.eval(e.left, env)
        if (e.op === 'and') return truthy(l) ? this.eval(e.right, env) : l
        return truthy(l) ? l : this.eval(e.right, env)
      }
      case 'compare': return this.compare(e.op, this.eval(e.left, env), this.eval(e.right, env))
      case 'binary': return this.binary(e.op, this.eval(e.left, env), this.eval(e.right, env))
      case 'attr': return this.getAttr(this.eval(e.obj, env), e.name)
      case 'index': return this.getIndex(this.eval(e.obj, env), this.eval(e.index, env))
      case 'call': {
        const fn = this.eval(e.fn, env)
        const args = e.args.map((a) => this.eval(a, env))
        return this.call(fn, args)
      }
    }
  }

  private comprehension(e: Extract<Expr, { k: 'comp' }>, env: Env): LangValue {
    const out: LangValue[] = []
    for (const item of this.iterate(this.eval(e.iter, env))) {
      this.burn()
      const inner = new Env(env, env.globalEnv)
      inner.set(e.var, item)
      if (e.cond !== null && !truthy(this.eval(e.cond, inner))) continue
      out.push(this.eval(e.element, inner))
    }
    return e.kind === 'set' ? new Set(out) : out
  }

  private num(v: LangValue): number {
    if (typeof v === 'number') return v
    throw new RuntimeError('expected a number')
  }
  private binary(op: string, a: LangValue, b: LangValue): LangValue {
    if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b
    const x = this.num(a)
    const y = this.num(b)
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
  private compare(op: string, a: LangValue, b: LangValue): LangValue {
    if (op === '==') return langEq(a, b)
    if (op === '!=') return !langEq(a, b)
    if (op === 'in' || op === 'not in') {
      const found = this.contains(b, a)
      return op === 'in' ? found : !found
    }
    const x = this.num(a)
    const y = this.num(b)
    switch (op) {
      case '<': return x < y
      case '<=': return x <= y
      case '>': return x > y
      case '>=': return x >= y
    }
    throw new RuntimeError(`bad comparison ${op}`)
  }
  private contains(container: LangValue, item: LangValue): boolean {
    if (Array.isArray(container)) return container.some((c) => langEq(c, item))
    if (container instanceof Set) return container.has(item)
    if (container instanceof Map) return container.has(item)
    if (typeof container === 'string' && typeof item === 'string') return container.includes(item)
    throw new RuntimeError('argument is not a container')
  }

  private getIndex(obj: LangValue, idx: LangValue): LangValue {
    if (obj instanceof Map) {
      if (!obj.has(idx)) throw new RuntimeError(`key not found`)
      return obj.get(idx) as LangValue
    }
    if (Array.isArray(obj) && typeof idx === 'number') {
      const v = obj[idx < 0 ? obj.length + idx : idx]
      if (v === undefined) throw new RuntimeError('index out of range')
      return v
    }
    if (typeof obj === 'string' && typeof idx === 'number') {
      const c = obj[idx < 0 ? obj.length + idx : idx]
      if (c === undefined) throw new RuntimeError('index out of range')
      return c
    }
    throw new RuntimeError('object is not subscriptable')
  }

  private getAttr(obj: LangValue, name: string): LangValue {
    if (isHost(obj)) return obj.get(name)
    if (Array.isArray(obj)) return this.listMethod(obj, name)
    if (obj instanceof Set) return this.setMethod(obj, name)
    if (obj instanceof Map) return this.dictMethod(obj, name)
    throw new RuntimeError(`no attribute '${name}'`)
  }
  private listMethod(list: LangValue[], name: string): Builtin {
    switch (name) {
      case 'append': return new Builtin((a) => { list.push(a[0]); return null }, 'append')
      case 'pop': return new Builtin((a) => {
        const i = a.length > 0 ? this.num(a[0]) : list.length - 1
        const [v] = list.splice(i < 0 ? list.length + i : i, 1)
        return v ?? null
      }, 'pop')
      case 'contains': return new Builtin((a) => list.some((c) => langEq(c, a[0])), 'contains')
    }
    throw new RuntimeError(`list has no attribute '${name}'`)
  }
  private setMethod(set: Set<LangValue>, name: string): Builtin {
    switch (name) {
      case 'add': return new Builtin((a) => { set.add(a[0]); return null }, 'add')
      case 'discard': return new Builtin((a) => { set.delete(a[0]); return null }, 'discard')
    }
    throw new RuntimeError(`set has no attribute '${name}'`)
  }
  private dictMethod(map: Map<LangValue, LangValue>, name: string): Builtin {
    switch (name) {
      case 'get': return new Builtin((a) => map.has(a[0]) ? (map.get(a[0]) as LangValue) : (a[1] ?? null), 'get')
      case 'setdefault': return new Builtin((a) => {
        if (!map.has(a[0])) map.set(a[0], a[1] ?? null)
        return map.get(a[0]) as LangValue
      }, 'setdefault')
      case 'pop': return new Builtin((a) => {
        if (!map.has(a[0])) return a[1] ?? null
        const v = map.get(a[0]) as LangValue
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
}

/** The standard builtins shared by every host context (len, set, print, min/max). */
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
      const v = a[0]
      if (v === undefined) return new Set<LangValue>()
      if (Array.isArray(v)) return new Set(v)
      if (v instanceof Set) return new Set(v)
      throw new RuntimeError('set() expects a list')
    }, 'set'),
    print: new Builtin((a) => {
      interp.output.push(a.map((v) => reprValue(v)).join(' '))
      return null
    }, 'print'),
  }
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
  const set = (j as Record<string, Json>).__set
  if (Array.isArray(set)) return new Set(set.map(jsonToValue))
  const dict = (j as Record<string, Json>).__dict
  if (Array.isArray(dict)) return new Map((dict as Json[][]).map((pair) => [jsonToValue(pair[0]), jsonToValue(pair[1])]))
  return null
}

/** A debug rendering of a value (drives `print` + the future console). */
export function reprValue(v: LangValue): string {
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'number' || typeof v === 'string') return String(v)
  if (Array.isArray(v)) return `[${v.map(reprValue).join(', ')}]`
  if (v instanceof Set) return `{${[...v].map(reprValue).join(', ')}}`
  if (v instanceof Map) return `{${[...v].map(([k, val]) => `${reprValue(k)}: ${reprValue(val)}`).join(', ')}}`
  if (isHost(v) && v.repr !== undefined) return v.repr()
  if (v instanceof Builtin || v instanceof LangFunc) return `<function ${v.name}>`
  return '<object>'
}
