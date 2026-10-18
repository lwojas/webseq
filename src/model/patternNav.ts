import type { Pattern, PatternId } from "./types";

/** The pattern one step before/after `id` in project order, or `id` itself at either end (no
 * wrap-around: ◀ ▶ and the [ ] keys stop at the first/last pattern rather than jumping across). */
export function adjacentPatternId(patterns: Pattern[], id: PatternId, direction: -1 | 1): PatternId {
  const index = patterns.findIndex((p) => p.id === id);
  if (index === -1) return patterns[0]?.id ?? id;
  const next = Math.min(patterns.length - 1, Math.max(0, index + direction));
  return patterns[next].id;
}
