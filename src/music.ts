// In-game music director: three Suno themes, cross-faded by game state.
//
//   camp → "Between Runs" (ambient, whole-file crossfade loop)
//   run  → "Autorun"      (DnB; intro plays once, then loops loopStart↔loopEnd)
//   boss → "Hex Warden"   (dark half-time; plays once, no loop — a boss fight is
//                          shorter than the track, so it never needs to wrap)
//
// Browsers block audio until a user gesture, so nothing plays until the player
// clicks the music toggle. After that, the director follows the game: whenever
// `setMusicState` is called with a new track it cross-fades to it.

import campUrl from './audio/camp.ogg?url'
import runUrl from './audio/run.ogg?url'
import bossUrl from './audio/boss.ogg?url'

export type TrackId = 'camp' | 'run' | 'boss'

interface TrackCfg {
  url: string
  loop: boolean
  loopStart?: number
  loopEnd?: number
}

const TRACKS: Record<TrackId, TrackCfg> = {
  camp: { url: campUrl, loop: true }, // whole-file loop (crossfade baked in)
  run: { url: runUrl, loop: true, loopStart: 21.62, loopEnd: 173.344 },
  boss: { url: bossUrl, loop: false },
}

const VOLUME = 0.5
const FADE = 1.2 // seconds — cross-fade between tracks

let ctx: AudioContext | undefined = undefined
let muted = true
let desired: TrackId = 'camp'
let current: { id: TrackId; src: AudioBufferSourceNode; gain: GainNode } | undefined = undefined
/** The track a cross-fade is currently loading/transitioning toward, if any. */
let pendingId: TrackId | undefined = undefined
const buffers = new Map<TrackId, AudioBuffer>()

async function bufferFor(id: TrackId): Promise<AudioBuffer> {
  const cached = buffers.get(id)
  if (cached !== undefined) return cached
  if (ctx === undefined) throw new Error('no audio context')
  const res = await fetch(TRACKS[id].url)
  const buf = await ctx.decodeAudioData(await res.arrayBuffer())
  buffers.set(id, buf)
  return buf
}

async function crossfadeTo(id: TrackId): Promise<void> {
  if (ctx === undefined) return
  const buf = await bufferFor(id)
  if (desired !== id) return // state changed while the buffer was loading

  const cfg = TRACKS[id]
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(ctx.destination)

  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = cfg.loop
  if (cfg.loopStart !== undefined) src.loopStart = cfg.loopStart
  if (cfg.loopEnd !== undefined) src.loopEnd = Math.min(cfg.loopEnd, buf.duration)
  src.connect(gain)
  src.start()

  const now = ctx.currentTime
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(VOLUME, now + FADE)

  const prev = current
  if (prev !== undefined) {
    prev.gain.gain.cancelScheduledValues(now)
    prev.gain.gain.setValueAtTime(prev.gain.gain.value, now)
    prev.gain.gain.linearRampToValueAtTime(0, now + FADE)
    prev.src.stop(now + FADE + 0.1)
  }
  current = { id, src, gain }
}

/**
 * Start a cross-fade to `id`, but never stack concurrent fades to the same
 * track — `pendingId` guards against the every-frame re-entry that would
 * otherwise spawn overlapping sources (stutter) while a buffer is still loading.
 */
async function transitionTo(id: TrackId): Promise<void> {
  if (current?.id === id || pendingId === id) { await Promise.resolve(); return; }
  pendingId = id
  await crossfadeTo(id).finally(() => {
    if (pendingId === id) pendingId = undefined
  });
}

/**
 * Tell the director which track the game wants. Cheap to call every frame:
 * no-ops if it already matches/loads, or if music is muted (the choice is
 * remembered and applied on unmute). The AudioContext is created lazily in
 * `toggleMusic`, which must run inside a user gesture.
 */
export function setMusicState(id: TrackId): void {
  desired = id
  if (muted || ctx === undefined) return
  void transitionTo(id)
}

/**
 * The single AudioContext shared by music and SFX. Browsers limit how many
 * contexts a page may open, so everything routes through this one. Created
 * lazily — the first caller must be inside a user gesture (the music toggle).
 */
export function audioContext(): AudioContext {
  ctx ??= new AudioContext()
  return ctx
}

/** Toggle music on/off (call from the toggle button's click handler). */
export async function toggleMusic(): Promise<boolean> {
  muted = !muted
  ctx = audioContext()
  await ctx.resume()
  if (muted) {
    if (current !== undefined) current.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3)
  } else if (current?.id === desired) {
    current.gain.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 0.3)
  } else {
    await transitionTo(desired)
  }
  return muted
}

// Vite HMR: tear down audio on hot update so contexts don't stack (stutter).
if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    try {
      current?.src.stop()
    } catch {
      /* already stopped */
    }
    void ctx?.close()
  })
}
