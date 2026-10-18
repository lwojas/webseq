// Cue points for chop playback. The pure cue maths (normalise/add/move/remove cues, conversion to
// engine regions) is webdsp's — see its docs/sample-chop.md; this file keeps what is webseq's own:
// the per-track mode default, a note-range-driven slice cap, and the asset helpers. An Asset
// stores its cue points as fractions (0..1) of its length — interior slice boundaries only — so
// N cues make N+1 contiguous slices. audio/busSync.ts converts them to frame regions.

import { addCue as dspAddCue, evenCues as dspEvenCues, normalizeCues as dspNormalizeCues, sliceCount as dspSliceCount } from "webdsp";
import type { Asset, SampleMode, Track } from "./types";

export { cueRegions, moveCue, removeCue, MIN_SLICE } from "webdsp";

/** Most slices a sample may have: every slice must be reachable from a note's pitch (0..48). */
export const MAX_SLICES = 49;

export const DEFAULT_SAMPLE_MODE: SampleMode = "chromatic";

/** `track.sampleMode`, defaulted for a track that predates the field (see Track.sampleMode). */
export function effectiveSampleMode(track: Pick<Track, "sampleMode">): SampleMode {
  return track.sampleMode ?? DEFAULT_SAMPLE_MODE;
}

export const normalizeCues = (cues: readonly number[]): number[] => dspNormalizeCues(cues, MAX_SLICES);
export const evenCues = (slices: number): number[] => dspEvenCues(slices, MAX_SLICES);
export const addCue = (cues: readonly number[], at: number): number[] => dspAddCue(cues, at, MAX_SLICES);

export function sliceCount(asset: Pick<Asset, "cues"> | null | undefined): number {
  return dspSliceCount(asset?.cues);
}

/** Frame count of an asset as the engine sees it. */
export function assetLengthFrames(asset: Pick<Asset, "duration" | "sampleRate">): number {
  return Math.round(asset.duration * asset.sampleRate);
}
