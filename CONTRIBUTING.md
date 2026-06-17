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

## Why it matters: the changelog feeds the game

The game reads **`src/changelog.json`** and shows a **"What's New"** panel after an
update (it compares the build version `__APP_VERSION__` to the player's last-seen
version in `localStorage`). Two artifacts come from the commit history:

- **`src/changelog.json`** — player-facing only (`feat`→*New*, `fix`→*Fixes*,
  `perf`→*Improvements*), per version. The schema the game consumes.
- **`CHANGELOG.md`** — full, developer-facing (all types). Generated; do not hand-edit.

The generator is decoupled from the game — it just writes that fixed schema.

### Cutting a release (`npm run changelog`)

Releases are marked by **git tags `vX.Y.Z`**; the generator buckets commits by the
range between tags. To publish patch notes:

1. Land your work as **Conventional Commits** — a `feat:`/`fix:`/`perf:` *subject* is
   the patch note the player reads, so write it for them.
2. **Bump `package.json` `version`** and **tag the same version**: `git tag vX.Y.Z`.
   (They must match — `npm run changelog` **fails loudly** on a mismatch, because a
   mismatch reopens the in-game panel forever. It validates; it never bumps for you.)
3. Run **`npm run changelog`** — it regenerates `src/changelog.json` + `CHANGELOG.md`
   from the tags. It prints how many commits it **skipped** (everything that isn't
   `feat`/`fix`/`perf` is dev-only — `docs`, `refactor`, `chore`, … — so a player-facing
   change must use one of those three types; e.g. balance tweaks → `fix:`/`perf:`).
4. **Polish** the generated block in `changelog.json` if a subject reads too dev-y
   (optionally add a `title`), then commit `changelog.json` + `CHANGELOG.md` + the bump.

**Hand-authored blocks are frozen:** a version already in `changelog.json` is never
overwritten by the generator (so the curated `0.1.0` block stays). To regenerate one,
delete its block first. Push tags separately — they're a publish action.
