# Contributing

## Commit messages — Conventional Commits

Every commit follows [Conventional Commits](https://www.conventionalcommits.org/):

```
type(optional scope): subject
```

| Type | Meaning | Player-facing? |
|---|---|---|
| `feat` | a new capability | ✅ shown in-game · bumps **minor** |
| `fix` | a bug fix | ✅ shown in-game · bumps **patch** |
| `perf` | a performance improvement | ✅ shown in-game |
| `refactor` | code change, no behaviour change | — |
| `docs` | documentation only | — |
| `test` | tests only | — |
| `build` | build system / dependencies | — |
| `ci` | CI configuration | — |
| `chore` | maintenance, version bumps | — |
| `style` | formatting only | — |

- **Breaking change:** add `!` after the type (`feat!:`) or a `BREAKING CHANGE:`
  footer → bumps **major**.
- **Subject:** imperative mood, lower-case, no trailing period.

Examples:

```
feat(editor): add Subject + Predicate dropdowns
fix(sim): treat exactly 30% HP as not below 30%
refactor(sim): composite State/Maneuver model
```

## Why it matters: the changelog will feed the game

> **Status: planned, not built.** Neither `CHANGELOG.md` nor `src/changelog.json`
> exists yet, and there is no in-game "What's New" panel. We adopt Conventional
> Commits *now* so the history is ready to generate it later (a `feat`/`fix`/`perf`
> subject is a future patch note — write it for the player). The plan:

The version history will be generated from these commit messages:

- **`CHANGELOG.md`** — full, developer-facing (all types).
- **`src/changelog.json`** — player-facing only (`feat`, `fix`, `perf`), grouped
  as *New / Fixes / Improvements*, per version.

The game will show a **"What's New"** panel after an update: on load it compares the
build version to the player's last-seen version (stored in `localStorage`) and
lists the new player-facing entries. **So a clear `feat:` / `fix:` subject is
literally the patch note the player reads** — write it for them.

The generator is decoupled from the game: whatever produces `changelog.json`
(a script, git-cliff, …), the game just consumes that fixed schema.
