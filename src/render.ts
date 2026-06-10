// Pure view layer: draws the current GameState onto the canvas. It reads state,
// it never mutates it. All game logic lives in sim.ts.

import type { Combatant, GameState } from './sim'
import { DX, DY, roomAt, type Dir } from './dungeon'
import type { DelveState } from './delve'

const SCALE = 5 // each sprite pixel becomes a 5x5 block (smaller — more units on screen)

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
): void {
  const scale = unit.isBoss === true ? 9 : SCALE
  const w = sprite.width * scale
  const h = sprite.height * scale
  const dead = unit.hp <= 0
  const barFill = unit.isBoss === true ? '#c78bff' : fill // boss bar reads as the threat

  ctx.save()
  ctx.globalAlpha = dead ? 0.25 : 1
  drawSprite(ctx, sprite, x, baseY, scale)
  ctx.restore()

  if (!dead) {
    drawHpBar(ctx, { x, y: baseY - 14, w, frac: unit.hp / unit.maxHp, fill: barFill })
    if (unit.defending) {
      // small shield tick to show the Defend status is active
      ctx.fillStyle = '#4fd1ff'
      ctx.fillText('🛡', x + w + 2, baseY - 16)
    }
  }

  ctx.fillStyle = dead ? '#5a5f70' : '#cfd6e0'
  ctx.font = '12px system-ui, sans-serif'
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
): void {
  // Right-align each unit so a wider boss sprite still hugs the right edge.
  units.forEach((u, i) => {
    const scale = u.isBoss === true ? 9 : SCALE
    const drawX = x + (sprite.width * SCALE - sprite.width * scale)
    drawUnit(ctx, u, sprite, drawX, topY + i * gap, fill)
  })
}

