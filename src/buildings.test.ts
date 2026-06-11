import { describe, it, expect } from 'vitest'
import { buildingAt, buildingRects } from './buildings'

describe('buildings', () => {
  it('hit-tests the centre of every building rect to its own id', () => {
    const W = 960
    const H = 540
    for (const r of buildingRects(W, H)) {
      expect(buildingAt(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2), W, H)).toBe(r.id)
    }
  })

  it('returns null outside any building (the four corners are clear)', () => {
    const W = 960
    const H = 540
    expect(buildingAt(0, 0, W, H)).toBeNull()
    expect(buildingAt(W - 1, 0, W, H)).toBeNull()
    expect(buildingAt(0, H - 1, W, H)).toBeNull()
    expect(buildingAt(W - 1, H - 1, W, H)).toBeNull()
  })

  it('lays the workshop out left of the library, without overlap', () => {
    const [a, b] = buildingRects(960, 540)
    expect(a.id).toBe('workshop')
    expect(b.id).toBe('library')
    expect(a.x + a.w).toBeLessThan(b.x) // a gap between them
  })

  it('scales rects proportionally with canvas size', () => {
    const small = buildingRects(960, 540)
    const big = buildingRects(1920, 1080)
    expect(big[0].w).toBeGreaterThan(small[0].w)
    // the centre of the small library is the library at double the resolution too
    const s = small[1]
    expect(buildingAt((s.x + s.w / 2) * 2, (s.y + s.h / 2) * 2, 1920, 1080)).toBe('library')
  })

  it('a point just outside a rect edge is not a hit (boundary)', () => {
    const [a] = buildingRects(960, 540)
    expect(buildingAt(a.x - 1, a.y + 10, 960, 540)).toBeNull()
    expect(buildingAt(a.x + 10, a.y - 1, 960, 540)).toBeNull()
  })
})
