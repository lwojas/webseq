// Cue points for chop playback. Pure model logic: no React, no webdsp. An Asset stores its cue
// points as fractions (0..1) of its length — interior slice boundaries only — so they survive a
// reload at a different engine sample rate. Slices are contiguous: boundaries [0, ...cues, 1]
// give N cues -> N+1 slices. audio/busSync.ts converts them to webdsp frame regions.

import type { Asset, SampleMode, Track } from "./types";

/** Smallest slice, as a fraction of the sample; keeps neighbouring cues from collapsing. */
export const MIN_SLICE = 0.002;
/** Most slices a sample may have (every slice must be reachable from a note's pitch, 0..48). */
export const MAX_SLICES = 49;

export const DEFAULT_SAMPLE_MODE: SampleMode = "chromatic";

/** `track.sampleMode`, defaulted for a track that predates the field (see Track.sampleMode). */
export function effectiveSampleMode(track: Pick<Track, "sampleMode">): SampleMode {
  return track.sampleMode ?? DEFAULT_SAMPLE_MODE;
}

/** Sorted, de-duplicated, in-range cues with every slice at least MIN_SLICE wide, capped to
 * MAX_SLICES slices. */
export function normalizeCues(cues: readonly number[]): number[] {
  const sorted = cues.filter((c) => Number.isFinite(c)).map((c) => Math.min(1, Math.max(0, c))).sort((a, b) => a - b);
  const result: number[] = [];
  let prev = 0;
  for (const c of sorted) {
    if (c - prev < MIN_SLICE || 1 - c < MIN_SLICE) continue;
    if (result.length >= MAX_SLICES - 1) break;
    result.push(c);
    prev = c;
  }
  return result;
}

/** Evenly spaced cues giving `slices` equal slices (1 = no cues). */
export function evenCues(slices: number): number[] {
  const n = Math.min(MAX_SLICES, Math.max(1, Math.round(slices)));
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

export function sliceCount(asset: Pick<Asset, "cues"> | null | undefined): number {
  return asset?.cues && asset.cues.length > 0 ? asset.cues.length + 1 : 0;
}

/** Adds a cue at `at` (fraction). A position too close to an existing cue or an edge is ignored. */
export function addCue(cues: readonly number[], at: number): number[] {
  return normalizeCues([...cues, at]);
}

/** Moves cue `index` to `to`, clamped between its neighbours so cues never cross. */
export function moveCue(cues: readonly number[], index: number, to: number): number[] {
  if (index < 0 || index >= cues.length) return [...cues];
  const lo = (index > 0 ? cues[index - 1] : 0) + MIN_SLICE;
  const hi = (index < cues.length - 1 ? cues[index + 1] : 1) - MIN_SLICE;
  const next = [...cues];
  next[index] = Math.min(hi, Math.max(lo, to));
  return next;
}

export function removeCue(cues: readonly number[], index: number): number[] {
  return cues.filter((_, i) => i !== index);
}

/** The webdsp regions (frame offsets) for `cues` over a sample of `length` frames. */
export function cueRegions(cues: readonly number[], length: number): { start: number; end: number }[] {
  const bounds = [0, ...cues, 1].map((f) => Math.round(f * length));
  return bounds.slice(0, -1).map((start, i) => ({ start, end: bounds[i + 1] }));
}

/** Frame count of an asset as the engine sees it. */
export function assetLengthFrames(asset: Pick<Asset, "duration" | "sampleRate">): number {
  return Math.round(asset.duration * asset.sampleRate);
}
