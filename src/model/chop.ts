// Cue points for chop playback. The pure cue maths (normalise/add/move/remove cues, conversion to
// engine regions) is webdsp's — see its docs/sample-chop.md; this file keeps what is webseq's own:
// the per-track mode default, a note-range-driven slice cap, and the asset helpers. An Asset
// stores its cue points as fractions (0..1) of its length — interior slice boundaries only — so
// N cues make N+1 contiguous slices. audio/busSync.ts converts them to frame regions.

import { addCue as dspAddCue, moveCue as dspMoveCue, normalizeCues as dspNormalizeCues, sliceCount as dspSliceCount, MIN_SLICE } from "webdsp";
import type { Asset, SampleMode, Track } from "./types";

export { removeCue, MIN_SLICE } from "webdsp";

/** Most slices a sample may have: every slice must be reachable from a note's pitch (0..48). */
export const MAX_SLICES = 49;

export const DEFAULT_SAMPLE_MODE: SampleMode = "chromatic";

/** `track.sampleMode`, defaulted for a track that predates the field (see Track.sampleMode). */
export function effectiveSampleMode(track: Pick<Track, "sampleMode">): SampleMode {
  return track.sampleMode ?? DEFAULT_SAMPLE_MODE;
}

// The chop start marker: where slice 1 begins (Asset.chopStart, a fraction, default 0), so leading
// silence can be skipped. Cues live strictly after it, so every cue helper below takes it.

/** `start` clamped to [0, first cue (or the end) - MIN_SLICE]; non-finite means 0. */
export function normalizeChopStart(start: number | undefined, cues: readonly number[]): number {
  if (start === undefined || !Number.isFinite(start)) return 0;
  return Math.min((cues[0] ?? 1) - MIN_SLICE, Math.max(0, start));
}

export const normalizeCues = (cues: readonly number[], start = 0): number[] =>
  dspNormalizeCues(cues.filter((c) => c >= start + MIN_SLICE), MAX_SLICES);
/** `slices` equal slices spanning start..1 (1 = no cues). */
export const evenCues = (slices: number, start = 0): number[] => {
  const n = Math.min(MAX_SLICES, Math.max(1, Math.round(slices)));
  return Array.from({ length: n - 1 }, (_, i) => start + ((1 - start) * (i + 1)) / n);
};
export const addCue = (cues: readonly number[], at: number, start = 0): number[] =>
  at < start + MIN_SLICE ? [...cues] : dspAddCue(cues, at, MAX_SLICES);
/** Moves cue `index`; the first cue cannot cross the start marker. */
export function moveCue(cues: readonly number[], index: number, to: number, start = 0): number[] {
  return dspMoveCue(cues, index, index === 0 ? Math.max(to, start + MIN_SLICE) : to);
}
/** Moves the start marker, clamped before the first cue. */
export const moveChopStart = (cues: readonly number[], to: number): number => normalizeChopStart(to, cues);

/** Frame regions for slices start..cue..cue..1 over a sample of `length` frames. */
export function cueRegions(cues: readonly number[], length: number, start = 0): { start: number; end: number }[] {
  const bounds = [start, ...cues, 1].map((f) => Math.round(f * length));
  return bounds.slice(0, -1).map((from, i) => ({ start: from, end: bounds[i + 1] }));
}

export function sliceCount(asset: Pick<Asset, "cues"> | null | undefined): number {
  return dspSliceCount(asset?.cues);
}

/** Frame count of an asset as the engine sees it. */
export function assetLengthFrames(asset: Pick<Asset, "duration" | "sampleRate">): number {
  return Math.round(asset.duration * asset.sampleRate);
}
