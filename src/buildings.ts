// Pure town-scene clickable-zone layout + hit-testing over the foyer backdrop.
// The SAME rectangles feed the renderer (to draw the hover highlight) and the
// click handler (to hit-test a click), so the lit zone and its clickable area can
// never drift apart. Zones are fractions of the foyer image, transformed through
// the same cover-fit layout the renderer draws with — so they stay aligned at any
// canvas size, even where cover-fit crops.

export type BuildingId = 'workshop' | 'library'

export interface BuildingRect {
  id: BuildingId
  label: string
  x: number
  y: number
  w: number
  h: number
}

// The foyer backdrop is square (town-foyer.png is 1024×1024).
const FOYER = 1024

// Clickable openings as fractions of the foyer image (tuned on the artwork —
// left archway = Workshop, right archway = Library). The central staircase is
// intentionally un-zoned for now.
const ZONES: ReadonlyArray<{ id: BuildingId; label: string; fx: number; fy: number; fw: number; fh: number }> = [
  { id: 'workshop', label: 'The Workshop', fx: 0.03, fy: 0.34, fw: 0.27, fh: 0.50 },
  { id: 'library', label: 'The Library', fx: 0.70, fy: 0.34, fw: 0.27, fh: 0.50 },
]

export interface FoyerLayout {
  ix: number
  iy: number
  iw: number
  ih: number
}

/** Contain-fit the square foyer into the canvas (whole image visible — keeps the
 *  signage & floor — with dark side bars on wide screens). The renderer draws the
 *  image at this rect AND the zones derive from it, so the two can never drift. */
export function foyerLayout(width: number, height: number): FoyerLayout {
  const scale = Math.min(width / FOYER, height / FOYER)
  const iw = FOYER * scale
  const ih = FOYER * scale
  return { ix: (width - iw) / 2, iy: (height - ih) / 2, iw, ih }
}

/** Clickable-zone rectangles in canvas (CSS-px) space for the current size. */
export function buildingRects(width: number, height: number): BuildingRect[] {
  const { ix, iy, iw, ih } = foyerLayout(width, height)
  return ZONES.map((z) => ({
    id: z.id,
    label: z.label,
    x: Math.round(ix + z.fx * iw),
    y: Math.round(iy + z.fy * ih),
    w: Math.round(z.fw * iw),
    h: Math.round(z.fh * ih),
  }))
}

/** Which clickable zone (if any) sits under a canvas-space point. */
export function buildingAt(px: number, py: number, width: number, height: number): BuildingId | null {
  for (const r of buildingRects(width, height)) {
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r.id
  }
  return null
}
