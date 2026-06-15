// The skill catalog — one file per skill, each carrying its editor face AND its
// combat effect. `SKILLS` (ordered) drives the editor's Use-Skill dropdown; the
// `SKILLS_BY_ID` map drives the sim's dispatch in `applyManeuver`. The glob lives
// only here (see ../registry.ts).
import type { SkillDef } from '../../sim'
import { collect, mapById } from '../registry'

const mods = import.meta.glob<SkillDef>(['./*.ts', '!./index.ts', '!./*.test.ts'], {
  eager: true,
  import: 'default',
})

export const SKILLS = collect(mods)
// A Map (not a record): a dispatch lookup may miss on a stale skill id, and `.get()`
// returns `SkillDef | undefined` so the sim is forced to treat that as inert.
export const SKILLS_BY_ID = mapById(mods)
