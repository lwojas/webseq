// The pitch values a step's Pitch dropdown offers. Shared by the Track Editor (which lists them)
// and the Track LFO's note/slice target (which steps through them), so the LFO plays exactly what
// the dropdown could have been set to.
import { isOffsetInScale, type ProjectScale } from "./scale";
import { MAX_NOTE_PITCH, MIN_NOTE_PITCH } from "./notes";

const PITCH_OFFSETS = Array.from({ length: MAX_NOTE_PITCH - MIN_NOTE_PITCH + 1 }, (_, i) => MAX_NOTE_PITCH - i);
/** Audible band offered in the dropdown (the engine would happily play outside it). */
const MIN_AUDIBLE_HZ = 20;
const MAX_AUDIBLE_HZ = 16000;

/** Offsets to offer: one per slice for a chop track, all of them for a sample, only the audible
 * span for a synth root, always including the note's current value. Chop is ascending, the rest
 * descending (top of the menu = highest). */
export function pitchOptions(root: number | null, current: number, slices: number | null, scale: ProjectScale): number[] {
  // Chop track: one option per slice (at least one), plus the current value so a stale step shows.
  if (slices !== null) return PITCH_OFFSETS.filter((p) => p >= 0 && (p < Math.max(1, slices) || p === current)).reverse();
  // With Snap on only the key's notes are offered (the note's current value always stays, so an
  // existing off-scale note is never hidden or silently changed).
  const keep = (p: number) => p === current || !scale.snap || isOffsetInScale(scale, root, p);
  if (root === null) return PITCH_OFFSETS.filter(keep);
  return PITCH_OFFSETS.filter((p) => {
    const hz = 440 * Math.pow(2, (root + p - 69) / 12);
    return keep(p) && (p === current || (hz >= MIN_AUDIBLE_HZ && hz <= MAX_AUDIBLE_HZ));
  });
}
