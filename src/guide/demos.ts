// The guide's own small demonstrations (hear the scale, hear one note, hear "home"). Expressed as
// scale-relative RecipeTracks, so they resolve through exactly the same degree -> pitch pipeline
// as recipes and play through the same preview path. Never applied to a project.

import { ladderSize } from "../model/scaleDegrees";
import type { ProjectScale } from "../model/scale";
import type { RecipeEvent, RecipeTrack } from "./recipes";

/** Instrument the demos ask for; the preview falls back if the registry lacks it. */
const DEMO_INSTRUMENT = "edge" as const;
const NOTE_LENGTH_STEPS = 3;

/** Degrees as evenly spaced notes: `spacing` steps apart, laid out across bars of `beatsPerBar`. */
function sequence(degrees: number[], beatsPerBar: number, spacing: number): { track: RecipeTrack; bars: number } {
  const events: RecipeEvent[] = degrees.map((degree, i) => {
    const at = i * spacing;
    return { bar: Math.floor(at / beatsPerBar), step: at % beatsPerBar, length: Math.min(NOTE_LENGTH_STEPS, spacing), degree };
  });
  const end = (degrees.length - 1) * spacing + 1;
  return { track: { role: "melody", instrument: DEMO_INSTRUMENT, events }, bars: Math.max(1, Math.ceil(end / beatsPerBar)) };
}

/** Every note of the scale up, ending on home an octave higher. */
export function scaleDemo(ctx: ProjectScale, beatsPerBar: number) {
  const n = ladderSize(ctx);
  return sequence(Array.from({ length: n + 1 }, (_, i) => i + 1), beatsPerBar, 3);
}

/** One scale note (1-based degree). */
export function noteDemo(degree: number, beatsPerBar: number) {
  return sequence([degree], beatsPerBar, 4);
}

/** The tiny "settle back home" pattern: home, third, second, home. */
export const HOME_DEGREES = [1, 3, 2, 1];
export function homeDemo(beatsPerBar: number) {
  return sequence(HOME_DEGREES, beatsPerBar, 4);
}
