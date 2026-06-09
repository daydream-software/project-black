// Pure view layer: draws the current GameState onto the canvas. It reads state,
// it never mutates it. All game logic lives in sim.ts.

import type { GameState } from './sim'

const SCALE = 7 // each sprite pixel becomes a 7x7 block

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

function drawSprite(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number): void {
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite, x, y, sprite.width * SCALE, sprite.height * SCALE)
}

function drawHpBar(ctx: CanvasRenderingContext2D, bar: HpBar): void {
  const { x, y, w, frac, fill } = bar
  const h = 10
  ctx.fillStyle = '#000000'
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2)
  ctx.fillStyle = '#26263a'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = fill
  ctx.fillRect(x, y, Math.max(0, Math.round(w * frac)), h)
}

export function render(ctx: CanvasRenderingContext2D, state: GameState, sprites: Sprites): void {
  const { width, height } = ctx.canvas

  // background
  ctx.fillStyle = '#12121a'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#1b1b2a'
  ctx.fillRect(0, height - 70, width, 70) // ground band

  // header
  ctx.fillStyle = '#cfd6e0'
  ctx.font = '16px system-ui, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText(`Turn ${state.turn}`, 16, 14)
  ctx.fillStyle = '#9fe0a8'
  ctx.fillText(`Slimes defeated: ${state.slimesDefeated}`, 16, 36)

  const spriteH = sprites.hero.height * SCALE
  const baseY = height - 70 - spriteH + 24

  // hero (left)
  const heroX = 60
  drawHpBar(ctx, {
    x: heroX,
    y: baseY - 22,
    w: sprites.hero.width * SCALE,
    frac: state.hero.hp / state.hero.maxHp,
    fill: '#4fd1ff',
  })
  drawSprite(ctx, sprites.hero, heroX, baseY)
  ctx.fillStyle = '#cfd6e0'
  ctx.font = '13px system-ui, sans-serif'
  ctx.fillText(`${state.hero.name}  ${state.hero.hp}/${state.hero.maxHp}`, heroX, baseY + spriteH + 6)

  // enemy (right)
  const slimeX = width - 60 - sprites.slime.width * SCALE
  drawHpBar(ctx, {
    x: slimeX,
    y: baseY - 22,
    w: sprites.slime.width * SCALE,
    frac: state.enemy.hp / state.enemy.maxHp,
    fill: '#ff6b6b',
  })
  drawSprite(ctx, sprites.slime, slimeX, baseY)
  ctx.fillStyle = '#cfd6e0'
  ctx.fillText(`${state.enemy.name}  ${state.enemy.hp}/${state.enemy.maxHp}`, slimeX, baseY + spriteH + 6)

  // defeat overlay — the procedure wasn't survivable
  if (state.hero.hp <= 0) {
    ctx.fillStyle = 'rgba(10, 10, 16, 0.72)'
    ctx.fillRect(0, 0, width, height)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ff6b6b'
    ctx.font = 'bold 28px system-ui, sans-serif'
    ctx.fillText('DEFEATED', width / 2, height / 2 - 14)
    ctx.fillStyle = '#cfd6e0'
    ctx.font = '14px system-ui, sans-serif'
    ctx.fillText('Adjust your protocols to survive', width / 2, height / 2 + 16)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
  }
}
