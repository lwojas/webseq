// Pure geometry for the EQ curve editor (components/EqCurveEditor.tsx): the log-frequency / dB
// mapping between graph pixels and EQ parameters, plus reading the flat FX params into webdsp's
// EqBand model. No DOM, so it is unit-tested directly. The response maths itself comes from
// webdsp (eqCurve); this file only decides where things are drawn and what a gesture changes.

import { EQ_MAX_HZ, EQ_MAX_Q, EQ_MIN_HZ, EQ_MIN_Q, EQ_MAX_SHELF_SLOPE, EQ_MIN_SHELF_SLOPE, EqBandType, defaultEqBands, eqBandUses, type EqBand } from "webdsp";

/** Vertical range of the graph, +-dB (the engine accepts +-18). */
export const EQ_VIEW_DB = 18;

export const freqToX = (hz: number, width: number) => (Math.log(hz / EQ_MIN_HZ) / Math.log(EQ_MAX_HZ / EQ_MIN_HZ)) * width;
export const xToFreq = (x: number, width: number) =>
  Math.min(EQ_MAX_HZ, Math.max(EQ_MIN_HZ, EQ_MIN_HZ * Math.pow(EQ_MAX_HZ / EQ_MIN_HZ, x / width)));
export const dbToY = (db: number, height: number) => height / 2 - (db / EQ_VIEW_DB) * (height / 2);
export const yToDb = (y: number, height: number) =>
  Math.min(EQ_VIEW_DB, Math.max(-EQ_VIEW_DB, ((height / 2 - y) / (height / 2)) * EQ_VIEW_DB));

/** Reads the four bands from an EQ FxInstance's flat params (`b<n><Field>`), defaults filling gaps. */
export function bandsFromParams(params: Record<string, number>): EqBand[] {
  const d = defaultEqBands();
  return d.map((def, i) => {
    const p = (f: string, fallback: number) => params[`b${i + 1}${f}`] ?? fallback;
    return {
      enabled: p("On", 0) >= 0.5,
      type: Math.round(p("Type", def.type)) as EqBandType,
      frequency: p("Freq", def.frequency),
      gain: p("Gain", def.gain),
      q: p("Q", def.q),
      shelfSlope: p("ShelfSlope", def.shelfSlope),
      slope: p("Slope", def.slope) >= 18 ? 24 : 12,
    };
  });
}

/** The handle's dB position: the band's gain where the type has one, else the 0 dB line. */
export const handleDb = (b: EqBand) => (eqBandUses(b.type, "gain") ? b.gain : 0);

/** The "width" control a wheel/shift-drag edits: Q for bell/notch, slope S for shelves. */
export function widthParam(type: EqBandType): "q" | "shelfSlope" | null {
  if (eqBandUses(type, "q")) return "q";
  if (eqBandUses(type, "shelfSlope")) return "shelfSlope";
  return null;
}

/** New width value after `steps` of gesture (positive = wider/lower Q). Exponential, clamped. */
export function widenedValue(type: EqBandType, current: number, steps: number): number {
  const k = Math.exp(-steps);
  if (widthParam(type) === "q") return Math.min(EQ_MAX_Q, Math.max(EQ_MIN_Q, current * k));
  return Math.min(EQ_MAX_SHELF_SLOPE, Math.max(EQ_MIN_SHELF_SLOPE, current * k));
}
