// Small DOM helpers that narrow types via runtime checks — no `!` or `as`.

/** Get an element by id, verifying (via instanceof) it is the expected type. */
export function requireElement<T>(id: string, ctor: new (...args: never[]) => T): T {
  const el = document.getElementById(id)
  if (el instanceof ctor) return el
  throw new Error(`Element #${id} is missing or has an unexpected type`)
}

/** Get a 2D rendering context for a canvas, throwing if unavailable. */
export function require2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2D canvas context unavailable')
  return ctx
}
