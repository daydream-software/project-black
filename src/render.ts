// Pure view layer: draws the current GameState onto the canvas. It reads state,
// it never mutates it. All game logic lives in sim.ts.

import type { Combatant, GameState } from './sim'

const SCALE = 5 // each sprite pixel becomes a 5x5 block (smaller — more units on screen)

interface Sprites {
  hero: HTMLCanvasElement
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
