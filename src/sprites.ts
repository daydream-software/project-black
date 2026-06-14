// Pixel-art sprites, generated at runtime from code/data — no asset files to
// load (and therefore none to break). Each sprite is a 16x16 canvas drawn at
// native resolution; the renderer scales it up with smoothing disabled.

import { require2dContext } from './dom'

type Palette = Record<string, string>

/** Build a 16x16 sprite canvas from a char grid + palette. '.' = transparent. */
function spriteFromGrid(rows: string[], palette: Palette): HTMLCanvasElement {
  const h = rows.length
  const w = rows[0].length
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = require2dContext(c)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = palette[rows[y][x]]
      if (col !== '') {
        ctx.fillStyle = col
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }
  return c
}

/** The slime enemy — generated procedurally (same shape as our art sample). */
export function makeSlime(): HTMLCanvasElement {
  const W = 16
  const H = 16
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = require2dContext(c)

  const cx = 7.5
  const cy = 9.0
  const ry = 5.2
  const inside = (x: number, y: number): boolean => {
    if (y < 4 || y > 14) return false
    const rx = 6.2 * (1 + 0.12 * ((y - 4) / 10))
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
  }

  const ins: boolean[][] = []
  for (let y = 0; y < H; y++) {
    ins[y] = []
    for (let x = 0; x < W; x++) ins[y][x] = inside(x, y)
  }

  const OUT = '#14281c'
  const DARK = '#2e7a44'
  const MID = '#4ab460'
  const LIGHT = '#78e080'
  const HI = '#cdf8d2'
  const WHITE = '#ffffff'
  const PUP = '#14281c'
  const px = (x: number, y: number, col: string): void => {
    ctx.fillStyle = col
    ctx.fillRect(x, y, 1, 1)
  }

  const neighbours: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!ins[y][x]) continue
      let edge = false
      for (const [dx, dy] of neighbours) {
        if (!ins[y + dy]?.[x + dx]) edge = true
      }
      if (edge) px(x, y, OUT)
      else if (y >= 11) px(x, y, DARK)
      else if (y <= 7) px(x, y, LIGHT)
      else px(x, y, MID)
    }
  }
  // specular highlight
  for (const [x, y] of [[4, 6], [5, 6], [4, 7]] as const) {
    if (ins[y][x]) px(x, y, HI)
  }
  // eyes (2x3 white blocks) + inward-looking pupils
  for (const ex of [5, 10]) {
    for (const dx of [0, 1]) {
      for (const dy of [-1, 0, 1]) {
        const x = ex + dx
        const y = 9 + dy
        if (ins[y]?.[x]) px(x, y, WHITE)
      }
    }
  }
  px(6, 9, PUP)
  px(10, 9, PUP)
  // little mouth
  px(7, 12, OUT)
  px(8, 12, OUT)

  return c
}

/** The adventurer — a small front-facing figure (placeholder art). */
export function makeHero(): HTMLCanvasElement {
  const rows = [
    '................',
    '......KKKK......',
    '.....KHHHHK.....',
    '.....KHSSHK.....',
    '.....KESSEK.....',
    '.....KSSSSK.....',
    '......KSSK......',
    '.....KTTTTK.....',
    '....KTTTTTTK....',
    '...KSTTTTTTSK...',
    '...KSTTTTTTSK...',
    '....KTTTTTTK....',
    '.....KTTTTK.....',
    '.....KP..PK.....',
    '.....KP..PK.....',
    '.....KK..KK.....',
  ]
  const palette: Palette = {
    K: '#202028', // outline
    E: '#202028', // eyes
    S: '#f0c39b', // skin
    H: '#8a5a32', // hair
    T: '#3f7bd6', // tunic
    P: '#5a3a22', // boots
  }
  return spriteFromGrid(rows, palette)
}

/** The adventurer seen from BEHIND (for the over-the-shoulder delve view): all
 *  hair on the head, no face, and a backpack on the back. */
export function makeHeroBack(): HTMLCanvasElement {
  const rows = [
    '................',
    '......KKKK......',
    '.....KHHHHK.....',
    '.....KHHHHK.....', // back of head — all hair, no face
    '.....KHHHHK.....',
    '.....KHHHHK.....',
    '......KHHK......',
    '.....KTTTTK.....',
    '....KTBBBBTK....', // backpack straps + pack (B)
    '...KSTBBBBTSK...',
    '...KSTBBBBTSK...',
    '....KTBBBBTK....',
    '.....KTTTTK.....',
    '.....KP..PK.....',
    '.....KP..PK.....',
    '.....KK..KK.....',
  ]
  const palette: Palette = {
    K: '#202028', // outline
    S: '#3168b0', // arms (tunic-coloured, darker)
    H: '#6f4827', // hair (back of head, a touch darker)
    T: '#3f7bd6', // tunic
    B: '#7a5a2e', // backpack
    P: '#5a3a22', // boots
  }
  return spriteFromGrid(rows, palette)
}
