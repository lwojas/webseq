// Scale-aware note entry: the one place the project's key changes what gets *written*. Only a
// note that is just being created is affected, and only when the project has Snap on; existing
// notes are never touched (scale.ts's promise), and the Track Editor's pitch menu still offers
// every semitone to the user who wants a chromatic note (it only filters while Snap is on, and
// always keeps the note's current value).

import { nearestScaleOffset, scaleOf } from "./scale";
import { effectiveSampleMode } from "./chop";
import { rootMidiNote } from "./instruments";
import { setNotePitch } from "./project";
import type { PatternId, Project, TrackId } from "./types";

/** After `after` was produced from `before` by adding one note on `trackId`, moves that note's
 * pitch to the nearest in-scale offset when Snap is on. Returns `after` unchanged otherwise
 * (no snap, chop track whose pitch is a slice index, nothing added, or already in scale). */
export function snapAddedNoteToScale(before: Project, after: Project, patternId: PatternId, trackId: TrackId): Project {
  const ctx = scaleOf(after);
  if (!ctx.snap) return after;
  const track = after.tracks.find((t) => t.id === trackId);
  if (!track || effectiveSampleMode(track) === "chop") return after;
  const old = before.patterns.find((p) => p.id === patternId)?.notes ?? {};
  const added = Object.values(after.patterns.find((p) => p.id === patternId)?.notes ?? {}).find((n) => !(n.id in old));
  if (!added) return after;
  const pitch = nearestScaleOffset(ctx, rootMidiNote(track), added.pitch ?? 0);
  return pitch === (added.pitch ?? 0) ? after : setNotePitch(after, patternId, added.id, pitch);
}
