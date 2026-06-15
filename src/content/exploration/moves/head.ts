import type { ExMoveDef } from '../../../delve'

// Approach the rule's Subject — delegate to how that Subject steps toward itself.
export default {
  id: 'head',
  label: 'head toward',
  order: 10,
  resolve: (s, subject) => subject.stepToward(s),
} satisfies ExMoveDef
