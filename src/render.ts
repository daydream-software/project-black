// Pure view layer: draws the current GameState onto the canvas. It reads state,
// it never mutates it. All game logic lives in sim.ts.
//
// The canvas fills the window (responsive viewport — see main.ts), so every
// size/position here is derived from the canvas's CSS size rather than a fixed
// magic number: the scene fills any window without bars, crop or distortion. We
// draw in **CSS pixels** — main.ts scales the backing store by devicePixelRatio
// and applies a matching transform, so all coordinates here stay CSS px (and the
// HUD safe-zone below is a fixed offset matching the floating DOM HUD). Read the
// drawing size via `cssSize()`, NOT `ctx.canvas.width/height` (that's the larger,
// device-pixel backing store).

import { upcomingTurns, type Combatant, type GameState } from './sim'
import type { RoomType, RoomNode } from './mapgraph'
import type { DelveState } from './delve'
import { neighbours, isKnown } from './content/exploration/navigation'
import { buildingRects, foyerLayout, type BuildingId, type BuildingRect } from './buildings'

const HUD_SAFE = 72 // px reserved at the top for the floating HUD bar (DOM)

/** The canvas's CSS size — the coordinate space we draw in (the backing store is
 *  devicePixelRatio× larger; the transform set in main.ts bridges the two). */
function cssSize(ctx: CanvasRenderingContext2D): { width: number; height: number } {
  return { width: ctx.canvas.clientWidth, height: ctx.canvas.clientHeight }
}

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
  const { width, height } = cssSize(ctx)
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
interface BuildingPalette {
  body: string
  roof: string
  stroke: string
  glyph: string
  door: string
  doorStroke: string
  label: string
}

/** The lit-vs-dark colour set for a building, picked once so drawBuilding doesn't
 *  carry an `on ? … : …` ternary on every fill. */
function buildingPalette(on: boolean): BuildingPalette {
  return on
    ? { body: '#1b2738', roof: '#26405a', stroke: '#4fd1ff', glyph: '#9bdcff', door: '#0d1f2b', doorStroke: '#4fd1ff', label: '#e6e9ef' }
    : { body: '#161622', roof: '#20202e', stroke: '#2c2c40', glyph: '#5a6072', door: '#0a0a12', doorStroke: '#3a3a52', label: '#9aa0b0' }
}

