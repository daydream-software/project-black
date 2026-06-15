import type { ExPredicateDef } from '../../../delve'

// Holds when the rule's Subject is currently discovered & pathable (asks the Subject
// itself — the one predicate that depends on its Subject).
export default {
  id: 'known',
  label: 'known',
  order: 20,
  holds: (s, subject) => subject.reachable(s),
} satisfies ExPredicateDef
