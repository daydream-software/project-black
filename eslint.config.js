// Flat ESLint config built on eslint-config-love (strict TypeScript rules) to keep
// the codebase clean as it grows. We KEEP every bug-catching / type-safety rule
// (and fix the code to satisfy it). The only rules turned off are pure-style or
// genuinely ill-suited to a tiny, dependency-free Canvas game — each justified
// below, not a "fix it later" dodge. Run with `npm run lint`.
import love from 'eslint-config-love'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.d.ts'] },
  {
    ...love,
    files: ['src/**/*.ts'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // --- Off: deliberate, idiomatic for this codebase (not deferred fixes) ---
      'no-bitwise': 'off', //                a pixel/canvas game does real bit math
      '@typescript-eslint/no-magic-numbers': 'off', //  layout/draw constants are inline by design
      'no-plusplus': 'off', //               `i++` / `count++` is clear and used throughout
      '@typescript-eslint/prefer-destructuring': 'off', // `arr[0]` reads clearer than forced destructuring in math/render
      'no-negated-condition': 'off', //      `if (!x)` is often the clearer ordering
      '@typescript-eslint/init-declarations': 'off', // deferred-init (`let x: T` then assign in branches) is a valid pattern
      'no-void': 'off', //                   `void promise` deliberately marks fire-and-forget (pairs with no-floating-promises)
      'no-param-reassign': 'off', //         the sim mutates CLONED units passed as params, by design
      complexity: 'off', //                  game hot-paths (sim step, renderers, sprite gen) are branchy by nature; tests + structure guard them, not a cyclomatic cap
      'max-lines': 'off', //                 file length isn't a quality signal here; addressed structurally (splitting main.ts)
      'no-console': ['error', { allow: ['warn', 'error'] }], // warn/error are legit in a browser app

      // --- Configured: keep the value, fit the game ---
      'require-unicode-regexp': ['error', { requireFlag: 'u' }], // `v` needs es2024 target; `u` gives the same unicode-correctness
      '@typescript-eslint/max-params': ['error', { max: 8 }], // canvas draw fns take many positional coords
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
    },
  },
  {
    // Tests may use non-null assertions and looser typing for fixtures.
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off', // test fixtures/helpers don't need explicit returns
    },
  },
]
