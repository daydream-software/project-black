import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// The build version, single-sourced from package.json and injected as a compile-time
// constant (`__APP_VERSION__`). The in-game "What's New" panel compares it to the
// player's last-seen version (changelog.ts) to decide whether to surface patch notes.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

export default defineConfig({
  // Relative base so the production build works on GitHub Pages regardless of
  // the repo name (project pages serve from /<repo>/, not /).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // Bind all interfaces so the WSL dev server is reachable from the Windows
    // browser (plain localhost forwarding is flaky in WSL2).
    host: true,
    // Accept <ip>.nip.io hostnames (nip.io resolves <ip>.nip.io -> <ip>), e.g.
    // http://127.0.0.1.nip.io:5173 or http://<wsl-ip>.nip.io:5173 — same nip.io
    // convention the rest of the workspace uses for dev hosts.
    allowedHosts: ['.nip.io'],
    watch: {
      // Don't let agent/QA artefacts reload the page under test: Playwright writes
      // a file into .playwright-mcp/ on every navigation and screenshot, which the
      // dev-server watcher would otherwise treat as a change and full-reload the
      // running app — making an open dropdown look like it spontaneously reopened.
      ignored: ['**/.playwright-mcp/**'],
    },
  },
  // `vite preview` serves the production build with no HMR/WebSocket — a stable
  // target for hands-on testing. Mirror the dev server's WSL/nip.io reachability.
  preview: {
    host: true,
    allowedHosts: ['.nip.io'],
  },
  test: {
    environment: 'node',
  },
})
