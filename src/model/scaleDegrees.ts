// Scale-relative pitch math: the one place a *scale degree* becomes a MIDI note. Chords
// (model/chord.ts) and Musical Guide recipes (guide/) both resolve through here, so the project
// scale stays the single source of truth and nothing else re-derives intervals.
//
// The "ladder". A scale of n notes is an infinite ascending ladder of pitches: ladder index k is
// `base + 12 * floor(k / n) + intervals[k mod n]`, where `base` is a tonic (a MIDI note whose
// pitch class is the scale root). Index 0 is the tonic itself, 1 the second scale note, n the
// tonic an octave up, -1 the scale note just below the tonic. Negative and >= n indices wrap by
// octave, which is how "9" (a second above the octave) is simply index 8 of a 7-note scale.
//
// Pure data + functions: no React, no webdsp.

import { isChromatic, scaleDef, type ProjectScale } from "./scale";

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** The scale chords and recipes stack on. A chromatic project (the default) has no useful
 * "every second note" (that would be a whole-tone run), so it falls back to Major on the same
 * root. Every other scale is used as-is. */
export function ladderScale(ctx: ProjectScale): ProjectScale {
  return isChromatic(ctx) ? { ...ctx, scale: "major" } : ctx;
}

/** Notes per octave of the ladder (7 for a heptatonic scale, 5 for a pentatonic one). */
export function ladderSize(ctx: ProjectScale): number {
  return scaleDef(ladderScale(ctx).scale).intervals.length;
}

/** The highest MIDI note <= `midi` whose pitch class is the scale root: the tonic that ladder
 * index 0 sits on for a track whose reference note is `midi`. */
export function tonicAtOrBelow(ctx: ProjectScale, midi: number): number {
  const m = Math.round(midi);
  return m - mod(m - ctx.root, 12);
}

/** MIDI note of ladder index `index` above `baseTonic` (a tonic, see tonicAtOrBelow). */
export function ladderMidi(ctx: ProjectScale, baseTonic: number, index: number): number {
  const intervals = scaleDef(ladderScale(ctx).scale).intervals;
  const n = intervals.length;
  return baseTonic + 12 * Math.floor(index / n) + intervals[mod(index, n)];
}

/** Ladder index of the scale note closest to `midi` (a tie goes down, like getNearestScaleNote). */
export function nearestLadderIndex(ctx: ProjectScale, baseTonic: number, midi: number): number {
  const n = ladderSize(ctx);
  const guess = Math.round(((midi - baseTonic) / 12) * n);
  let best = guess;
  let bestDistance = Infinity;
  for (let k = guess - n; k <= guess + n; k++) {
    const distance = Math.abs(ladderMidi(ctx, baseTonic, k) - midi);
    if (distance < bestDistance || (distance === bestDistance && k < best)) {
      best = k;
      bestDistance = distance;
    }
  }
  return best;
}

/** 1-based degree label of a ladder index within its octave (index 0 -> 1, 2 -> 3, 7 -> 1 again). */
export function degreeOfIndex(ctx: ProjectScale, index: number): number {
  return mod(index, ladderSize(ctx)) + 1;
}

/** Pitch-class name of the ladder note at `index` (e.g. "Bb"-style names come from ROOT_NAMES). */
export function ladderPitchClass(ctx: ProjectScale, index: number): number {
  return mod(ladderMidi(ctx, tonicAtOrBelow(ctx, 60), index), 12);
}

/** Scale-relative recipe pitch: 1-based `degree` (1 = home) plus whole `octave`s, as a ladder
 * index. Degree 9 is degree 2 an octave up, so degree and octave stay interchangeable. */
export function degreeToIndex(ctx: ProjectScale, degree: number, octave = 0): number {
  return degree - 1 + octave * ladderSize(ctx);
}
