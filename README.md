# Project Black

A web game where you don't control your adventurers — you **program** them with a
**Procedure**: an ordered list of **Protocols**, each `WHEN <State> → <Maneuver>`
(inspired by FF12's gambit system). Then you watch them fight, and keep progressing
while you're away. Designed to run as a static site on GitHub Pages.

> Pillars: automation **is** the combat · intense ↔ relaxed rhythm · AFK delivers
> the reward but improving your program is what unlocks progress · grows over time.

## Stack

TypeScript · Vite · Canvas 2D · Vitest. No runtime dependencies; pixel-art
sprites are generated in code (no asset files to break).

## Develop

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm test         # Vitest — unit tests on the pure simulation
npm run build    # typecheck (tsc) + production build into dist/
npm run preview  # serve the production build locally
```

## How it works

A **deterministic, pure** simulation (`src/sim.ts`) is decoupled from a **pure
view** that renders state to a canvas (`src/render.ts`). The player's Protocols
drive a `decide()` function; an on-screen decision log shows *why* the adventurer
acted. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Progress screenshots live in
[docs/progress/](docs/progress/).

## Deploy

The build uses a relative `base` so it works on GitHub Pages from any repo path.
Once pushed to GitHub with Pages enabled, `.github/workflows/deploy.yml` publishes
`dist/` automatically.

---

**Language convention:** the codebase, docs, commits and issues are written in
**English**. (Day-to-day development conversation may happen in another language.)
