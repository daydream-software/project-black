import type { Protocol } from '../../sim'

// Building blocks for the Procedures WE author for monsters (the player authors golem
// Procedures in the editor; these are the same shape, composed in code). A State
// references its Subject/Predicate by the SAME ids the editor persists — the engine
// resolves the behaviour from the registry. A monster is just a unit whose intelligence
// we wrote.

/** "Hit the nearest enemy, always." The trivial monster rule; the engine's
 *  no-protocol-matched fallback mirrors it for safety. */
export function attackNearest(): Protocol {
  return {
    state: { subject: 'enemy_near', predicate: 'always' },
    maneuver: { command: 'attack' },
    label: 'Enemy · near · Always → Attack',
  }
}
