// One modulation model for every parameter owner. A *parameter* belongs to either an FX
// instance or a track's source (a synth, or a sample); it can receive any number of modulation
// *sources*: at most one automation lane (model/automation.ts) plus a stack of LFOs (below).
//
//   Parameter ── Automation   (a base-value curve over the sequence; resolved here in the app)
//            └─ LFO, LFO ...  (webdsp's engine LFO bank; resolved in the DSP on top of the base)
//
// This file holds what both owners share: the LFO list operations (previously instrument-only),
// the unified parameter description the modulation UI renders from, and the lookup from a lane
// to that description. Nothing here imports React or webdsp.

import { FX_DEFS } from "./fx";
import { INSTRUMENT_DEFS } from "./instruments";
import type { AutomationLane, FxInstance, Track } from "./types";

export { createLfo, DEFAULT_LFO_DIVISION, LFO_MAX_RATE_HZ, LFO_MIN_RATE_HZ, LFO_WAVEFORMS, MAX_TRACK_LFOS, withLfoAdded, withLfoPatched, withLfoRemoved } from "./lfoStack";

// --- parameter description ---

/** What the modulation UI and the automation editor need to know about one parameter,
 * whichever owner it belongs to. */
export interface ModParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  default: number;
  options?: { label: string; value: number }[];
  /** How a value maps onto a curve: "log" for Hz/seconds ranges (equal distance = equal ratio,
   * the same octave domain webdsp's LFOs use), else "linear". */
  scale: "linear" | "log";
}

/** The scale webdsp's modulation layer infers for a control (modulation.h resolveModDomain). */
export function scaleFor(def: { min: number; unit?: string; options?: unknown }): "linear" | "log" {
  return !def.options && def.min > 0 && (def.unit === "Hz" || def.unit === "s") ? "log" : "linear";
}

function describe(p: Omit<ModParamDef, "scale">): ModParamDef {
  return { ...p, scale: scaleFor(p) };
}

/** Sample-track parameters that can be automated. The four envelope stages are the asset's
 * amplitude ADSR (webdsp keeps it per sample, so tracks sharing an asset share the automation's
 * effect); `pitch` is a per-hit transposition, read when each note is scheduled. */
export const SAMPLE_PARAMS: ModParamDef[] = [
  describe({ id: "pitch", label: "Pitch", min: -24, max: 24, step: 0.1, unit: "st", default: 0 }),
  describe({ id: "attack", label: "Attack", min: 0, max: 2, step: 0.005, unit: "s", default: 0 }),
  describe({ id: "decay", label: "Decay", min: 0, max: 2, step: 0.005, unit: "s", default: 0 }),
  describe({ id: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01, default: 1 }),
  describe({ id: "release", label: "Release", min: 0, max: 3, step: 0.01, unit: "s", default: 0.01 }),
];

/** The parameters of an FX instance. */
export function fxParamDefs(fx: Pick<FxInstance, "type">): ModParamDef[] {
  return (FX_DEFS[fx.type]?.params ?? []).map(describe);
}

/** The parameters of a track's source: its synth's controls, or a sample's. */
export function sourceParamDefs(track: Pick<Track, "instrument" | "assetId">): ModParamDef[] {
  if (track.instrument) return (INSTRUMENT_DEFS[track.instrument.kind]?.params ?? []).map(describe);
  if (track.assetId != null) return SAMPLE_PARAMS;
  return [];
}

/** The definition a lane automates, or undefined if its target no longer exists. */
export function laneParamDef(owner: { fx: FxInstance[] } & Partial<Pick<Track, "instrument" | "assetId">>, lane: AutomationLane): ModParamDef | undefined {
  if (lane.fxId != null) {
    const fx = owner.fx.find((f) => f.id === lane.fxId);
    return fx ? fxParamDefs(fx).find((p) => p.id === lane.parameter) : undefined;
  }
  return sourceParamDefs({ instrument: owner.instrument, assetId: owner.assetId ?? null }).find((p) => p.id === lane.parameter);
}

/** Maps a normalized 0..1 position in a parameter's range to a value (log-aware). */
export function normalizedToValue(def: Pick<ModParamDef, "min" | "max" | "scale">, t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return def.scale === "log" ? def.min * Math.pow(def.max / def.min, c) : def.min + c * (def.max - def.min);
}

/** Inverse of normalizedToValue. */
export function valueToNormalized(def: Pick<ModParamDef, "min" | "max" | "scale">, value: number): number {
  const span = def.max - def.min;
  if (span === 0) return 0;
  const t = def.scale === "log" ? Math.log(Math.max(value, def.min) / def.min) / Math.log(def.max / def.min) : (value - def.min) / span;
  return Math.min(1, Math.max(0, t));
}
