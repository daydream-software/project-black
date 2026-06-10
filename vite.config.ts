import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative base so the production build works on GitHub Pages regardless of
  // the repo name (project pages serve from /<repo>/, not /).
  base: './',
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
  test: {
    environment: 'node',
  },
})
