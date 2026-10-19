// The LFO stack shared by every modulation owner (instruments and FX): the data defaults and the
// list operations. Kept free of imports from fx.ts / instruments.ts so both can use it.
import type { LfoWaveformId, TrackLfo } from "./types";

/** Mirrors webdsp's per-owner LFO slot count (the engine reports the real limit). */
export const MAX_TRACK_LFOS = 4;
export const LFO_WAVEFORMS: LfoWaveformId[] = ["sine", "triangle", "square", "saw"];
export const LFO_MIN_RATE_HZ = 0.01;
export const LFO_MAX_RATE_HZ = 40;
export const DEFAULT_LFO_DIVISION = "1/4";

export function createLfo(target: string): TrackLfo {
  return { waveform: "sine", sync: false, rateHz: 1, division: DEFAULT_LFO_DIVISION, phase: 0, amount: 0.3, target };
}

/** The list with an LFO (up to MAX_TRACK_LFOS) aimed at `target` appended. */
export function withLfoAdded(lfos: readonly TrackLfo[] | undefined, target: string): TrackLfo[] {
  const list = lfos ?? [];
  return list.length >= MAX_TRACK_LFOS ? [...list] : [...list, createLfo(target)];
}

/** The list with LFO `index` edited; numeric fields clamped to their ranges. */
export function withLfoPatched(lfos: readonly TrackLfo[] | undefined, index: number, patch: Partial<TrackLfo>): TrackLfo[] {
  const list = lfos ?? [];
  const current = list[index];
  if (!current) return [...list];
  const next: TrackLfo = { ...current, ...patch };
  next.rateHz = Math.min(LFO_MAX_RATE_HZ, Math.max(LFO_MIN_RATE_HZ, next.rateHz));
  next.phase = Math.min(1, Math.max(0, next.phase));
  next.amount = Math.min(1, Math.max(-1, next.amount));
  return list.map((l, n) => (n === index ? next : l));
}

export function withLfoRemoved(lfos: readonly TrackLfo[] | undefined, index: number): TrackLfo[] {
  return (lfos ?? []).filter((_, n) => n !== index);
}