function drawBuilding(ctx: CanvasRenderingContext2D, r: BuildingRect, on: boolean): void {
  const roofH = Math.round(r.h * 0.28)
  const bodyY = r.y + roofH
  const bodyH = r.h - roofH
  const p = buildingPalette(on)

  if (on) {
    ctx.save()
    ctx.shadowColor = 'rgba(79,209,255,0.45)'
    ctx.shadowBlur = 26
  }
  // body + roof (a trapezoid that overhangs the walls)
  ctx.fillStyle = p.body
  ctx.fillRect(r.x, bodyY, r.w, bodyH)
  ctx.fillStyle = p.roof
  ctx.beginPath()
  ctx.moveTo(r.x - 6, bodyY)
  ctx.lineTo(r.x + r.w + 6, bodyY)
  ctx.lineTo(r.x + r.w - Math.round(r.w * 0.18), r.y)
  ctx.lineTo(r.x + Math.round(r.w * 0.18), r.y)
  ctx.closePath()
  ctx.fill()
  if (on) ctx.restore()

  ctx.strokeStyle = p.stroke
  ctx.lineWidth = 2
  ctx.strokeRect(r.x + 1, bodyY + 1, r.w - 2, bodyH - 2)

  // a distinguishing glyph on the wall (gear = Workshop, shelves = Library)
  ctx.fillStyle = p.glyph
  ctx.font = `${Math.round(r.w * 0.2)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(r.id === 'workshop' ? '⚙' : '▤', r.x + r.w / 2, bodyY + bodyH * 0.36)

  // door
  const dw = Math.round(r.w * 0.26)
  const dh = Math.round(bodyH * 0.46)
  const dx = r.x + (r.w - dw) / 2
  const dy = bodyY + bodyH - dh
  ctx.fillStyle = p.door
  ctx.fillRect(dx, dy, dw, dh)
  ctx.strokeStyle = p.doorStroke
  ctx.lineWidth = 1.5
  ctx.strokeRect(dx, dy, dw, dh)

  // label + hover hint
  ctx.textBaseline = 'top'
  ctx.fillStyle = p.label
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

/** Hover affordance over a clickable foyer zone: a soft teal glow outline + the
 *  room's name, so the player sees what they're about to enter. */
function drawZoneHighlight(ctx: CanvasRenderingContext2D, r: BuildingRect): void {
  ctx.save()
  ctx.fillStyle = 'rgba(120,245,235,0.12)'
  ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.strokeStyle = 'rgba(150,250,240,0.95)'
  ctx.lineWidth = 3
  ctx.shadowColor = 'rgba(120,245,235,0.6)'
  ctx.shadowBlur = 22
  ctx.strokeRect(r.x, r.y, r.w, r.h)
  ctx.restore()

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = `700 ${Math.max(14, Math.round(r.w * 0.11))}px system-ui, sans-serif`
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(8,6,16,0.85)'
  ctx.fillStyle = '#e6fffb'
  const tx = r.x + r.w / 2
  const ty = r.y + 10
  ctx.strokeText(`▶ ${  r.label}`, tx, ty)
  ctx.fillText(`▶ ${  r.label}`, tx, ty)
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sprites: Sprites,
  hovered: BuildingId | null = null,
  foyer: HTMLImageElement | null = null,
): void {
  const { width, height } = cssSize(ctx)
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

  // TOWN — a state with no enemies. The hub is the Artificer's tower foyer: a
  // backdrop you click into (Workshop / Library). The drawn placeholder below is
  // the fallback until the image loads.
  if (enemies.length === 0) {
    if (foyer !== null && foyer.complete && foyer.naturalWidth > 0) {
      const { ix, iy, iw, ih } = foyerLayout(width, height)
      // The artwork is square; on a wide screen a contain-fit leaves side bars.
      // Fill them with a blurred, darkened cover-copy of the foyer so it reads
      // full-bleed without cropping the signage off the sharp image.
      ctx.fillStyle = '#140c1e'
      ctx.fillRect(0, 0, width, height)
      const cscale = Math.max(width / foyer.naturalWidth, height / foyer.naturalHeight)
      const cw = foyer.naturalWidth * cscale
      const ch = foyer.naturalHeight * cscale
      ctx.save()
      ctx.filter = 'blur(26px)'
      ctx.drawImage(foyer, (width - cw) / 2, (height - ch) / 2, cw, ch)
      ctx.restore()
      ctx.fillStyle = 'rgba(10,6,16,0.5)' // recede the backdrop so the sharp art pops
      ctx.fillRect(0, 0, width, height)
      // the sharp, whole foyer centred — signage + floor intact
      ctx.drawImage(foyer, ix, iy, iw, ih)
      if (hovered !== null) {
        const r = buildingRects(width, height).find((b) => b.id === hovered)
        if (r !== undefined) drawZoneHighlight(ctx, r)
      }
      return
    }
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
    heroes.forEach((u, i) => { drawUnit(ctx, u, sprites.hero, startX + i * slot, baseY, '#4fd1ff', SS); })
    return
  }

  // COMBAT — party on the left, the enemy group on the right. (Legacy: live fights
  // now render through the delve corridor below. This branch is unreachable today —
  // render() is only ever called with the enemy-less camp state — kept only as the
  // reference layout for a possible standalone combat view.)
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

// ---------------------------------------------------------------------------
// Delve view — a stylized first-person "scrying" viewport + a fog-of-war minimap
// ---------------------------------------------------------------------------

export function renderDelve(ctx: CanvasRenderingContext2D, delve: DelveState, sprites: Sprites): void {
  const { width, height } = cssSize(ctx)
  ctx.fillStyle = '#0e0e16'
  ctx.fillRect(0, 0, width, height)

  drawDelveScene(ctx, delve, sprites) // one scrying view for exploring AND fighting
  drawGraphMinimap(ctx, delve)

  if (delve.status === 'cleared') drawBanner(ctx, 'DELVE CLEARED', 'The objective is slain', '#9fe0a8')
  else if (delve.status === 'dead') drawBanner(ctx, 'GOLEMS WIPED', 'Read the journal, reprogram, delve again', '#ff6b6b')
  else if (delve.status === 'stuck') drawBanner(ctx, 'STUCK', 'Your golems found no way forward', '#ffb454')
  else if (delve.status === 'left') drawBanner(ctx, 'WITHDREW', 'Your golems retreated to town', '#8fc7e6')
}

function poly(ctx: CanvasRenderingContext2D, pts: number[], fill: string): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.closePath()
  ctx.fill()
}

const ROOM_COLOR: Record<RoomType, string> = {
  entrance: '#9fe0a8', fight: '#ff6b6b', loot: '#ffd166', buff: '#6bd1ff', boss: '#c78bff',
}

interface Exit { id: string; type: RoomType; explored: boolean }
function delveExits(delve: DelveState): Exit[] {
  // Only KNOWN neighbours get a doorway chip — same predicate as the minimap, so a hidden
  // (unrevealed) room next door leaks no door + no type into the first-person scene. A
  // reveal (Secret Sight) makes isKnown true → the secret door then appears.
  return neighbours(delve.graph, delve.pos)
    .filter((id) => isKnown(delve, id))
    .map((id) => {
      const room = delve.graph.rooms.find((r) => r.id === id)
      return { id, type: room?.type ?? 'fight', explored: delve.explored.includes(id) }
    })
}

interface Frame { nx0: number; nx1: number; ny0: number; ny1: number; vx: number; vy: number }

/** The generic perspective tunnel (ceiling/floor/walls to a vanishing point), with a
 *  side doorway per connected room. The graph view has no compass facing — the tunnel
 *  is the room you're in; the chips at the far end are the connected rooms (the peek). */
function drawTunnel(ctx: CanvasRenderingContext2D, f: Frame, width: number, height: number, exits: number): void {
  const { nx0, nx1, ny0, ny1, vx, vy } = f
  poly(ctx, [nx0, ny0, nx1, ny0, vx, vy], '#0c0c14')
  poly(ctx, [nx0, ny1, nx1, ny1, vx, vy], '#23233a')
  poly(ctx, [nx0, ny0, nx0, ny1, vx, vy], '#181826')
  poly(ctx, [nx1, ny0, nx1, ny1, vx, vy], '#181826')
  const dvy = Math.round(height * 0.12)
  const dvx = Math.round(width * 0.048)
  const dvh = Math.round(height * 0.05)
  if (exits >= 1) poly(ctx, [nx0, ny0 + dvy, nx0, ny1 - dvy, vx - dvx, vy + dvh, vx - dvx, vy - dvh], '#05050a')
  if (exits >= 2) poly(ctx, [nx1, ny0 + dvy, nx1, ny1 - dvy, vx + dvx, vy + dvh, vx + dvx, vy - dvh], '#05050a')
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
}

/** The 1-hop peek: connected rooms as small typed chips down the tunnel (✓ if entered). */
function drawExitChips(ctx: CanvasRenderingContext2D, exits: Exit[], f: Frame, ss: number): void {
  if (exits.length === 0) return
  const cw = Math.round(ss * 3.4)
  const ch = Math.round(ss * 1.5)
  const gap = Math.round(ss * 0.7)
  const totalW = exits.length * cw + (exits.length - 1) * gap
  let x = f.vx - totalW / 2
  const y = f.vy - Math.round(ss * 2.6)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold ${Math.round(ss * 0.85)}px system-ui, sans-serif`
  for (const e of exits) {
    ctx.globalAlpha = e.explored ? 0.4 : 1
    ctx.fillStyle = ROOM_COLOR[e.type]
    roundRect(ctx, x, y, cw, ch, 5)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = '#0a0a12'
    ctx.fillText(`${e.type}${e.explored ? ' ✓' : ''}`, x + cw / 2, y + ch / 2 + 1)
    x += cw + gap
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Draw the live enemies down the tunnel (during a fight). */
function drawEnemies(ctx: CanvasRenderingContext2D, enemies: Combatant[], f: Frame, ss: number, sprites: Sprites): void {
  enemies.forEach((e, i) => {
    const dead = e.hp <= 0
    const boss = e.isBoss === true
    const sc = boss ? bossOf(ss) : ss
    const ew = sprites.slime.width * sc
    const gap = Math.round(ss * 2.2)
    const totalW = enemies.length * ew + (enemies.length - 1) * gap
    const ex = f.vx - totalW / 2 + i * (ew + gap)
    const ey = f.vy - (boss ? Math.round(ss * 5.5) : Math.round(ss * 1.8))
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
}

/** Draw the party from BEHIND, foreground (live HP + Strain if fighting). */
function drawParty(ctx: CanvasRenderingContext2D, heroes: Combatant[], f: Frame, ss: number, sprites: Sprites): void {
  const back = sprites.heroBack
  const scale = Math.round(ss * 1.3)
  const spW = back.width * scale
  const spH = back.height * scale
  heroes.forEach((h, i) => {
    const x = f.vx + (i === 0 ? -spW - Math.round(ss * 1.5) : Math.round(ss * 1.5))
    const y = f.ny1 + Math.round(ss) - spH
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
    const { poise } = h
    if (poise > 0 && !dead) {
      const strain = h.strain ?? 0
      const over = strain > poise
      ctx.fillStyle = over ? '#ff8c42' : '#7f8a99'
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillText(`⚡ Strain ${strain}/${poise}${over ? ' • overdraw' : ''}`, x + spW / 2, y + spH + 20)
    }
    ctx.textAlign = 'left'
  })
}

/** One scrying view for exploring AND fighting: the room you're in (the tunnel), the
 *  connected rooms peeked at the far end (or the live enemies during a fight), and the
 *  party from behind in the foreground. */
function drawDelveScene(ctx: CanvasRenderingContext2D, delve: DelveState, sprites: Sprites): void {
  const { width, height } = cssSize(ctx)
  const SS = unitScale(height)
  const exits = delveExits(delve)
  const nx0 = Math.round(width * 0.05)
  const nx1 = width - nx0
  const ny0 = Math.round(height * 0.05)
  const ny1 = height - Math.round(height * 0.09)
  const f: Frame = { nx0, nx1, ny0, ny1, vx: (nx0 + nx1) / 2, vy: ny0 + (ny1 - ny0) * 0.4 }

  drawTunnel(ctx, f, width, height, exits.length)
  if (delve.battle === null) drawExitChips(ctx, exits, f, SS)
  else drawEnemies(ctx, delve.battle.units.filter((u) => u.side === 'enemy'), f, SS, sprites)
  drawParty(ctx, delve.battle === null ? delve.party : delve.battle.units.filter((u) => u.side === 'hero'), f, SS, sprites)

  // scrying-orb vignette
  const vg = ctx.createRadialGradient(f.vx, f.vy + 20, 60, f.vx, f.vy + 20, Math.max(width, height) * 0.72)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, width, height)

  const cur = delve.graph.rooms.find((r) => r.id === delve.pos)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#9aa0b0'
  ctx.font = '15px system-ui, sans-serif'
  ctx.fillText(`Scrying · turn ${delve.turn} · in the ${cur?.type ?? '?'} room · ${exits.length} exit${exits.length === 1 ? '' : 's'}`, 16, HUD_SAFE)

  if (delve.battle !== null) drawTurnCarousel(ctx, delve.battle.units, width)
}

/** A horizontal strip of the next units to act (FFX-style upcoming-turns), drawn
 *  top-centre during combat. The first chip = next to act (ringed). Shared with the
 *  sim's real schedule via `upcomingTurns`, so it can never lie about turn order. */
function drawTurnCarousel(ctx: CanvasRenderingContext2D, units: Combatant[], width: number): void {
  const order = upcomingTurns(units, 7)
  if (order.length === 0) return
  const byId = new Map(units.map((u) => [u.id, u]))
  const chip = 30
  const gap = 8
  const totalW = order.length * chip + (order.length - 1) * gap
  let x = Math.round((width - totalW) / 2)
  const y = HUD_SAFE + 26
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 13px system-ui, sans-serif'
  order.forEach((id, i) => {
    const u = byId.get(id)
    const enemy = u?.side === 'enemy'
    const boss = u?.isBoss === true
    const next = i === 0
    ctx.globalAlpha = next ? 1 : Math.max(0.4, 1 - i * 0.1)
    ctx.fillStyle = enemy ? (boss ? '#c78bff' : '#ff6b6b') : '#4fd1ff'
    roundRect(ctx, x, y, chip, chip, 7)
    ctx.fill()
    if (next) {
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      roundRect(ctx, x - 2, y - 2, chip + 4, chip + 4, 9)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = '#0a0a12'
    ctx.fillText((u?.name ?? '?').slice(0, 1), x + chip / 2, y + chip / 2 + 1)
    x += chip + gap
  })
  ctx.globalAlpha = 1
}

/** A filled rounded-rect path (caller does fill/stroke). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Layered BFS layout: each room's column = its hop-depth from the entrance, row =
 *  its index among rooms at that depth. A graph map, not a grid. */
function layoutGraph(delve: DelveState): Map<string, { col: number; row: number }> {
  const g = delve.graph
  const depth = new Map<string, number>([[g.entranceId, 0]])
  const queue = [g.entranceId]
  for (const cur of queue) {
    for (const nb of neighbours(g, cur)) {
      if (!depth.has(nb)) {
        depth.set(nb, (depth.get(cur) ?? 0) + 1)
        queue.push(nb)
      }
    }
  }
  const rowCount = new Map<number, number>()
  const out = new Map<string, { col: number; row: number }>()
  for (const r of g.rooms) {
    const col = depth.get(r.id) ?? 0
    const row = rowCount.get(col) ?? 0
    rowCount.set(col, row + 1)
    out.set(r.id, { col, row })
  }
  return out
}

function drawGraphMinimap(ctx: CanvasRenderingContext2D, delve: DelveState): void {
  const g = delve.graph
  const { width } = cssSize(ctx)
  const pos = layoutGraph(delve)
  // The same notion of "known" the router uses (explored / revealed / 1-hop peek, but a
  // hidden room stays dark until revealed) — shared so the minimap and routing never
  // disagree about what the party can see.
  const known = (id: string): boolean => isKnown(delve, id)
  const cell = 26
  const pad = 10
  // A FIXED-size panel (odd cell count → an exact centre cell). The current room is
  // pinned dead-centre and the graph scrolls under this window as the party moves, so the
  // panel never grows with the dungeon and never hints at its full extent.
  const view = 5
  const mw = view * cell + pad * 2
  const mh = view * cell + pad * 2
  const x0 = width - mw - 14
  const y0 = HUD_SAFE
  const cx = x0 + mw / 2
  const cy = y0 + mh / 2
  const here = pos.get(delve.pos) ?? { col: 0, row: 0 }
  const center = (id: string): { x: number; y: number } => {
    const p = pos.get(id) ?? here
    return { x: cx + (p.col - here.col) * cell, y: cy + (p.row - here.row) * cell }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(x0, y0, mw, mh)
  // clip everything to the panel so rooms/corridors that scroll past the edge are cut off
  // cleanly instead of spilling across the scene.
  ctx.save()
  ctx.beginPath()
  ctx.rect(x0, y0, mw, mh)
  ctx.clip()
  // corridors: a brighter, 2px line so the graph's connections actually read on the
  // dark overlay (a 1px near-black line was invisible at this scale).
  ctx.strokeStyle = '#8a8ab0'
  ctx.lineWidth = 2
  for (const c of g.corridors) {
    // fog: only a corridor between two KNOWN rooms is drawn, so the map fills in as the
    // party explores — the full structure is never revealed from the entrance.
    if (!known(c.a) || !known(c.b)) continue
    const a = center(c.a)
    const b = center(c.b)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  const sz = Math.round(cell * 0.56)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(sz * 0.8)}px system-ui, sans-serif`
  // A room is "done" (✓) when its CONTENT is dealt with — a fight/boss is cleared, a
  // loot/buff room is collected — NOT merely entered. (The entrance has no challenge, so
  // arriving is enough.) So a fight room you're standing in mid-battle shows no ✓ yet.
  const isDone = (room: RoomNode): boolean => {
    if (room.type === 'fight' || room.type === 'boss') return delve.cleared.includes(room.id)
    if (room.type === 'loot' || room.type === 'buff') return delve.resolved.includes(room.id)
    return delve.explored.includes(room.id)
  }
  for (const r of g.rooms) {
    // fog: an unknown room isn't drawn at all (no placeholder) — its very existence stays
    // hidden until the party explores to it or a vision buff reveals it.
    if (!known(r.id)) continue
    const c = center(r.id)
    const explored = delve.explored.includes(r.id)
    ctx.globalAlpha = explored ? 1 : 0.4
    ctx.fillStyle = ROOM_COLOR[r.type]
    ctx.fillRect(c.x - sz / 2, c.y - sz / 2, sz, sz)
    ctx.globalAlpha = 1
    if (isDone(r)) {
      ctx.fillStyle = '#0a0a12'
      ctx.fillText('✓', c.x, c.y + 0.5)
    }
    if (r.id === delve.pos) {
      ctx.strokeStyle = '#4fd1ff'
      ctx.lineWidth = 2
      ctx.strokeRect(c.x - sz / 2 - 2, c.y - sz / 2 - 2, sz + 4, sz + 4)
    }
  }
  ctx.restore() // end panel clip
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}
