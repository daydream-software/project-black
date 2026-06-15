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

import { audioContext } from './music'
import { SFX } from './content/sfx'

/** A sound DEFINITION — a stable `id` and the URL of its audio asset. One file per
 *  sound under content/sfx/ (each importing its own .ogg); this engine just plays
 *  them. Adding a sound is dropping a content file, never editing this module. */
export interface SfxDef {
  id: string
  url: string
}

/** A sound id — whatever a content/sfx/ file declares. (Was a hardcoded union; the
 *  set of sounds is content now.) */
export type SfxId = string

/** Is this an id of a real sound in the registry? The view uses it to validate the
 *  sounds content declares (a skill's `sfx`), failing loudly at load on a typo. */
export function isSfxId(s: string): boolean {
  return SFX.has(s)
}

const VOLUME = 0.42

let enabled = false
const buffers = new Map<string, AudioBuffer>()
// One live voice per sound: combat acts every ~450ms, so without this the clips
// pile up into an overlapping drone. A new hit cuts its predecessor short (the
// clips already fade out, so the cut lands on near-silence — no click).
const voices = new Map<string, AudioBufferSourceNode>()

async function preload(ctx: AudioContext, def: SfxDef): Promise<void> {
  if (buffers.has(def.id)) return
  const res = await fetch(def.url)
  buffers.set(def.id, await ctx.decodeAudioData(await res.arrayBuffer()))
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
    await Promise.all([...SFX.values()].map(async (def) => { await preload(ctx, def); }))
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
if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    voices.clear()
    buffers.clear()
  })
}
