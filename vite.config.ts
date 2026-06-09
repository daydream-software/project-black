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
  },
  test: {
    environment: 'node',
  },
})
