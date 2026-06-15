import type { Protocol } from '../../sim'
import enemyNear from '../subjects/enemy-near'
import always from '../predicates/always'

// Building blocks for the Procedures WE author for monsters (the player authors golem
// Procedures in the editor; these are the same shape, composed in code). They reuse
// the SAME Subject/Predicate vocabulary content the editor offers — a monster is just
// a unit whose intelligence we wrote.

/** "Hit the nearest enemy, always." The trivial monster rule; the engine's
 *  no-protocol-matched fallback mirrors it for safety. */
export function attackNearest(): Protocol {
  return {
    state: { subject: enemyNear, predicate: always },
    maneuver: { command: 'attack' },
    label: 'Enemy · near · Always → Attack',
  }
}
