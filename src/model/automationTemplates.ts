// Automation shape templates. A template is a pure shape in normalized coordinates: points
// (t, v) with t in 0..1 across the target region and v in 0..1 across the parameter's range.
// It knows nothing about beats, bars or the parameter; applyTemplate() maps it onto a concrete
// region of a sequence and a concrete parameter (log-aware for Hz / seconds ranges), so the same
// template is reusable for sequences of any length and parameters of any range, and deterministic.
//
// Adding a template = adding one entry to AUTOMATION_TEMPLATES; the UI lists whatever is there.
//
// A jump (a step in a pulse or saw) is two points with the same t; applyTemplate separates them
// by the lane's quarter-beat resolution.

import type { AutomationEvent } from "./types";
import { normalizedToValue, type ModParamDef } from "./modulation";

export interface TemplatePoint {
  t: number;
  v: number;
}

export interface TemplateContext {
  /** Length of the target region in bars (cyclic templates scale their cycle count with it). */
  bars: number;
}

export interface AutomationTemplate {
  id: string;
  label: string;
  hint: string;
  /** Fades and swells peak at the parameter's neutral value rather than its maximum when that is a
   * dB gain (so a fade out starts at unity, not at +12 dB). Other parameters use their full range. */
  toNeutral?: boolean;
  points: (ctx: TemplateContext) => TemplatePoint[];
}

/** Where on the sequence a template lands. "all" = the whole sequence, "start" / "end" = its first
 * / last bar. */
export type TemplateRange = "all" | "start" | "end";

const MAX_CYCLES = 64;

/** A repeating shape: `perBar` cycles per bar of the region, `samplesPerCycle` points per cycle. */
function cyclic(ctx: TemplateContext, perBar: number, samplesPerCycle: number, shape: (phase: number) => number): TemplatePoint[] {
  const cycles = Math.max(1, Math.min(MAX_CYCLES, Math.round(ctx.bars * perBar)));
  const pts: TemplatePoint[] = [];
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < samplesPerCycle; i++) {
      const phase = i / samplesPerCycle;
      pts.push({ t: (c + phase) / cycles, v: shape(phase) });
    }
  }
  pts.push({ t: 1, v: shape(0) });
  return pts;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  { id: "rampUp", label: "Ramp up", hint: "Low to high", points: () => [{ t: 0, v: 0 }, { t: 1, v: 1 }] },
  { id: "rampDown", label: "Ramp down", hint: "High to low", points: () => [{ t: 0, v: 1 }, { t: 1, v: 0 }] },
  {
    id: "fadeIn",
    toNeutral: true,
    label: "Fade in",
    hint: "Eased rise from the minimum",
    points: () => Array.from({ length: 9 }, (_, i) => ({ t: i / 8, v: smooth(i / 8) })),
  },
  {
    id: "fadeOut",
    toNeutral: true,
    label: "Fade out",
    hint: "Eased fall to the minimum",
    points: () => Array.from({ length: 9 }, (_, i) => ({ t: i / 8, v: 1 - smooth(i / 8) })),
  },
  {
    id: "swell",
    toNeutral: true,
    label: "Swell",
    hint: "Rise then fall",
    points: () => Array.from({ length: 17 }, (_, i) => ({ t: i / 16, v: smooth(1 - Math.abs(i / 8 - 1)) })),
  },
  {
    id: "wobble",
    label: "Filter wobble",
    hint: "Two smooth sweeps per bar, kept off the extremes",
    points: (ctx) => cyclic(ctx, 2, 8, (p) => 0.25 + 0.6 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p))),
  },
  {
    id: "upDown",
    label: "Up / down",
    hint: "Triangle, two cycles per bar",
    points: (ctx) => cyclic(ctx, 2, 2, (p) => (p < 0.5 ? 0 : 1)),
  },
  {
    id: "sine",
    label: "Sine",
    hint: "One full sine cycle per bar",
    points: (ctx) => cyclic(ctx, 1, 16, (p) => 0.5 - 0.5 * Math.cos(2 * Math.PI * p)),
  },
  {
    id: "pulse",
    label: "Pulse",
    hint: "Square, four per bar",
    points: (ctx) => {
      const cycles = Math.max(1, Math.min(MAX_CYCLES, Math.round(ctx.bars * 4)));
      const pts: TemplatePoint[] = [];
      for (let c = 0; c < cycles; c++) {
        const a = c / cycles;
        const mid = (c + 0.5) / cycles;
        pts.push({ t: a, v: 1 }, { t: mid, v: 1 }, { t: mid, v: 0 }, { t: (c + 1) / cycles, v: 0 });
      }
      return pts;
    },
  },
  {
    id: "sawUp",
    label: "Saw up",
    hint: "Rising ramp, four per bar",
    points: (ctx) => {
      const cycles = Math.max(1, Math.min(MAX_CYCLES, Math.round(ctx.bars * 4)));
      const pts: TemplatePoint[] = [];
      for (let c = 0; c < cycles; c++) pts.push({ t: c / cycles, v: 0 }, { t: (c + 1) / cycles, v: 1 });
      return pts;
    },
  },
  {
    id: "sawDown",
    label: "Saw down",
    hint: "Falling ramp, four per bar",
    points: (ctx) => {
      const cycles = Math.max(1, Math.min(MAX_CYCLES, Math.round(ctx.bars * 4)));
      const pts: TemplatePoint[] = [];
      for (let c = 0; c < cycles; c++) pts.push({ t: c / cycles, v: 1 }, { t: (c + 1) / cycles, v: 0 });
      return pts;
    },
  },
];

