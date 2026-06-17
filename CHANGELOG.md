# Changelog

> Generated from Conventional Commits by `npm run changelog`. Do not edit by hand.

## v0.1.1 — 2026-06-17

### Features
- **workshop:** in-app input modal for engram naming + gate lint in the build
- **changelog:** generate changelog.json + CHANGELOG.md from git (npm run changelog)
- **journal:** the journal is record()-only — the engrams' voice
- **changelog:** in-game "What's New" panel on version change

### Docs
- the journal is record()-only (the golems' voice)
- reflect record() + the shipped What's New consumer

### Tests
- **lang:** cover the combat record() → journal path

### Chores
- **lint:** main.ts refactors (no-loop-func, complexity, index gaps)
- **lint:** clean editor.ts + editor-cm.ts (CM tokenizer/completion)
- **lint:** clean test files + save.ts (u-flags, opt-field predicates)
- **lint:** clean parser.ts (decompose statement/atom, fix strict-boolean)
- **lint:** clean delve / changelog-gen / lexer (decompose by grouping)
- **lint:** clean explore.ts + interp.ts jsonToValue (unknown-accepting, no cast)
- **lint:** clean interp/gate/combat/migrate/check/changelog (fix, not disable)
- **lint:** begin the cleanup — safe auto-fixes + interp.ts/gate.ts hand-fixes

## v0.1.0 — 2026-06-17

### Features
- **lang:** record(...) writes a golem's debug lines to the delve journal
- **progression:** gate the language by Insight + a beatable lvl-1 boss
- **workshop:** named engrams — author in the Library, load onto golems
- **lang:** entry blocks `Engram.combat_turn:` (frees `def` for gating)
- **lang:** author golem brains in code, retiring the slot editor
- **render:** fixed-size minimap centred on the current room
- **dungeon:** feed-routing — a known distant room is a goal the party explores toward
- **dungeon:** hidden rooms H2/H3 — Secret Sight buff + render unify
- **dungeon:** hidden rooms H1 — secret rooms the crawler never finds
- **delve:** slice 4 — buff rooms grant run-scoped boons (standalone content)
- **dungeon:** slice 5 — corridor traps (owned by the map, fired on traversal)
- **dungeon:** slice 3 — route by room type (the 1-hop peek made programmable)
- **dungeon:** slice 2 — the cutover, delve runs on the room graph (grid retired)
- **dungeon:** slice 1 — seeded room-graph generation from an authored skeleton
- **town:** monotonic point-buy — empty start, freeze spent points on descend
- **town:** point-buy core editor — author each golem's six stats
- **combat:** six-stat combat system — Strain budget + CTB scheduler
- **ui:** title & slot-picker wear the Artificer's-tower key art
- **ui:** town hub as the Artificer's tower foyer with clickable rooms
- **ui:** Artificer & Golems text reskin, no dev jargon (slice U4, text)
- **ui:** clickable buildings in the town scene (slice U3)
- **ui:** buildings as modals + floating journal (slice U2)
- **ui:** full-bleed responsive world + floating UI overlay (slice U1)
- **audio:** combat sound effects — stone-golem clips per action
- delves resume in real time — no offline progress
- the Trainer station — spend Insight to learn vocabulary (slice 10b-3)
- unlockable vocabulary + editor gating (slice 10b-2)
- Insight earned on a level's first clear + counter (slice 10b-1)
- Town level select + descend the chosen level (slice 10a-3)
- levels + first-clear tracking (slice 10a-2)
- config-driven dungeon generation (slice 10a-1)
- **ui:** restyle the town/editor screen + custom dropdown
- title screen + save slots + screen shell (slice 9b)
- save slots foundation (slice 9a)
- exploration-Protocol editor in Town (slice 8c)
- first-person "scrying" view — perspective corridor, party from behind
- wire the delve + first-person scrying view (slice 8b)
- delve state machine (slice 8a-2)
- seeded dungeon generation (slice 8a-1)
- seeded PRNG foundation (slice 7)
- save + offline catch-up (slice 5)
- in-game music director — three state-driven themes
- run-loop POC — the roguelite spine (camp → run → back to 0)
- first wall — Hex Warden counters healing (slice 4)
- composite rules + multi-unit party (slice 3)

### Fixes
- **town:** drop the HP readout from the Fortitude point-buy row
- **render:** fog the minimap — reveal only discovered rooms + corridors
- **render:** minimap ✓ means CLEARED, not entered; make corridors visible
- **sim:** id-dispatch model so a saved in-progress delve resumes (no function loss)
- **town:** refresh the Descend button when the roster gains/loses its first golem
- **ui:** make Descend a prominent primary action (U1 polish)
- **ui:** keep the title/slots screens from leaking below the active one
- **dev:** exclude .playwright-mcp from the dev-server watch

### Refactors
- **content:** sounds are standalone content files, not ids in sfx.ts
- **content:** content-owned SFX — skills/commands declare their sound
- **content:** externalize the exploration vocabulary logic
- **content:** monsters own their intelligence — Procedure + reactions, not a stat
- **content:** generic event bus for reactions (action/damage/heal)
- **content:** externalize the rule-engine logic into content (Full hooks)
- **content:** exclude colocated *.test.ts from category globs
- **content:** skill effects as one-file-per-item handlers (Tier 2)
- **content:** monster bestiary as one-file-per-item data
- **content:** registry + Tier-1 vocab as one-file-per-item via import.meta.glob
- point-buy party data model + satisfy ESLint complexity
- save resilience, defensive rule compilation, procedure/protocol naming, hidpi (#1)
- conformance pass — Protocol/Procedure lexicon, no type assertions

### Docs
- sync all markdown to the inscription-language + room-graph reality
- **lang:** note engrams + progression + the Engram.X: entry rename
- **roadmap:** record the combat redesign + modular content + dungeon-graph rework
- **dungeon:** design the room-graph delve (Nevergrind-like rework)
- **architecture:** document src/content/ modular-content layer
- player-authored party (point-buy), compact scale, Might, siege wipe
- pin combat cadence — CTB turn scheduler + contemplative tempos
- define the six-stat combat system + hexagon
- decide the setting (Artificer & Golems) + no offline progress
- record slice 10b done — the language-grows loop is complete
- record 10b shape — Town as a village hub, Trainer first
- record slice 10a done (config-driven levels + first-clear tracking)
- slice 10 — dungeons become re-playable config-driven levels
- record slice 10 design direction (loot & economy)
- record slice 9 done; slice 10 (loot + town economy) next
- record slice 8c done; slice 9 (the shell) next
- record slice 8a (delve sim) done; 8b (first-person view) next
- pivot the vision to a programmable AFK dungeon-crawler roguelite
- mark slice 6 done — game live on GitHub Pages
- lock the game vision — programmable AFK auto-battler roguelite
- add conformance-pass screenshot
- add CLAUDE.md with project conventions and pointers
- defer changelog tooling; note auto + Patch-notes triggers
- adopt Conventional Commits and plan in-game changelog
- lock rule vocabulary (Procedure/Protocol, State/Maneuver)

### CI
- deploy to gh-pages branch via git (org bans nested unpinned actions)
- pin Pages workflow actions to commit SHAs (org policy)

### Chores
- **lint:** satisfy the strict ESLint rules (scoped exceptions, logger)
- add ESLint (eslint-config-love) and satisfy its rules
- gitignore .claude/settings.local.json (per-user, keep local)
- expose Vite dev server via nip.io host
- set initial version to 0.1.0

### Balance
- **combat:** end the lvl-1 Celerity softlock (small golem floor + slower lvl-1 foes)
- **combat:** raise HP per Fortitude from 4 to 5
- **combat:** compact monster scale for the 24-point budget

### Other
- Initial commit: gambit-driven AFK game (slices 1-2)
