# Project Black

A web game where you don't steer your adventurers — you're an **Artificer** who
builds **Golems** and **inscribes their brains** with the code they run, both how
they **fight** and how they **delve**. Then you send the party into a seeded
procedural dungeon and **watch** it crawl on its own: navigate, fight the packs it
meets, grab loot, hunt the target. It returns victorious or it wipes; you read the
**journal**, revise the code, and send a smarter party back down. A
**programmable, idle-but-watched, procedural dungeon-crawler roguelite**, designed
to run as a static site on GitHub Pages.

> Pillars: programming **is** the gameplay (two brains, one language) · intense ↔
> relaxed rhythm · automation you watch, not idle-farming (**no offline progress**)
> · the language grows (the meta-progression) · static & tiny.

## Stack

TypeScript · Vite · Canvas 2D · Vitest. No runtime dependencies **except the
Workshop code editor** (CodeMirror 6, lazy-loaded — the authoring surface only,
never the pure sim); sprites are generated in code (no asset files to break).

## Develop

```bash
npm install
npm run dev      # dev server — open http://127.0.0.1.nip.io:5173 (binds 0.0.0.0, allows .nip.io)
npm test         # Vitest — unit tests on the pure simulation
npm run build    # typecheck (tsc) + production build into dist/
npm run preview  # serve the production build locally
```

## How it works

A **deterministic, pure** simulation — the encounter (`src/sim.ts`), the delve
(`src/delve.ts`), and seeded dungeon generation (`src/mapgraph.ts`) — is decoupled
from a **pure view** that renders state to a canvas (`src/render.ts`). You author
each Golem's brain in the **Inscription Language** (a small Python-subset
interpreter, `src/lang/`); it drives a per-turn `decide()` policy, and the
**journal** shows *why* the party acted each step. The language starts minimal and
**grows as you spend Insight** (the rule grammar it expresses is in
[docs/VOCABULARY.md](docs/VOCABULARY.md)). See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/INSCRIPTION-LANG.md](docs/INSCRIPTION-LANG.md).

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Progress screenshots live in
[docs/progress/](docs/progress/).

## Deploy

The build uses a relative `base` so it works on GitHub Pages from any repo path.
Once pushed to GitHub with Pages enabled, `.github/workflows/deploy.yml` publishes
`dist/` automatically.

---

**Conventions:** commits follow [Conventional Commits](CONTRIBUTING.md) (and feed
the in-game changelog). The codebase, docs, commits and issues are written in
**English**. (Day-to-day development conversation may happen in another language.)
