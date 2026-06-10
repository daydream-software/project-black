// One-shot combat sound effects: stone-golem Suno samples, fired per log entry.
//
// Unlike music.ts (long, cross-faded loops), these are short fire-and-forget
// clips played the moment a combatant acts. The director in main.ts watches the
// battle log and calls `playSfx(kind)` for each new entry, so the sim stays pure
// (it only produces the log; nothing here runs during offline replay).
//
// Audio shares music.ts's single AudioContext (browsers limit how many a page
// may open). Browsers also block audio until a user gesture, so nothing sounds
// until the player flips the same toggle that starts the music (`setSfxEnabled`,
// called from its click handler — a valid gesture that resumes the context).

import attackUrl from './audio/golem-attack.ogg?url'
import healUrl from './audio/golem-heal.ogg?url'
import defendUrl from './audio/golem-defend.ogg?url'
import hitUrl from './audio/golem-hit.ogg?url'
import { audioContext } from './music'

/** A combat sound. The caller (main.ts) decides which from the log entry —
 *  e.g. an enemy's attack on a hero plays `hit`, the hero's own attack plays
 *  `attack`. */
export type SfxId = 'attack' | 'heal' | 'defend' | 'hit'

const URLS: Record<SfxId, string> = {
  attack: attackUrl,
  heal: healUrl,
  defend: defendUrl,
  hit: hitUrl,
}

const VOLUME = 0.42

let enabled = false
const buffers = new Map<SfxId, AudioBuffer>()
// One live voice per kind: combat acts every ~450ms, so without this the clips
// pile up into an overlapping drone. A new hit cuts its predecessor short (the
// clips already fade out, so the cut lands on near-silence — no click).
const voices = new Map<SfxId, AudioBufferSourceNode>()

async function preload(ctx: AudioContext, id: SfxId): Promise<void> {
  if (buffers.has(id)) return
  const res = await fetch(URLS[id])
  buffers.set(id, await ctx.decodeAudioData(await res.arrayBuffer()))
}

/**
 * Enable/disable combat SFX. The first enable must run inside a user gesture
 * (it resumes the shared AudioContext, then preloads every clip so the first
 * hit isn't swallowed by a fetch/decode). Cheap to call again. Never throws —
 * audio setup must not be able to break the caller.
 */
export async function setSfxEnabled(on: boolean): Promise<void> {
  enabled = on
  if (!on) return
  try {
    const ctx = audioContext()
    await ctx.resume()
    await Promise.all((Object.keys(URLS) as SfxId[]).map((id) => preload(ctx, id)))
  } catch {
    /* leave enabled true; playSfx no-ops until buffers exist */
  }
}

/**
 * Play the clip for a combat-log kind. No-op when disabled, unloaded, or silent.
 * Swallows any audio error: a sound effect must never be able to break the game
 * loop (the caller plays these from inside the per-tick render path).
 */
export function playSfx(id: SfxId): void {
  if (!enabled) return
  const buf = buffers.get(id)
  if (buf === undefined) return // still loading — skip rather than stall
  try {
    const ctx = audioContext()
    const prev = voices.get(id)
    if (prev !== undefined) {
      try {
        prev.stop()
      } catch {
        /* already ended */
      }
    }
    const gain = ctx.createGain()
    gain.gain.value = VOLUME
    gain.connect(ctx.destination)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(gain)
    src.start()
    voices.set(id, src)
    src.onended = () => {
      gain.disconnect()
      if (voices.get(id) === src) voices.delete(id)
    }
  } catch {
    /* never let a sound effect break the render loop */
  }
}

// Vite HMR: drop decoded buffers on hot update (music.ts owns the context).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    voices.clear()
    buffers.clear()
  })
}
