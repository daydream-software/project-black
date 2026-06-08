import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative base so the production build works on GitHub Pages regardless of
  // the repo name (project pages serve from /<repo>/, not /).
  base: './',
  test: {
    environment: 'node',
  },
})
