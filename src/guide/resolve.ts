// Recipe -> concrete webseq note data. The pipeline the guide promises:
//
//   Recipe (scale degrees)  ->  project scale  ->  ladder index  ->  Note (pitch / NoteChord)
//
// Everything musical goes through model/scaleDegrees.ts (degree -> pitch) and model/chord.ts
// (chords), so a recipe chord is *the same primitive* the Track Editor's Chord mode stores, and
// the project scale stays the single source of truth. The output is ordinary Notes; once
// applied they are indistinguishable from hand-entered ones.

import { chordPitchOffsets, chordShape, type NoteChord } from "../model/chord";
import { rootMidiNote } from "../model/instruments";
import { ROOT_NAMES, getScaleNotes, type ProjectScale } from "../model/scale";
import { degreeToIndex, ladderScale, ladderSize } from "../model/scaleDegrees";
import type { Note, Track } from "../model/types";
import { DEFAULT_RECIPE_VELOCITY, type RecipeTrack } from "./recipes";

let counter = 0;
function noteId(): string {
  counter += 1;
  return `note-r${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The recipe track's events as Notes on `track` under scale `ctx`. Events outside the recipe's
 * `bars` (or past the end of a bar) are dropped and lengths are clipped to their bar, so the
 * output always fits the sequence it is sized for and never overlaps itself. */
export function resolveRecipeTrack(recipeTrack: RecipeTrack, track: Track, ctx: ProjectScale, beatsPerBar: number, bars: number): Note[] {
  const notes: Note[] = [];
  for (const event of recipeTrack.events) {
    if (event.bar < 0 || event.bar >= bars || event.step < 0 || event.step >= beatsPerBar) continue;
    const start = event.bar * beatsPerBar + event.step;
    const duration = Math.min(event.length, beatsPerBar - event.step);
    if (duration <= 0) continue;
    const note: Note = { id: noteId(), trackId: track.id, start, duration, velocity: event.velocity ?? DEFAULT_RECIPE_VELOCITY };
    const index = degreeToIndex(ctx, event.degree, event.octave ?? 0);
    const shape = event.chord ? chordShape(event.chord) : undefined;
    if (shape) {
      const chord: NoteChord = { root: index, degrees: [...shape.degrees] };
      note.chord = chord;
    } else {
      const offset = chordPitchOffsets(ctx, rootMidiNote(track), { root: index, degrees: [0] })[0];
      if (offset) note.pitch = offset;
    }
    notes.push(note);
  }
  return notes;
}

/** Notes of the scale as the guide shows them: pitch-class names in scale order from the root
 * ("A A# C D E F G" for A Phrygian), using the app's own note names. A chromatic project shows
 * the Major scale on its root, which is what chords and recipes use there. */
export function scaleNoteNames(ctx: ProjectScale): string[] {
  const used = ladderScale(ctx);
  return getScaleNotes(used.root, used.scale).map((pc) => ROOT_NAMES[pc]);
}

/** The scale-relative shape of a recipe track, as the user reads it: "1 → 3 → 2 → 1 …" for notes,
 * "1+3+5 → 6+1+3 …" for chords. A figure that repeats is shown once with an ellipsis (held chords
 * repeated bar after bar count as one). */
export function describeIdea(recipeTrack: RecipeTrack, ctx: ProjectScale): string {
  const n = ladderSize(ctx);
  const ordered = [...recipeTrack.events].sort((a, b) => a.bar - b.bar || a.step - b.step);
  let labels = ordered.map((e) => {
    const shape = e.chord ? chordShape(e.chord) : undefined;
    return shape ? shape.degrees.map((d) => ((e.degree - 1 + d) % n) + 1).join("+") : String(((e.degree - 1) % n) + 1);
  });
  if (ordered.some((e) => e.chord)) labels = labels.filter((l, i) => l !== labels[i - 1]);
  for (let size = 1; size <= labels.length / 2; size++) {
    if (labels.length % size === 0 && labels.every((l, i) => l === labels[i % size])) {
      return `${labels.slice(0, size).join(" → ")} …`;
    }
  }
  return labels.slice(0, 8).join(" → ") + (labels.length > 8 ? " …" : "");
}

/** Name of the home note ("A"), for "A is home". */
export function homeName(ctx: ProjectScale): string {
  return ROOT_NAMES[ladderScale(ctx).root];
}
