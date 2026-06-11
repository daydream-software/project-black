// Pure view layer: draws the current GameState onto the canvas. It reads state,
// it never mutates it. All game logic lives in sim.ts.
//
// The canvas buffer is sized to the window (responsive viewport — see main.ts),
// so every size/position here is derived from `ctx.canvas.width/height` rather
// than a fixed magic number: the scene fills any window without bars, crop or
// distortion. Coordinates are CSS pixels (the buffer is the CSS size), so the
// HUD safe-zone below is a fixed pixel offset matching the floating DOM HUD.

import type { Combatant, GameState } from './sim'
import { DX, DY, roomAt, type Dir } from './dungeon'
import type { DelveState } from './delve'
import { buildingRects, type BuildingId, type BuildingRect } from './buildings'

const HUD_SAFE = 72 // px reserved at the top for the floating HUD bar (DOM)

// Sprite block scale derived from canvas height, so units keep their on-screen
// proportion at any window size (integer keeps the pixel art crisp).
function unitScale(height: number): number {
  return Math.max(4, Math.round(height / 68))
}
function bossOf(scale: number): number {
  return Math.round(scale * 1.75) // a boss reads bigger than the rank-and-file
}

interface Sprites {
  hero: HTMLCanvasElement
  heroBack: HTMLCanvasElement
  slime: HTMLCanvasElement
}

interface HpBar {
  x: number
  y: number
  w: number
  frac: number
  fill: string
}

function drawSprite(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, scale: number): void {
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite, x, y, sprite.width * scale, sprite.height * scale)
}

function drawHpBar(ctx: CanvasRenderingContext2D, bar: HpBar): void {
  const { x, y, w, frac, fill } = bar
  const h = 8
  ctx.fillStyle = '#000000'
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2)
  ctx.fillStyle = '#26263a'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = fill
  ctx.fillRect(x, y, Math.max(0, Math.round(w * frac)), h)
}

/** Draw one combatant (sprite + HP bar + name/HP label). Dead units fade out. */
function drawUnit(
  ctx: CanvasRenderingContext2D,
  unit: Combatant,
  sprite: HTMLCanvasElement,
  x: number,
  baseY: number,
  fill: string,
  baseScale: number,
): void {
  const scale = unit.isBoss === true ? bossOf(baseScale) : baseScale
  const w = sprite.width * scale
  const h = sprite.height * scale
  const dead = unit.hp <= 0
  const barFill = unit.isBoss === true ? '#c78bff' : fill // boss bar reads as the threat

  ctx.save()
  ctx.globalAlpha = dead ? 0.25 : 1
  drawSprite(ctx, sprite, x, baseY, scale)
  ctx.restore()

  if (!dead) {
    drawHpBar(ctx, { x, y: baseY - Math.round(scale * 1.8), w, frac: unit.hp / unit.maxHp, fill: barFill })
    if (unit.defending) {
      // small shield tick to show the Defend status is active
      ctx.fillStyle = '#4fd1ff'
      ctx.fillText('🛡', x + w + 2, baseY - Math.round(scale * 2))
    }
  }

  ctx.fillStyle = dead ? '#5a5f70' : '#cfd6e0'
  ctx.font = '13px system-ui, sans-serif'
  const label = dead ? `${unit.name}  ✕` : `${unit.name}  ${unit.hp}/${unit.maxHp}`
  ctx.fillText(label, x, baseY + h + 4)
}

function drawColumn(
  ctx: CanvasRenderingContext2D,
  units: Combatant[],
  sprite: HTMLCanvasElement,
  x: number,
  topY: number,
  gap: number,
  fill: string,
  baseScale: number,
): void {
  // Right-align each unit so a wider boss sprite still hugs the right edge.
  units.forEach((u, i) => {
    const scale = u.isBoss === true ? bossOf(baseScale) : baseScale
    const drawX = x + (sprite.width * baseScale - sprite.width * scale)
    drawUnit(ctx, u, sprite, drawX, topY + i * gap, fill, baseScale)
  })
}

