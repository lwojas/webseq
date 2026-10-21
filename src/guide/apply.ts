// "Try this": turning a recipe into normal project data. The only place the Musical Guide
// writes to a project, and only when the user clicks it. The result is ordinary notes on
// ordinary tracks — nothing marks them as coming from a recipe, and playback has no idea.
//
// Placement rule (additive only — nothing existing is changed):
//   * The recipe goes into the sequence being edited. Each recipe track takes the selected track
//     if it has no notes in that sequence, otherwise the next track (scanning forward, then
//     wrapping) that has none. A multi-track recipe takes successive empty tracks.
//   * A target track with no sound source gets the recipe's suggested instrument. A track that
//     already has a sound keeps it: its source is never reassigned.
//   * The sequence only ever grows: if the recipe is longer than the sequence, the sequence is
//     extended to the recipe's length (nothing is lost by growing); if it is shorter, the
//     sequence keeps its length. No sequence is created, shrunk or overwritten.

import { INSTRUMENT_DEFS, setTrackInstrument } from "../model/instruments";
import { setPatternBars } from "../model/project";
import { scaleOf } from "../model/scale";
import type { InstrumentKindId, Note, PatternId, Project, TrackId } from "../model/types";
import { trackById, trackHasSource } from "../model/types";
import type { Recipe } from "./recipes";
import { resolveRecipeTrack } from "./resolve";

export interface ApplyOptions {
  /** The sequence currently being edited. */
  patternId: PatternId;
  /** The selected track, where placement starts. Absent (or MASTER) = start from the first track. */
  trackId?: TrackId | null;
  /** Whether the audio engine provides an instrument kind. Absent = trust the model registry. */
  isKindAvailable?: (kind: InstrumentKindId) => boolean;
}

export type ApplyResult =
  | { ok: true; project: Project; patternId: PatternId; trackIds: TrackId[]; grew: boolean; messages: string[] }
  | { ok: false; reason: string };

export function applyRecipe(project: Project, recipe: Recipe, options: ApplyOptions): ApplyResult {
  const isAvailable = options.isKindAvailable ?? (() => true);
  const ctx = scaleOf(project);
  const pattern = project.patterns.find((p) => p.id === options.patternId);
  if (!pattern) return { ok: false, reason: "The sequence being edited no longer exists." };

  const used = new Set(Object.values(pattern.notes).map((n) => n.trackId));
  const startIndex = Math.max(0, project.tracks.findIndex((t) => t.id === options.trackId));
  const order = [...project.tracks.slice(startIndex), ...project.tracks.slice(0, startIndex)];
  const free = order.filter((t) => !used.has(t.id));
  if (free.length < recipe.tracks.length) {
    return { ok: false, reason: `This recipe needs ${recipe.tracks.length} empty track${recipe.tracks.length === 1 ? "" : "s"} in this sequence, and only ${free.length} ${free.length === 1 ? "is" : "are"} free.` };
  }

  const grew = recipe.bars > pattern.bars;
  let next = grew ? setPatternBars(project, pattern.id, recipe.bars) : project;
  const bars = Math.max(recipe.bars, pattern.bars);
  const messages: string[] = [];
  const placed: Note[] = [];
  const trackIds: TrackId[] = [];
  recipe.tracks.forEach((recipeTrack, i) => {
    const chosen = free[i];
    const wanted = recipeTrack.instrument;
    const usable = wanted !== undefined && wanted in INSTRUMENT_DEFS && isAvailable(wanted);
    if (!trackHasSource(chosen)) {
      if (usable) next = setTrackInstrument(next, chosen.id, wanted);
      else if (wanted) messages.push(`${wanted} isn't available, so the ${recipeTrack.role} track has no sound yet. Pick one in the Instrument tab.`);
    }
    placed.push(...resolveRecipeTrack(recipeTrack, trackById(next, chosen.id)!, ctx, next.beatsPerBar, bars));
    trackIds.push(chosen.id);
  });

  next = {
    ...next,
    patterns: next.patterns.map((p) => (p.id === pattern.id ? { ...p, notes: { ...p.notes, ...Object.fromEntries(placed.map((n) => [n.id, n])) } } : p)),
  };
  return { ok: true, project: next, patternId: pattern.id, trackIds, grew, messages };
}