function drawBanner(ctx: CanvasRenderingContext2D, title: string, subtitle: string, colour: string): void {
  const { width, height } = ctx.canvas
  ctx.fillStyle = 'rgba(10, 10, 16, 0.72)'
  ctx.fillRect(0, 0, width, height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colour
  ctx.font = 'bold 30px system-ui, sans-serif'
  ctx.fillText(title, width / 2, height / 2 - 14)
  ctx.fillStyle = '#cfd6e0'
  ctx.font = '14px system-ui, sans-serif'
  ctx.fillText(subtitle, width / 2, height / 2 + 18)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

export function render(ctx: CanvasRenderingContext2D, state: GameState, sprites: Sprites): void {
  const { width, height } = ctx.canvas

  // background
  ctx.fillStyle = '#12121a'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#1b1b2a'
  ctx.fillRect(0, height - 60, width, 60) // ground band

  const heroes = state.units.filter((u) => u.side === 'hero')
  const enemies = state.units.filter((u) => u.side === 'enemy')

  // header — a state with no enemies is the camp (between runs)
  ctx.textBaseline = 'top'
  ctx.font = '15px system-ui, sans-serif'
  if (enemies.length === 0) {
    ctx.fillStyle = '#8b90a0'
    ctx.fillText('Camp — edit your party, then launch a run', 16, 14)
  } else {
    ctx.fillStyle = '#cfd6e0'
    ctx.fillText(`Round ${state.round + 1} · turn ${state.turn}`, 16, 12)
    const enemiesLeft = enemies.filter((u) => u.hp > 0).length
    ctx.fillStyle = '#9fe0a8'
    ctx.fillText(`Enemies left: ${enemiesLeft}/${enemies.length}`, 16, 34)
  }

  // Stack the party on the left, the enemy group on the right.
  const gap = 78
  const topY = 70
  drawColumn(ctx, heroes, sprites.hero, 50, topY, gap, '#4fd1ff')
  const slimeX = width - 50 - sprites.slime.width * SCALE
  drawColumn(ctx, enemies, sprites.slime, slimeX, topY, gap, '#ff6b6b')
}

/** Run-level HUD: which stage of the gauntlet we're on (top-right). */
export function renderRunHud(ctx: CanvasRenderingContext2D, depth: number, total: number): void {
  ctx.save()
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#c78bff'
  ctx.font = 'bold 15px system-ui, sans-serif'
  ctx.fillText(`Stage ${depth + 1} / ${total}`, ctx.canvas.width - 16, 14)
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
  else if (delve.status === 'dead') drawBanner(ctx, 'PARTY WIPED', 'Read the journal, reprogram, delve again', '#ff6b6b')
  else if (delve.status === 'stuck') drawBanner(ctx, 'STUCK', 'The party found no way forward', '#ffb454')
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

  // near frame + vanishing point of the corridor tunnel
  const nx0 = 30
  const nx1 = width - 30
  const ny0 = 18
  const ny1 = height - 34
  const vx = (nx0 + nx1) / 2
  const vy = ny0 + (ny1 - ny0) * 0.4

  const wallShade = aheadFloor ? '#181826' : '#14141e'
  poly(ctx, [nx0, ny0, nx1, ny0, vx, vy], '#0c0c14') // ceiling
  poly(ctx, [nx0, ny1, nx1, ny1, vx, vy], '#23233a') // floor
  poly(ctx, [nx0, ny0, nx0, ny1, vx, vy], wallShade) // left wall
  poly(ctx, [nx1, ny0, nx1, ny1, vx, vy], wallShade) // right wall

  // doorways carved into the side walls where there's an exit that way
  if (exitL) poly(ctx, [nx0, ny0 + 46, nx0, ny1 - 46, vx - 34, vy + 20, vx - 34, vy - 20], '#05050a')
  if (exitR) poly(ctx, [nx1, ny0 + 46, nx1, ny1 - 46, vx + 34, vy + 20, vx + 34, vy - 20], '#05050a')

  // the far end at the vanishing point
  const fw2 = 24
  const fh2 = 20
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
      const sc = boss ? 9 : 5
      const ew = sprites.slime.width * sc
      const gap = 12
      const totalW = enemies.length * ew + (enemies.length - 1) * gap
      const ex = vx - totalW / 2 + i * (ew + gap)
      const ey = vy - (boss ? 30 : 10)
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
      drawSprite(ctx, sprites.slime, vx - 36, vy - 2, 4)
      drawSprite(ctx, sprites.slime, vx + 6, vy + 2, 5)
    } else if (t === 'target') {
      ctx.fillStyle = 'rgba(199,139,255,0.18)'
      ctx.beginPath()
      ctx.arc(vx, vy + 8, 42, 0, Math.PI * 2)
      ctx.fill()
      drawSprite(ctx, sprites.slime, vx - 32, vy - 22, 8)
    }
  }

  // --- the party, seen from BEHIND, in the foreground (live HP if fighting) ---
  const heroes = delve.battle !== null ? delve.battle.units.filter((u) => u.side === 'hero') : delve.party
  const back = sprites.heroBack
  const scale = 7
  const spW = back.width * scale
  const spH = back.height * scale
  heroes.forEach((h, i) => {
    const x = vx + (i === 0 ? -spW - 8 : 8)
    const y = ny1 + 6 - spH
    const dead = h.hp <= 0
    ctx.save()
    ctx.globalAlpha = dead ? 0.3 : 1
    drawSprite(ctx, back, x, y, scale)
    ctx.restore()
    drawHpBar(ctx, { x, y: y - 10, w: spW, frac: Math.max(0, h.hp) / h.maxHp, fill: dead ? '#5a5f70' : '#4fd1ff' })
    ctx.fillStyle = dead ? '#5a5f70' : '#cfd6e0'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${h.name} ${Math.max(0, h.hp)}/${h.maxHp}`, x + spW / 2, y + spH + 2)
    ctx.textAlign = 'left'
  })

  // "scrying orb" vignette: darken the edges
  const vg = ctx.createRadialGradient(vx, vy + 20, 60, vx, vy + 20, Math.max(width, height) * 0.72)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, width, height)

  // header overlay
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#9aa0b0'
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText(`Scrying · turn ${delve.turn} · facing ${DIR_LABEL[fwd]}${exitL ? ' · ◄ exit' : ''}${exitR ? ' · exit ►' : ''}`, 12, 10)
}

function drawMinimap(ctx: CanvasRenderingContext2D, delve: DelveState): void {
  const d = delve.dungeon
  const cs = 4
  const mw = d.width * cs
  const mh = d.height * cs
  const x0 = ctx.canvas.width - mw - 10
  const y0 = 8
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
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(['↑', '→', '↓', '←'][delve.facing], x0 + px * cs + cs / 2 - 0.5, y0 + py * cs - 1)
  ctx.textAlign = 'left'
}
