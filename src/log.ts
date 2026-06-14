// The single sanctioned logging seam: nothing else in the codebase calls
// `console.*` directly (enforced by eslint's no-console). Routing through here
// means the sink is swappable in ONE place — silence it, level-filter it, or
// later pipe it into an in-game debug panel — without touching call sites.

/* eslint-disable no-console -- this module IS the one place console is allowed */
export const log = {
  warn(...args: unknown[]): void {
    console.warn(...args)
  },
  error(...args: unknown[]): void {
    console.error(...args)
  },
}
/* eslint-enable no-console */