export function templateById(id: string): AutomationTemplate | undefined {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id);
}

/** The beats a range covers. A one-bar sequence has a single region whatever the range says. */
export function templateRegion(range: TemplateRange, totalBeats: number, beatsPerBar: number): { from: number; to: number } {
  if (range === "all" || totalBeats <= beatsPerBar) return { from: 0, to: totalBeats };
  return range === "start" ? { from: 0, to: beatsPerBar } : { from: totalBeats - beatsPerBar, to: totalBeats };
}

const RESOLUTION = 0.25; // beats; the lane's point grid (automation.ts)

/** Concrete automation events for `template` over `range` of a sequence, plus the region they
 * replace. Values are mapped through the parameter's range (log for Hz / seconds). Segments are
 * subdivided on log parameters so the straight-line playback between points follows the
 * exponential curve closely. */
export function applyTemplate(
  template: AutomationTemplate,
  range: TemplateRange,
  def: Pick<ModParamDef, "min" | "max" | "scale" | "step" | "default"> & { unit?: string },
  totalBeats: number,
  beatsPerBar: number,
): { from: number; to: number; events: AutomationEvent[] } {
  const { from, to } = templateRegion(range, totalBeats, beatsPerBar);
  const span = to - from;
  const bars = Math.max(1, Math.round(span / beatsPerBar));
  const raw = template.points({ bars });

  // Subdivide on log scales (normalized value moves linearly in t between points).
  const pts: TemplatePoint[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    pts.push(a);
    const b = raw[i + 1];
    if (def.scale === "log" && b && b.t > a.t) {
      const n = Math.min(8, Math.ceil(Math.abs(b.v - a.v) * 8));
      for (let k = 1; k < n; k++) pts.push({ t: a.t + ((b.t - a.t) * k) / n, v: a.v + ((b.v - a.v) * k) / n });
    }
  }

  // Where v = 1 lands: the neutral value for a dB gain under a fade, else the range maximum.
  const top = template.toNeutral && def.unit === "dB" && def.default > def.min && def.default < def.max ? def.default : def.max;
  const span2 = { min: def.min, max: top, scale: def.scale };
  const events: AutomationEvent[] = [];
  let last = -Infinity;
  for (const p of pts) {
    let pos = from + Math.round((p.t * span) / RESOLUTION) * RESOLUTION;
    if (pos <= last) pos = last + RESOLUTION; // a jump: separate by one grid step
    if (pos > to) {
      // A jump at the very end has no room; the final value wins.
      if (events.length > 0 && events[events.length - 1].position === to) events.pop();
      pos = to;
    }
    last = pos;
    let value = normalizedToValue(span2, p.v);
    if (def.step >= 1) value = Math.round(value / def.step) * def.step;
    events.push({ position: pos, value: Math.min(def.max, Math.max(def.min, value)) });
  }
  return { from, to, events };
}
