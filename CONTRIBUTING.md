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

> **Status: the in-game consumer SHIPPED; the generator is still by hand.** The game
> reads **`src/changelog.json`** and shows a **"What's New"** panel after an update (it
> compares the build version `__APP_VERSION__` to the player's last-seen version in
> `localStorage`). What's *not* automated yet: producing `changelog.json` (and a dev
> `CHANGELOG.md`) from the commit history — for now the JSON is **hand-authored**. We
> still write Conventional Commits so that generator can land later (a `feat`/`fix`/`perf`
> subject is the patch note the player reads — write it for them).

The version history feeds two artifacts:

- **`CHANGELOG.md`** — full, developer-facing (all types). *(planned — not yet generated)*
- **`src/changelog.json`** — player-facing only (`feat`, `fix`, `perf`), grouped
  as *New / Fixes / Improvements*, per version. *(shipped — currently hand-authored)*

The generator is decoupled from the game: whatever produces `changelog.json`
(a script, git-cliff, …), the game just consumes that fixed schema. Deferring it is
deliberate — without per-release git tags, bucketing commits into version blocks is
ambiguous, so the consumer (the valuable half) shipped first.
