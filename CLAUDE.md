# CLAUDE.md

Guidance for working in this repo. Keep it short — details live in `docs/`.

## What this is

A web game where you don't control adventurers — you **program** them with a
**Procedure** (an ordered list of **Protocols**, each `WHEN <State> → <Maneuver>`)
and watch them fight autonomously (AFK / idle). Static site for GitHub Pages.
See `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/VOCABULARY.md`.

## Stack & commands

TypeScript · Vite · Canvas 2D · Vitest. No runtime dependencies; sprites are
generated in code.

- `npm run dev` — dev server; open **http://127.0.0.1.nip.io:5173** (Vite binds `0.0.0.0` and allows `.nip.io` hosts, so it's reachable from the Windows browser over WSL — plain `localhost` forwarding is flaky)
- `npm test` — Vitest (unit tests on the pure simulation)
- `npm run build` — typecheck (`tsc`) + production build into `dist/`
- `npm run preview` — serve the production build

## Conventions (non-negotiable)

- **English** in every project artifact: code, comments, UI strings, docs, commit
  messages, issues. (Conversation may be in French; the repo is English.)
- **Conventional Commits** — `type(scope): subject`, imperative lower-case. See
  `CONTRIBUTING.md`. `feat` / `fix` / `perf` are player-facing and feed the
  (planned) in-game "What's New" changelog.
- **Vocabulary:** the rule system is **Procedure / Protocol / State / Maneuver**
  (inspired by FF12 gambits, but never called "gambit"). `State` = `Subject` +
  `Predicate`, and **the State's subject is the target**. `Maneuver` = `Use Skill`
  / `Use Item` + which one (no separate target picker).
- **No `innerHTML`** for anything a player can author — escape it, or build via DOM
  APIs (the rule editor does).
- **GitHub Pages:** keep `base: './'` so asset paths stay relative.

## How we work

- Build in **tiny verified slices**; attack the riskiest unknown first.
- **Prove changes by running the app** (browser screenshot), not by green tests
  alone. Tests must fail when logic breaks — cover boundaries, and mutation-check
  (flip the logic, see red, restore).
- Keep game logic in `src/sim.ts` as **pure, deterministic** functions; the
  renderer (`src/render.ts`) is a pure view. This keeps tests honest and makes AFK
  offline catch-up cheap (replay `step` N times). Use a **seeded** PRNG when
  randomness/dice arrive.
