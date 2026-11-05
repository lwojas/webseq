// Per-pattern automation. A track (and the master) has one set of automation lanes; a pattern may carry its own for any owner
// (Pattern.automation), and where it does, THAT is what plays in this pattern and the owner's own lanes are left alone. So two
// sequences of different patterns can open a filter differently. A pattern with no entry plays the owner's lanes, so projects
// saved before this exist play exactly as before. The first edit starts from what plays now and stores it on the pattern.
import { updatePattern } from "./project";
import { fxOwner, type AutomationLane, type FxTarget, type Pattern, type PatternId, type Project } from "./types";

/** The lanes `target` plays in `pattern`: the pattern's own, else the owner's. */
export function lanesInPattern(project: Project, pattern: Pattern | undefined, target: FxTarget): AutomationLane[] {
  return pattern?.automation?.[target] ?? fxOwner(project, target)?.automation ?? [];
}

/** True when `pattern` has its own automation for `target`. */
export function hasPatternAutomation(pattern: Pattern | undefined, target: FxTarget): boolean {
  return pattern?.automation?.[target] !== undefined;
}

/** `project` with the master's and every track's lanes replaced by the pattern's own where it has them. The same object when it has none. */
export function projectInPattern(project: Project, pattern: Pattern | undefined): Project {
  const own = pattern?.automation;
  if (!own || Object.keys(own).length === 0) return project;
  return {
    ...project,
    master: own.master ? { ...project.master, automation: own.master } : project.master,
    tracks: project.tracks.map((t) => (own[t.id] ? { ...t, automation: own[t.id] } : t)),
  };
}

/** Edits the lanes `target` plays in the pattern; the owner's own lanes are not touched. */
export function updatePatternAutomation(project: Project, patternId: PatternId, target: FxTarget, update: (lanes: AutomationLane[]) => AutomationLane[]): Project {
  if (!fxOwner(project, target)) return project;
  return updatePattern(project, patternId, (p) => ({ ...p, automation: { ...p.automation, [target]: update(lanesInPattern(project, p, target)) } }));
}

/** Drops the pattern's own automation for `target`: it plays the owner's again. */
export function clearPatternAutomation(project: Project, patternId: PatternId, target: FxTarget): Project {
  return updatePattern(project, patternId, (p) => {
    if (!p.automation?.[target]) return p;
    const { [target]: _gone, ...rest } = p.automation;
    const { automation: _old, ...pattern } = p;
    return Object.keys(rest).length > 0 ? { ...pattern, automation: rest } : pattern;
  });
}