function drawBanner(ctx: CanvasRenderingContext2D, title: string, subtitle: string, colour: string): void {
  const { width, height } = ctx.canvas
  ctx.fillStyle = 'rgba(10, 10, 16, 0.72)'
  ctx.fillRect(0, 0, width, height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colour
  ctx.font = `bold ${Math.round(height * 0.08)}px system-ui, sans-serif`
  ctx.fillText(title, width / 2, height / 2 - Math.round(height * 0.04))
  ctx.fillStyle = '#cfd6e0'
  ctx.font = `${Math.round(height * 0.033)}px system-ui, sans-serif`
  ctx.fillText(subtitle, width / 2, height / 2 + Math.round(height * 0.05))
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

/** A clickable town building: a little house (roof + door + glyph) with its label
 *  below; hovering lights it up and shows a "click to enter" hint. */
function drawBuilding(ctx: CanvasRenderingContext2D, r: BuildingRect, on: boolean): void {
  const roofH = Math.round(r.h * 0.28)
  const bodyY = r.y + roofH
  const bodyH = r.h - roofH

  if (on) {
    ctx.save()
    ctx.shadowColor = 'rgba(79,209,255,0.45)'
    ctx.shadowBlur = 26
  }
  // body + roof (a trapezoid that overhangs the walls)
  ctx.fillStyle = on ? '#1b2738' : '#161622'
  ctx.fillRect(r.x, bodyY, r.w, bodyH)
  ctx.fillStyle = on ? '#26405a' : '#20202e'
  ctx.beginPath()
  ctx.moveTo(r.x - 6, bodyY)
  ctx.lineTo(r.x + r.w + 6, bodyY)
  ctx.lineTo(r.x + r.w - Math.round(r.w * 0.18), r.y)
  ctx.lineTo(r.x + Math.round(r.w * 0.18), r.y)
  ctx.closePath()
  ctx.fill()
  if (on) ctx.restore()

  ctx.strokeStyle = on ? '#4fd1ff' : '#2c2c40'
  ctx.lineWidth = 2
  ctx.strokeRect(r.x + 1, bodyY + 1, r.w - 2, bodyH - 2)

  // a distinguishing glyph on the wall (gear = Workshop, shelves = Library)
  ctx.fillStyle = on ? '#9bdcff' : '#5a6072'
  ctx.font = `${Math.round(r.w * 0.2)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(r.id === 'workshop' ? '⚙' : '▤', r.x + r.w / 2, bodyY + bodyH * 0.36)

  // door
  const dw = Math.round(r.w * 0.26)
  const dh = Math.round(bodyH * 0.46)
  const dx = r.x + (r.w - dw) / 2
  const dy = bodyY + bodyH - dh
  ctx.fillStyle = on ? '#0d1f2b' : '#0a0a12'
  ctx.fillRect(dx, dy, dw, dh)
  ctx.strokeStyle = on ? '#4fd1ff' : '#3a3a52'
  ctx.lineWidth = 1.5
  ctx.strokeRect(dx, dy, dw, dh)

  // label + hover hint
  ctx.textBaseline = 'top'
  ctx.fillStyle = on ? '#e6e9ef' : '#9aa0b0'
  ctx.font = `600 ${Math.max(13, Math.round(r.h * 0.1))}px system-ui, sans-serif`
  ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h + 8)
  if (on) {
    ctx.fillStyle = '#4fd1ff'
    ctx.font = `${Math.max(11, Math.round(r.h * 0.072))}px system-ui, sans-serif`
    ctx.fillText('click to enter', r.x + r.w / 2, r.y + r.h + 8 + Math.round(r.h * 0.13))
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sprites: Sprites,
  hovered: BuildingId | null = null,
): void {
  const { width, height } = ctx.canvas
  const groundH = Math.round(height * 0.17)
  const SS = unitScale(height)

  // background
  ctx.fillStyle = '#12121a'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#1b1b2a'
  ctx.fillRect(0, height - groundH, width, groundH) // ground band

  const heroes = state.units.filter((u) => u.side === 'hero')
  const enemies = state.units.filter((u) => u.side === 'enemy')

  ctx.textBaseline = 'top'

  // TOWN — a state with no enemies: a centred roster lineup standing on the ground.
  if (enemies.length === 0) {
    ctx.textAlign = 'center'
    ctx.fillStyle = '#e6e9ef'
    ctx.font = `bold ${Math.round(height * 0.06)}px system-ui, sans-serif`
    ctx.fillText('TOWN', width / 2, HUD_SAFE) // below the floating HUD bar
    ctx.fillStyle = '#62687a'
    ctx.font = `${Math.round(height * 0.03)}px system-ui, sans-serif`
    ctx.fillText('Your golems wait — enter a building, or descend', width / 2, HUD_SAFE + Math.round(height * 0.08))
    ctx.textAlign = 'left'

    // Buildings you can click to enter (Workshop / Library). Same rects the click
    // handler hit-tests (src/buildings.ts), so drawn ≡ clickable.
    for (const r of buildingRects(width, height)) drawBuilding(ctx, r, hovered === r.id)

    const heroW = sprites.hero.width * SS
    const heroH = sprites.hero.height * SS
    const slot = Math.max(heroW * 1.6, Math.round(width * 0.2))
    const startX = (width - heroes.length * slot) / 2 + (slot - heroW) / 2
    const baseY = height - groundH - heroH // feet on the ground band
    heroes.forEach((u, i) => drawUnit(ctx, u, sprites.hero, startX + i * slot, baseY, '#4fd1ff', SS))
    return
  }

  // COMBAT — party on the left, the enemy group on the right. (Legacy: live fights
  // now render through the delve corridor below; kept for completeness/tests.)
  ctx.font = `${Math.round(height * 0.033)}px system-ui, sans-serif`
  ctx.fillStyle = '#cfd6e0'
  ctx.fillText(`Round ${state.round + 1} · turn ${state.turn}`, 20, HUD_SAFE)
  const enemiesLeft = enemies.filter((u) => u.hp > 0).length
  ctx.fillStyle = '#9fe0a8'
  ctx.fillText(`Enemies left: ${enemiesLeft}/${enemies.length}`, 20, HUD_SAFE + Math.round(height * 0.045))

  const gap = Math.round(sprites.hero.height * SS * 0.75 + height * 0.04)
  const topY = HUD_SAFE + Math.round(height * 0.1)
  const margin = Math.round(width * 0.08)
  drawColumn(ctx, heroes, sprites.hero, margin, topY, gap, '#4fd1ff', SS)
  const slimeX = width - margin - sprites.slime.width * SS
  drawColumn(ctx, enemies, sprites.slime, slimeX, topY, gap, '#ff6b6b', SS)
}

/** Run-level HUD: which stage of the gauntlet we're on (top-right). */
export function renderRunHud(ctx: CanvasRenderingContext2D, depth: number, total: number): void {
  ctx.save()
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#c78bff'
  ctx.font = 'bold 15px system-ui, sans-serif'
  ctx.fillText(`Stage ${depth + 1} / ${total}`, ctx.canvas.width - 16, HUD_SAFE)
  ctx.restore()
}

/** Run-end banner, driven by the RUN status (not a single encounter's outcome). */
export function renderRunEnd(ctx: CanvasRenderingContext2D, status: 'cleared' | 'dead'): void {
  if (status === 'cleared') drawBanner(ctx, 'RUN CLEARED', 'Your program survived the gauntlet', '#9fe0a8')
  else drawBanner(ctx, 'RUN OVER', 'Read the journal, fix your Procedures, run again', '#ff6b6b')
}

// ---------------------------------------------------------------------------
// Delve view — a stylized first-person "scrying" viewport + a fog-of-war minimap
// ---------------------------------------------------------------------------

const DIR_LABEL = ['North', 'East', 'South', 'West']

function neighbourCell(d: DelveState['dungeon'], cell: number, dir: Dir): number {
  const x = (cell % d.width) + DX[dir]
  const y = ((cell / d.width) | 0) + DY[dir]
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return -1
  return y * d.width + x
}

export function renderDelve(ctx: CanvasRenderingContext2D, delve: DelveState, sprites: Sprites): void {
  const { width, height } = ctx.canvas
  ctx.fillStyle = '#0e0e16'
  ctx.fillRect(0, 0, width, height)

  drawDungeonView(ctx, delve, sprites) // one first-person view for exploring AND fighting
  drawMinimap(ctx, delve)

  if (delve.status === 'cleared') drawBanner(ctx, 'DELVE CLEARED', 'The objective is slain', '#9fe0a8')
  else if (delve.status === 'dead') drawBanner(ctx, 'GOLEMS WIPED', 'Read the journal, reprogram, delve again', '#ff6b6b')
  else if (delve.status === 'stuck') drawBanner(ctx, 'STUCK', 'Your golems found no way forward', '#ffb454')
}

function poly(ctx: CanvasRenderingContext2D, pts: number[], fill: string): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.closePath()
  ctx.fill()
}

// First-person "scrying" view: a perspective corridor with the party seen from
// behind in the foreground (Nevergrind-style over-the-shoulder framing).
function drawDungeonView(ctx: CanvasRenderingContext2D, delve: DelveState, sprites: Sprites): void {
  const { width, height } = ctx.canvas
  const SS = unitScale(height)
  const d = delve.dungeon
  const fwd = delve.facing
  const aheadCell = neighbourCell(d, delve.pos, fwd)
  const leftCell = neighbourCell(d, delve.pos, ((fwd + 3) % 4) as Dir)
  const rightCell = neighbourCell(d, delve.pos, ((fwd + 1) % 4) as Dir)
  const aheadFloor = aheadCell >= 0 && d.cells[aheadCell]
  const aheadSeen = aheadFloor && delve.explored[aheadCell]
  const aheadRoom = aheadFloor ? roomAt(d, aheadCell) : -1
  const exitL = leftCell >= 0 && d.cells[leftCell]
  const exitR = rightCell >= 0 && d.cells[rightCell]

  // near frame + vanishing point of the corridor tunnel (all proportional)
  const nx0 = Math.round(width * 0.05)
  const nx1 = width - nx0
  const ny0 = Math.round(height * 0.05)
  const ny1 = height - Math.round(height * 0.09)
  const vx = (nx0 + nx1) / 2
  const vy = ny0 + (ny1 - ny0) * 0.4

  const wallShade = aheadFloor ? '#181826' : '#14141e'
  poly(ctx, [nx0, ny0, nx1, ny0, vx, vy], '#0c0c14') // ceiling
  poly(ctx, [nx0, ny1, nx1, ny1, vx, vy], '#23233a') // floor
  poly(ctx, [nx0, ny0, nx0, ny1, vx, vy], wallShade) // left wall
  poly(ctx, [nx1, ny0, nx1, ny1, vx, vy], wallShade) // right wall

  // doorways carved into the side walls where there's an exit that way
  const dvy = Math.round(height * 0.12) // doorway half-extent at the near frame
  const dvx = Math.round(width * 0.048) // doorway inset toward the vanishing point
  const dvh = Math.round(height * 0.05)
  if (exitL) poly(ctx, [nx0, ny0 + dvy, nx0, ny1 - dvy, vx - dvx, vy + dvh, vx - dvx, vy - dvh], '#05050a')
  if (exitR) poly(ctx, [nx1, ny0 + dvy, nx1, ny1 - dvy, vx + dvx, vy + dvh, vx + dvx, vy - dvh], '#05050a')

  // the far end at the vanishing point
  const fw2 = Math.round(width * 0.033)
  const fh2 = Math.round(height * 0.05)
  ctx.fillStyle = !aheadFloor ? '#2a2a40' : !aheadSeen ? '#040409' : '#08080f'
  ctx.fillRect(vx - fw2, vy - fh2, fw2 * 2, fh2 * 2)

  // depth ribs (floor seams)
  ctx.strokeStyle = '#2c2c46'
  for (const t of [0.42, 0.68]) {
    const lx = nx0 + (vx - nx0) * t
    const rx = nx1 + (vx - nx1) * t
    const by = ny1 + (vy - ny1) * t
    ctx.beginPath()
    ctx.moveTo(lx, by)
    ctx.lineTo(rx, by)
    ctx.stroke()
  }

  // --- what's down the corridor: the live enemies if fighting, else a preview ---
  if (delve.battle !== null) {
    const enemies = delve.battle.units.filter((u) => u.side === 'enemy')
    enemies.forEach((e, i) => {
      const dead = e.hp <= 0
      const boss = e.isBoss === true
      const sc = boss ? bossOf(SS) : SS
      const ew = sprites.slime.width * sc
      const gap = Math.round(SS * 2.2)
      const totalW = enemies.length * ew + (enemies.length - 1) * gap
      const ex = vx - totalW / 2 + i * (ew + gap)
      const ey = vy - (boss ? Math.round(SS * 5.5) : Math.round(SS * 1.8))
      if (boss) {
        ctx.fillStyle = 'rgba(199,139,255,0.16)'
        ctx.beginPath()
        ctx.arc(ex + ew / 2, ey + ew / 2, ew * 0.7, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.save()
      ctx.globalAlpha = dead ? 0.2 : 1
      drawSprite(ctx, sprites.slime, ex, ey, sc)
      ctx.restore()
      if (!dead) drawHpBar(ctx, { x: ex, y: ey - 9, w: ew, frac: e.hp / e.maxHp, fill: '#ff6b6b' })
    })
  } else if (aheadSeen && aheadRoom >= 0 && !delve.clearedRooms[aheadRoom]) {
    const t = d.rooms[aheadRoom].type
    if (t === 'monster') {
      drawSprite(ctx, sprites.slime, vx - Math.round(SS * 6.5), vy - 4, Math.round(SS * 0.75))
      drawSprite(ctx, sprites.slime, vx + SS, vy + 2, SS)
    } else if (t === 'target') {
      ctx.fillStyle = 'rgba(199,139,255,0.18)'
      ctx.beginPath()
      ctx.arc(vx, vy + Math.round(SS * 1.5), SS * 8, 0, Math.PI * 2)
      ctx.fill()
      drawSprite(ctx, sprites.slime, vx - Math.round(SS * 6.5), vy - Math.round(SS * 4.5), bossOf(SS))
    }
  }

  // --- the party, seen from BEHIND, in the foreground (live HP if fighting) ---
  const heroes = delve.battle !== null ? delve.battle.units.filter((u) => u.side === 'hero') : delve.party
  const back = sprites.heroBack
  const scale = Math.round(SS * 1.3)
  const spW = back.width * scale
  const spH = back.height * scale
  heroes.forEach((h, i) => {
    const x = vx + (i === 0 ? -spW - Math.round(SS * 1.5) : Math.round(SS * 1.5))
    const y = ny1 + Math.round(SS) - spH
    const dead = h.hp <= 0
    ctx.save()
    ctx.globalAlpha = dead ? 0.3 : 1
    drawSprite(ctx, back, x, y, scale)
    ctx.restore()
    drawHpBar(ctx, { x, y: y - 10, w: spW, frac: Math.max(0, h.hp) / h.maxHp, fill: dead ? '#5a5f70' : '#4fd1ff' })
    ctx.fillStyle = dead ? '#5a5f70' : '#cfd6e0'
    ctx.font = '14px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${h.name} ${Math.max(0, h.hp)}/${h.maxHp}`, x + spW / 2, y + spH + 4)
    ctx.textAlign = 'left'
  })

  // "scrying orb" vignette: darken the edges
  const vg = ctx.createRadialGradient(vx, vy + 20, 60, vx, vy + 20, Math.max(width, height) * 0.72)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, width, height)

  // header overlay (below the floating HUD bar)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#9aa0b0'
  ctx.font = '15px system-ui, sans-serif'
  ctx.fillText(`Scrying · turn ${delve.turn} · facing ${DIR_LABEL[fwd]}${exitL ? ' · ◄ exit' : ''}${exitR ? ' · exit ►' : ''}`, 16, HUD_SAFE)
}

