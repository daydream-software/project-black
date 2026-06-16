# Inscription Language — code-based golem brains (DESIGN, not implemented)

> **Status (2026-06-16): BUILT — slices 1–4 + editor (A) + migration (B).** `src/lang/`,
> 156 tests green, typecheck + build clean, **in-app verified** (Playwright: clean boot,
> 3 CodeMirror editors mount, edit→save round-trip, "Fill from slots" generates code).
> Combat + exploration interpreters drive the real engine via DI hooks; `import lib`
> works (shared library); the Workshop has combat / exploration / library code editors
> The slot Procedure **editor was retired** (authoring is code-only); existing saves
> migrate slots→code on load, new golems seed a default program. The slot ENGINE stays
> for monsters + as the empty-program fallback. The rest of this doc is the spec.
>
> Goal: replace the
> slot-based Procedure editor with a small **code language** that golems run, at
> **parity** — defined as *a coded brain can run a full delve end-to-end* (explore,
> trip the fights, grab loot, find & kill the target, return). **Combat** parity
> reproduces the shipped combat vocabulary 1:1 (it's already observable).
> **Exploration** parity reaches the same outcome with **navigation authored in
> player code** rather than by the engine — the engine is *already* fog-gated, not
> omniscient (see §4); the win is agency + the substrate for splitting. Sits beside
> [VOCABULARY.md](VOCABULARY.md) (the slot grammar it would supersede) and
> [VISION.md](VISION.md).

The fiction (VISION's Artificer): you **inscribe** a golem's core with the code
it runs. Same rule engine, new authoring surface.

---

## 0. Execution model — reactive, no program counter

The brain is a **pure per-turn function that returns one action**, re-called fresh
each turn. Identical semantics to today's `decide()` (`sim.ts`) /
`decideExploration()` (`delve.ts`): a policy `state → action`, **not** a
sequential script. The user explicitly rejected step-by-step execution.

```python
def combat_turn(senses)      -> Action   # per golem, each combat turn
def exploration_turn(senses) -> Move     # party-wide today (per-golem later)
```

- `senses` (the per-turn perception) is the **parameter**.
- `me` (the current golem) and `Memory` (its persistent store) are **ambient**
  injected globals — `Memory is me.memory`.
- No persistent program counter ⇒ no VM state in the save ⇒ determinism is free.

---

## 1. The language (a small Python subset)

Full target grammar. **Parity needs only the ✓ rows**; the rest is headroom the
design intends but a first cut can defer.

| Construct | Parity | Notes |
|---|:--:|---|
| int / float / str / bool / `None` | ✓ | `hp_pct` is 0–100, so `< 30` suffices — **no `%` literal** (it clashes with modulo `%`) |
| enum members (`Skills.Mend`, `Goal.Target`) | ✓ | injected, see §2 |
| name / attribute (`me.hp_pct`) / index (`Memory["x"]`) | ✓ | |
| call (`use(...)`, `senses.allies.lowest_hp`) | ✓ | |
| comparison `< <= > >= == !=` | ✓ | |
| boolean `and` / `or` / `not`, `in` / `not in` | ✓ | |
| arithmetic `+ - * / %` | ✓ | |
| `if` / `elif` / `else`, `return` | ✓ | early return = priority order |
| local assignment (`ally = senses.allies.lowest_hp`) | ✓ | |
| list / set / dict literals + **comprehensions** | – | needed for "first ally passing P" (see §5) |
| `for … in`, `while` (**fuel-bounded**), `break` / `continue` / `pass` | – | not needed for parity; gambits have no loops |
| `def` (helper functions) | – | code reuse |
| `global`, `import x` (player libraries, `x.f()`) | – | libs; itself an unlock (TFWR-style) |
| `print(...)` | – | debug console / journal |

**Not in the language, ever:** `random`/clock/IO (nondeterminism), real Python
imports, anything touching the host. The interpreter owns the whole namespace.

---

## 2. Injected namespace

`{ me, Memory, senses, party, attack, use, flee, wait, move, rest, retreat,
Skills, RoomType }` — plus, **beyond parity**, the bestiary enums (`EnemyType`,
`Foe`). **No spatial directions** — the dungeon graph is abstract (§4).

Enums are **generated from `src/content/`** (e.g. `Skills.Mend` ← `skills/mend.ts`).
A locked entry simply isn't in the namespace ⇒ referencing it is a name error.
That is the unlock gate, reusing today's `unlock?` + `available()`.

---

## 3. Combat parity

### `me` — the acting golem
`me.hp`, `me.max_hp`, `me.hp_pct`, `me.statuses`, `me.role`, `me.memory` (≡ `Memory`).

### `senses` — perception this turn
- `senses.allies`, `senses.enemies` — collections supporting:
  - pickers: `.lowest_hp`, `.highest_hp`, `.first` (list order = today's `near`/`any`)
  - `len(...)`, iteration, `.any(cond)`, `.where(cond)` (filtered collection)
- `senses.alone` (bool), `senses.escape` (a flee direction / `None`)
- per unit `u`: `u.hp`, `u.max_hp`, `u.hp_pct`, `u.statuses`, `u.is_casting`

### builtins
`attack(target)` · `use(skill, target)` · `flee(direction)` *(modelled, no effect
yet — as today)* · `wait()`.

### Mapping — every shipped combat vocab item

| Today (id) | In code |
|---|---|
| **Subject** `self` | `me` |
| `ally_any` | `senses.allies.first` (or `.where(...).first`) |
| `ally_low` | `senses.allies.lowest_hp` |
| `enemy_near` | `senses.enemies.first` |
| `enemy_low` | `senses.enemies.lowest_hp` |
| `enemy_high` | `senses.enemies.highest_hp` |
| **Predicate** `always` | `True` |
| `hp_full` | `u.hp_pct >= 100` |
| `hp_lt_50` | `u.hp_pct < 50` |
| `hp_lt_30` | `u.hp_pct < 30` |
| **Command** `attack` | `attack(t)` |
| `useSkill: mend` | `use(Skills.Mend, t)` |
| `useSkill: defend` | `use(Skills.Defend, t)` |
| `flee` | `flee(senses.escape)` |

### Worked example — incl. the Hex Warden wall

Today's healer-ish Procedure (the `Ally·low · HP<50% → Mend` rule is the
death-trap vs the Hex Warden's heal-counter):

```python
def combat_turn(senses):
    ally = senses.allies.lowest_hp
    if ally and ally.hp_pct < 50:
        return use(Skills.Mend, ally)        # ← Hex Warden punishes this
    if me.hp_pct < 30:
        return use(Skills.Defend, me)
    return attack(senses.enemies.first)
```

**Beating the wall is the same act as today** — remove/disable that one line:

```python
    # if ally and ally.hp_pct < 50:
    #     return use(Skills.Mend, ally)      # disabled → Warden no longer wins
```

---

## 4. Exploration parity — explore a delve, navigation in player code

Parity here = **a coded brain runs a delve end-to-end** by *exploring*.

⚠️ **Framing correction.** The current engine is **not** omniscient — it is already
fog-gated (`delve.ts`): `unexplored.stepToward` paths only over **seen** rooms, and
the boss is gated by `known` (no beeline until its room is discovered). The real axis
is therefore **not** POV-vs-omniscient — it's **who authors navigation: the engine
vs the player's code** (both respect the fog). The reasons to move it into code are
*agency/depth* and that it's the substrate for per-golem **split** (§7), which an
engine-driven single token can't do.

The dungeon is an **abstract graph** (`mapgraph.ts`): rooms are nodes, corridors
are **undirected** edges — **no coordinates, no N/E/S/W**. So there is no "right
wall"; player-authored navigation is graph DFS over opaque exit handles.

Today the party is one token ⇒ `exploration_turn` is **party-wide** with one
party-level `Memory` (the map). [Per-golem `Memory` + splitting is §7.]

### How a delve resolves (engine, unchanged — `delve.ts`)
**Entering a room is the action.** The engine **auto-fights** uncleared `fight`/`boss`
rooms on entry (`makeBattleFrom`), **auto-collects** `loot`, **auto-grants** `buff`
rooms. Returning a move to your *own* room = **rest** (off-combat Mend to convergence
— [[design-rest-is-offcombat-mend]]). No move at all ⇒ engine flips to **stuck**. So
`exploration_turn` only decides **which exit to take**; the kill, loot and boons fall
out of *walking in*.

### perception (`senses`) — local, graph-shaped
- `senses.exits` — the corridors from the current room. Each `exit`:
  - `exit.beyond` — the **sigil** of the neighbour (recognised by 1-hop peek)
  - `exit.leads_to` — the neighbour's **`RoomType`** (`Fight`/`Loot`/`Buff`/`Boss`/
    `Entrance`), known by the same peek; **`hidden` rooms aren't listed at all** until
    a vision buff reveals them
  - `exit.explored` — have we already entered that neighbour?
- `senses.room` — `.sigil`, `.type` (`RoomType`), `.cleared`, `.resolved`
- `party.hp_pct` — party aggregate (the old `php_*` predicates)

`RoomType` is **environmental perception, ungated** — unlike creature `EnemyType`/
`Foe`, which are bestiary-gated (§7).

### builtins
`move(exit)` (cross a corridor) · `rest()` (≡ stay put; off-combat Mend) ·
`retreat()` (step back toward the entrance over explored rooms — **at the entrance,
where there's nowhere left to fall back, it WITHDRAWS from the delve**) · `leave()`
(explicitly withdraw to town, ending the delve as `left`) · `wait()`.

> Note: `retreat()` carries the *intent* to fall back, so the engine can tell it from
> `rest()`. Both produce "stay put" at the entrance, but `retreat()`/`leave()` end the
> delve (status `left`) while `rest()` mends — they are no longer conflated.

### Tier 1 — engine navigates (reproduces `DEFAULT_EXPLORATION`)
The **engine** does the multi-hop, fog-gated pathfinding — surfaced as builtins:
`senses.unexplored_exit` steps toward the **nearest undiscovered frontier** (exactly
today's `unexplored·head`), `retreat()` paths home over explored rooms. So tier 1 is
the *current* behaviour as builtins — no `Memory`, no loops, but **the engine is the
navigator**, not the player:
```python
def exploration_turn(senses):
    if party.hp_pct < 30:
        return retreat()                  # was: php_lt_30 → retreat
    nxt = senses.unexplored_exit
    if nxt:
        return move(nxt)                  # was: unexplored · always → head
    return retreat()                      # all seen → fall back toward entrance
```

> **Pillar decision — DECIDED (2026-06-16): scaffolding.** Tier 1 is the onboarding
> ramp + the parity bridge from the slot editor; the intent is players **program
> their navigation** (tier 2). "You program how golems *delve*, not just fight" is a
> hard pillar, so engine nav comes off. ⇒ `senses.exits` / `room.sigil` / `Memory`
> are **core**; the tier-1 builtins are the **removable** layer.
>
> *How* it comes off is the only sub-question: a hard unlock-gate vs **soft content
> pressure** — hidden rooms, sigil-scramble biomes, and especially **split** (a split
> party can't ride a single-token engine nav). **Leaning soft:** you *outgrow* tier 1
> rather than hit a wall.

### Tier 2 — the PLAYER programs navigation (`Memory` DFS; required once golems split)
```python
def exploration_turn(senses):
    if party.hp_pct < 30:
        return retreat()
    here = senses.room.sigil
    seen = Memory.setdefault("seen", set())
    seen.add(here)
    for ex in senses.exits:               # take any edge to an unseen room
        if ex.beyond not in seen:
            Memory.setdefault("trail", []).append(here)
            return move(ex)
    trail = Memory.get("trail", [])       # dead end → backtrack where we came from
    if trail:
        prev = trail.pop()
        for ex in senses.exits:
            if ex.beyond == prev:
                return move(ex)
    return wait()
```
DFS visits every reachable room ⇒ always enters the `Boss` room ⇒ engine resolves
the fight. **Parity, honestly.** (You can even route *around* a `Fight` room when low
by checking `ex.leads_to == RoomType.Fight` — richer than the old vocab allowed.)

### Old vocab → capability (not 1:1)
| Today (already fog-gated) | Now (engine builtin or player code) |
|---|---|
| `target · known → head` (frontier beeline *once the boss room is discovered*) | tier 1: walk in via `unexplored_exit`; tier 2: DFS until you step into the `Boss` room — fight triggers on entry |
| `unexplored · always → head` | `senses.unexplored_exit` (tier 1) or hand-written DFS (tier 2) |
| `room_loot` / `room_buff → head` | auto-collected while traversing |
| `php_lt_30 / 50 → retreat / rest` | `if party.hp_pct < 30: return retreat()` |

---

## 5. Semantics that MUST match today

- **First match wins → first `return` wins.** Early-return order = priority order
  (the old top-to-bottom scan).
- **Filter-then-pick.** Today a predicate filters candidates, *then* the pick
  selects. In code:
  - `lowest_hp` / `highest_hp` picks → **pick then guard** is equivalent
    (`a = senses.allies.lowest_hp; if a and a.hp_pct < 50: …`).
  - `first`/`any` picks → need **filter then pick**:
    `senses.allies.where(a => a.hp_pct < 50).first` (or a comprehension). This is
    the one spot parity wants `.where`/comprehensions.
- **Dead rule** (e.g. `use(Skills.Mend, an_enemy)`): the action resolves to no
  effect but **consumes the turn** — same as today's "State held, no effect".
- **No rule matched:** function returns `None` / falls off the end / `wait()` ⇒
  engine **default = attack nearest enemy** (combat) / **no move** (exploration),
  exactly today's fallback.
- **No length cap.** The editor enforces no Protocol limit today; the function has
  no line cap. (A "capacity as progression" economy is a *non-parity* knob — see §8.)

---

## 6. Determinism & guard-rails

- **Pure**: namespace fully owned by the interpreter; only the seeded PRNG
  (`rng.ts`) is exposed if randomness is ever needed. No clock, no host access.
  Everything (`Memory`, libs) is serialisable text/data ⇒ save/resume unaffected,
  journal stays reproducible.
- **Fuel**: an instruction budget **per turn**; overrun ⇒ fall back to the default
  action + log (kills `while True`).
- **Runtime errors are per-turn recoverable**: default action + journal line; one
  bad turn never aborts the delve.
- **Deterministic ordering** (load-bearing for the seeded journal): `senses.exits`
  iterates in **corridor-array order**, and all collections are **insertion-ordered**.
  Any order the player iterates must be stable across replays, or seeded
  reproducibility silently breaks.

---

## 7. Sigils, and beyond parity

### Baseline (used by §4)
- **Opaque identity — `sigil`**: `room.sigil` and `enemy.sigil` are opaque,
  **delve-seeded gibberish** rendered as glyphs (`⟁ᚦᛟ·ᚷᚱ`); **equality/hash only**,
  no order/position/distance derivable. `print(room.sigil)` is unusable on purpose
  and changes every delve — so no hardcoding a literal, no cross-delve catalogue.
  `room.sigil` is what the §4 map is keyed on.

### Beyond parity (additive; NOT required to replace the editor)
- **Per-golem `Memory` + `on_meet(other)`**: each golem builds its own map; gossip
  merges memory only when co-located (write-your-own-`Memory`-only ⇒ deterministic).
  Parity uses one party-level `Memory`.
- **Split** the party into independent golems as an **unlock**; tethered-by-default
  falls out for free (always co-located = always synced). A lone golem can `flee`.
- **Bestiary gating**: `EnemyType.Slime` (species) and `Foe.HexWarden` (named boss)
  symbols **don't exist until encountered**; meta/per-profile, persist across delves
  — distinct from the delve-scoped `sigil`. A 3rd "studied" tier (Library/Insight)
  makes traits readable (`enemy.reflects(Skills.Mend)`) for *robust* counters.
- **Player libraries** via `import x` → `x.f()` (TFWR-style), itself an unlock;
  engine builtins stay injected, never imported.

---

## 8. Open knobs (non-parity)

- **Capacity as progression**: today no cap; a code language could meter
  instructions/lines or gate language features by unlock instead of slot count.
- **Editor tech — DECIDED (2026-06-16): CodeMirror 6, lazy-loaded.** It gives the
  editor *shell* (caret, scroll, undo, selection, mobile, a11y) + highlighting +
  autocomplete framework + lint squiggles; I write only the language-aware parts (a
  CM language mode from the lexer, a `CompletionSource` over the unlocked namespace, a
  `linter` from the parser). Scoped exception to "no runtime deps" — editor only,
  never touches the sim (CLAUDE.md updated). Bare `<textarea>` is fine for the slice-1
  interpreter POC only.
- **Combat vs exploration scope**: exploration is party-wide today; the §7 model
  makes it per-golem.
- `Foe` vs `Boss` naming for the named-enemy enum (no preference yet → `Foe`).

---

## 9. Interpreter & build slices

A **tree-walking interpreter** of a Python subset — no VM, no persistent program
counter (reactive, §0). The interpreter owns the whole namespace ⇒ determinism +
sandbox for free.

**Pipeline:** source → **lexer** (indentation → `INDENT`/`DEDENT` tokens) → **parser**
(recursive descent → AST) → **evaluator** (walk the AST against an environment). Each
turn: bind the ambient names (`me`, `Memory`, builtins, enums) + the param (`senses`)
in a fresh global env, call the brain function, read back the returned Action/Move.

**Values:** number, str, bool, `None`, list, set, dict, enum member, and *host
objects* (`senses`, `me`, units, exits, actions) whose attribute access dispatches to
a **whitelist** — the only bridge to the engine. No `eval`, no host escape.

**Fuel:** a counter bumped per evaluated node / loop iteration; over budget ⇒ throw
`FuelExceeded` ⇒ caught at the turn boundary ⇒ default action + journal line. Kills
`while True` and runaway recursion; the same catch handles any runtime error.

**Determinism:** the env exposes no clock / `random` / IO; only the seeded PRNG if ever
needed. `Memory` and libs are plain serialisable data ⇒ save/resume + journal stay
reproducible.

### Build order (tiny verified slices)
1. **Combat slice.** Lexer + parser for `{ assignment, if/elif/else, return,
   expr-stmt }`; expressions `{ literal, name, attribute, call, compare, and/or/not,
   arithmetic }`. Runtime: `me`, `senses.allies/enemies` (+ `.lowest_hp` / `.highest_hp`
   / `.first`), `attack` / `use` / `flee` / `wait`, `Skills`. **Done-when:** re-express
   the shipped combat Procedure *and* beat the Hex Warden by deleting the Mend line —
   same outcomes as the slot editor, pinned by tests + an in-app run.
2. **Exploration slice — tier 1.** Add `senses.exits` / `senses.room` /
   `senses.unexplored_exit`, `party`, `move` / `rest` / `retreat`, `RoomType`. No loops
   needed. **Done-when:** the tier-1 function clears a full delve.
3. **`Memory` & loops.** `for … in`, list/set/dict literals + indexing, `Memory`.
   Unlocks tier-2 DFS. **Done-when:** hand-written DFS clears a cyclic seed a tier-1
   convenience would loop on.
4. **Reuse & polish.** `def`, comprehensions (filter-then-pick), `while` (fuel),
   `import` (player libs) — each its own unlock.

Slices 1–2 build **additively as a POC** alongside the slot editor (no migration plan
needed yet). The migration/cutover below comes only when you commit to *replacing* it.

### Not in the slices above — and it's most of the work
Replacing the slot editor is mostly **non-language** work; called out so the roadmap
isn't anchored on "4 small slices ≈ done" (the editor alone is ~80% — as noted early):
- **Town editor rewrite (CodeMirror 6, lazy-loaded)** — VISION's *center of gravity*.
  Mount a CM editor in the Workshop modal, bound to `roster[activeHero].program`; the
  per-golem program selection, run/lock UX, and (later) the library/file management.
  I write a **CM language mode** (from the lexer), a **`CompletionSource`** (the
  unlocked namespace), and a **`linter`** (from the parser). Add the `@codemirror/*`
  dep, code-split so it loads only with the Workshop.
- **Save migration** — `ProtocolRow` localStorage → source text; **coexistence +
  cutover** with the shipped slot system (a stale save must never brick).
- **Error-reporting UX — ship EARLY (parity-relevant, not polish).** The slot editor
  has *zero* possible syntax errors; a code editor **regresses** the experience unless
  good syntax **and** runtime errors land with the **first CM editor slice**, via the
  CM `linter` (inline squiggles). `print` (a debug console pane) belongs here too —
  debugging is part of authoring, not an afterthought.

The slice-1 interpreter POC can input the program through a bare `<textarea>`; the CM
editor lands as its own (early) slice, bringing highlighting + autocomplete + errors
together.
