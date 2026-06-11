// Pure town-scene building layout + hit-testing. The SAME rectangles feed the
// renderer (to draw the buildings) and the click handler (to hit-test a click),
// so the drawn building and its clickable area can never drift apart.

export type BuildingId = 'workshop' | 'library'

export interface BuildingRect {
  id: BuildingId
  label: string
  x: number
  y: number
  w: number
  h: number
}

const DEFS: ReadonlyArray<{ id: BuildingId; label: string; cx: number }> = [
  { id: 'workshop', label: 'The Workshop', cx: 0.34 },
  { id: 'library', label: 'The Library', cx: 0.66 },
]

/** Building rectangles for a town scene of the given canvas size — proportional,
 *  so they scale with any window (the responsive viewport). */
export function buildingRects(width: number, height: number): BuildingRect[] {
  const w = Math.round(width * 0.16)
  const h = Math.round(height * 0.26)
  const y = Math.round(height * 0.32)
  return DEFS.map((d) => ({ id: d.id, label: d.label, x: Math.round(width * d.cx - w / 2), y, w, h }))
}

/** Which building (if any) sits under a canvas-space point. */
export function buildingAt(px: number, py: number, width: number, height: number): BuildingId | null {
  for (const r of buildingRects(width, height)) {
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r.id
  }
  return null
}