function drawMinimap(ctx: CanvasRenderingContext2D, delve: DelveState): void {
  const d = delve.dungeon
  const cs = Math.max(4, Math.round(ctx.canvas.height / 90))
  const mw = d.width * cs
  const mh = d.height * cs
  const x0 = ctx.canvas.width - mw - 14
  const y0 = HUD_SAFE // clear the floating HUD bar at the top
  ctx.fillStyle = '#000000'
  ctx.fillRect(x0 - 2, y0 - 2, mw + 4, mh + 4)
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const c = y * d.width + x
      ctx.fillStyle = !delve.explored[c] ? '#0a0a12' : d.cells[c] ? '#3a3a52' : '#191926'
      ctx.fillRect(x0 + x * cs, y0 + y * cs, cs - 1, cs - 1)
    }
  }
  // objective, if discovered
  const obj = d.rooms[d.objectiveRoomId]
  let objKnown = false
  for (let y = obj.y; y < obj.y + obj.h && !objKnown; y++) for (let x = obj.x; x < obj.x + obj.w; x++) if (delve.explored[y * d.width + x]) objKnown = true
  if (objKnown) {
    ctx.fillStyle = '#c78bff'
    ctx.fillRect(x0 + (obj.x + (obj.w >> 1)) * cs, y0 + (obj.y + (obj.h >> 1)) * cs, cs - 1, cs - 1)
  }
  // party + facing
  const px = delve.pos % d.width
  const py = (delve.pos / d.width) | 0
  ctx.fillStyle = '#4fd1ff'
  ctx.fillRect(x0 + px * cs, y0 + py * cs, cs - 1, cs - 1)
  ctx.fillStyle = '#cfd6e0'
  ctx.font = '13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(['↑', '→', '↓', '←'][delve.facing], x0 + px * cs + cs / 2 - 0.5, y0 + py * cs - 2)
  ctx.textAlign = 'left'
}
