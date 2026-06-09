# CLAUDE.md

Guidance for working in this repo. Keep it short — details live in `docs/`.

## What this is

A web game where you don't steer adventurers — you **program** their brains, both
how they **fight** (a combat **Procedure**) and how they **delve** (an exploration
**Protocol**), in one `WHEN <State> → DO <X>` grammar. It's a **programmable, AFK,
procedural dungeon-crawler roguelite** (Nevergrind Online's pacing × Gladiabots'
AI-authoring × FF12 gambits): from **town** you program + manage, then **descend**;
the party **auto-delves** a seeded dungeon (navigate, fight packs, loot, hunt the
target); a wipe sends you back to 0 (meta persists); you iterate from the
**journal**. Static site for GitHub Pages.
See **`docs/VISION.md`** (north star — what & why), then `docs/ROADMAP.md`
(build order), `docs/ARCHITECTURE.md`, `docs/VOCABULARY.md`.

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
- **GitHub Pages:** keep `base: './'` so asset paths stay relative. **Live at
  https://daydream-software.github.io/project-black/** — `deploy.yml` builds and
  pushes `dist/` to the **`gh-pages` branch** (the org enforces SHA-pinned
  actions, which breaks the standard Pages-Actions pipeline; actions are pinned
  to SHAs). Pushes to `main` auto-deploy.

## How we work

- Build in **tiny verified slices**; attack the riskiest unknown first.
- **Prove changes by running the app** (browser screenshot), not by green tests
  alone. Tests must fail when logic breaks — cover boundaries, and mutation-check
  (flip the logic, see red, restore).
- Keep game logic in `src/sim.ts` as **pure, deterministic** functions; the
  renderer (`src/render.ts`) is a pure view. This keeps tests honest and makes AFK
  offline catch-up cheap (replay `step` N times). Use a **seeded** PRNG when
  randomness/dice arrive.
