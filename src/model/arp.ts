// Per-track arpeggiator: pure, deterministic note *generation* that runs between the stored
// notes and audio/compile.ts, so webdsp never knows an arp exists and a track with the arp off
// takes exactly the pre-arp path (compile.ts only calls in here when `enabled`).
//
// Model. A track's notes are monophonic (they cannot overlap), so there is no stored chord. The
// arp reads them two ways at once:
//   * Pitch pool — the pitches of the track's notes within one BAR are the chord the arp cycles.
//   * Gate windows — each note is a window [start, start+duration): the arp plays inside it,
//     first step on the note's own start, then every `rate`. Placement therefore keeps its
//     rhythm and its rests; the arp only decides *what* sounds on each step.
// Runs are clipped at bar lines, so each bar is an independent group: its pool, its step
// counter and its random sequence start fresh, which keeps a pattern loop, a queue change or a
// shorter polymetric loop deterministic with no state carried between iterations.
//
// Pure data + functions (no React, no webdsp). webtracker has a port (src/model/arp.js) with
// the same test vectors. Positions/lengths are in grid steps (16ths).

import type { Note, Track } from "./types";

export type ArpMode = "up" | "down" | "updown" | "downup" | "random" | "played" | "pattern";
export type ArpVelocityMode = "source" | "pattern" | "accent";

export interface ArpVelocity {
  /** source: the gate note's own velocity. pattern: the step pattern's level (blended with the
   * source by `amount`). accent: the source scaled down by the pattern (amount = how far). */
  mode: ArpVelocityMode;
  /** 0..1 depth of the pattern. */
  amount: number;
  /** 1..16 levels, 0..1 each, cycled per arp step. An array of numbers today; kept as the one
   * place a future per-step field (gate, accent) would grow into objects. */
  steps: number[];
}

export interface TrackArp {
  enabled: boolean;
  mode: ArpMode;
  /** Id into ARP_PATTERNS, used when mode === "pattern". */
  pattern: string;
  /** Id into ARP_RATES. */
  rate: string;
  /** Source pool repeated over 1..4 octaves. */
  octaves: number;
  /** Fraction of a step the generated note sounds for, 0.05..1. */
  gate: number;
  velocity: ArpVelocity;
}

export const ARP_MODES: { id: ArpMode; label: string }[] = [
  { id: "up", label: "Up" },
  { id: "down", label: "Down" },
  { id: "updown", label: "Up/Down" },
  { id: "downup", label: "Down/Up" },
  { id: "random", label: "Random" },
  { id: "played", label: "As played" },
  { id: "pattern", label: "Pattern" },
];

/** Step length in grid steps (a step = a 16th note). Triplets and dotted values included. */
export const ARP_RATES: { id: string; label: string; steps: number }[] = [
  { id: "1/1", label: "1/1", steps: 16 },
  { id: "1/2", label: "1/2", steps: 8 },
  { id: "1/4.", label: "1/4.", steps: 6 },
  { id: "1/4", label: "1/4", steps: 4 },
  { id: "1/4T", label: "1/4T", steps: 8 / 3 },
  { id: "1/8.", label: "1/8.", steps: 3 },
  { id: "1/8", label: "1/8", steps: 2 },
  { id: "1/8T", label: "1/8T", steps: 4 / 3 },
  { id: "1/16.", label: "1/16.", steps: 1.5 },
  { id: "1/16", label: "1/16", steps: 1 },
  { id: "1/16T", label: "1/16T", steps: 2 / 3 },
  { id: "1/32", label: "1/32", steps: 0.5 },
];
export const DEFAULT_ARP_RATE = "1/16";

/** Note-order patterns. Each value is a 1-based index into the arp's pitch pool (low to high,
 * across the octave range); an index past the pool wraps round it; 0 is a rest (the step is
 * skipped but still counts, so the rhythm holds). */
export const ARP_PATTERNS: { id: string; label: string; steps: number[] }[] = [
  { id: "1232", label: "1 2 3 2", steps: [1, 2, 3, 2] },
  { id: "1324", label: "1 3 2 4", steps: [1, 3, 2, 4] },
  { id: "1213", label: "1 2 1 3", steps: [1, 2, 1, 3] },
  { id: "1342", label: "1 3 4 2", steps: [1, 3, 4, 2] },
  { id: "1323", label: "1 3 2 3", steps: [1, 3, 2, 3] },
  { id: "1123", label: "1 1 2 3", steps: [1, 1, 2, 3] },
  { id: "push", label: "1 · 2 3", steps: [1, 0, 2, 3] },
  { id: "offbeat", label: "· 1 · 2", steps: [0, 1, 0, 2] },
  { id: "gallop", label: "1 1 2 · 3 3 2 ·", steps: [1, 1, 2, 0, 3, 3, 2, 0] },
  { id: "tresillo", label: "1 · · 2 · · 3 ·", steps: [1, 0, 0, 2, 0, 0, 3, 0] },
];
export const DEFAULT_ARP_PATTERN = "1232";

/** Velocity step presets (levels 0..1). */
export const ARP_VELOCITY_PRESETS: { id: string; label: string; steps: number[] }[] = [
  { id: "flat", label: "Flat", steps: [1, 1, 1, 1] },
  { id: "pulse", label: "Pulse", steps: [1, 0.55, 0.75, 0.5] },
  { id: "groove", label: "Groove", steps: [0.79, 0.55, 0.67, 0.47] },
  { id: "syncopated", label: "Syncopated", steps: [1, 0.4, 0.7, 0.4, 0.9, 0.4, 0.7, 0.4] },
  { id: "rise", label: "Rise", steps: [0.4, 0.55, 0.7, 0.85, 1, 0.85, 0.7, 0.55] },
];

export const MIN_ARP_OCTAVES = 1;
export const MAX_ARP_OCTAVES = 4;
export const MIN_ARP_GATE = 0.05;
export const MAX_ARP_VELOCITY_STEPS = 16;
export const MIN_ARP_VELOCITY_STEPS = 1;

export function createArp(): TrackArp {
  return {
    enabled: false,
    mode: "up",
    pattern: DEFAULT_ARP_PATTERN,
    rate: DEFAULT_ARP_RATE,
    octaves: 1,
    gate: 0.8,
    velocity: { mode: "source", amount: 1, steps: [...ARP_VELOCITY_PRESETS[2].steps] },
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** A complete, clamped arp from partial/untrusted data. An absent arp is the disabled default. */
export function normalizeArp(raw: Partial<TrackArp> | null | undefined): TrackArp {
  const base = createArp();
  if (!raw || typeof raw !== "object") return base;
  const rawVel: Partial<ArpVelocity> = raw.velocity && typeof raw.velocity === "object" ? raw.velocity : {};
  const steps = Array.isArray(rawVel.steps) && rawVel.steps.length > 0
    ? rawVel.steps.slice(0, MAX_ARP_VELOCITY_STEPS).map((s) => Math.round(clamp(s, 0, 1) * 100) / 100)
    : base.velocity.steps;
  return {
    enabled: raw.enabled === true,
    mode: ARP_MODES.some((m) => m.id === raw.mode) ? (raw.mode as ArpMode) : base.mode,
    pattern: ARP_PATTERNS.some((p) => p.id === raw.pattern) ? (raw.pattern as string) : base.pattern,
    rate: ARP_RATES.some((r) => r.id === raw.rate) ? (raw.rate as string) : base.rate,
    octaves: Math.round(clamp(raw.octaves ?? base.octaves, MIN_ARP_OCTAVES, MAX_ARP_OCTAVES)),
    gate: Math.round(clamp(raw.gate ?? base.gate, MIN_ARP_GATE, 1) * 100) / 100,
    velocity: {
      mode: rawVel.mode === "pattern" || rawVel.mode === "accent" ? rawVel.mode : "source",
      amount: Math.round(clamp(rawVel.amount ?? base.velocity.amount, 0, 1) * 100) / 100,
      steps,
    },
  };
}

/** The track's arp, or the disabled default (a track from a project saved before arps). */
export function arpOf(track: Pick<Track, "arp">): TrackArp {
  return normalizeArp(track.arp);
}

export function isArpActive(track: Pick<Track, "arp">): boolean {
  return track.arp?.enabled === true;
}

/** Edits a track's arp (creating it, disabled, on first edit). `velocity` patches merge. */
export function patchArp(arp: TrackArp, patch: Partial<Omit<TrackArp, "velocity">> & { velocity?: Partial<ArpVelocity> }): TrackArp {
  const { velocity, ...rest } = patch;
  return normalizeArp({ ...arp, ...rest, velocity: velocity ? { ...arp.velocity, ...velocity } : arp.velocity });
}

export function setTrackArp<P extends { tracks: Track[] }>(
  project: P,
  trackId: string,
  patch: Partial<Omit<TrackArp, "velocity">> & { velocity?: Partial<ArpVelocity> },
): P {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, arp: patchArp(arpOf(t), patch) } : t)) };
}

// --- generation ---

/** One source note, as the arp sees it: a gate window and the pitch it contributes. */
export interface ArpRun {
  start: number;
  length: number;
  pitch: number;
  /** 0..1 */
  velocity: number;
}

export interface ArpStep {
  start: number;
  length: number;
  pitch: number;
  /** 0..1 */
  velocity: number;
  /** Index into the runs this step was generated inside. */
  run: number;
  /** Position in the group's step sequence (rests included). */
  index: number;
}

const EPS = 1e-9;

/** Small deterministic PRNG (mulberry32): the same group index always yields the same sequence,
 * so a "random" arp replays identically every loop and every render. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function arpRateSteps(rateId: string): number {
  return (ARP_RATES.find((r) => r.id === rateId) ?? ARP_RATES.find((r) => r.id === DEFAULT_ARP_RATE)!).steps;
}

export function arpPatternSteps(patternId: string): number[] {
  return (ARP_PATTERNS.find((p) => p.id === patternId) ?? ARP_PATTERNS[0]).steps;
}

/** The pitch pool the modes cycle: sorted ascending (or in play order for "As played"),
 * repeated upward across the octave range. */
export function arpPool(arp: TrackArp, runs: ArpRun[]): number[] {
  const played = runs.map((r) => r.pitch);
  const base = arp.mode === "played" ? played : [...new Set(played)].sort((a, b) => a - b);
  const out: number[] = [];
  for (let o = 0; o < arp.octaves; o++) for (const p of base) out.push(p + 12 * o);
  return out;
}

/** Indices into the pool for the cyclic modes (up/down/updown/downup/played). The turning
 * points are not repeated: up/down over 1 2 3 is 1 2 3 2, not 1 2 3 3 2 1. */
function cycleOrder(mode: ArpMode, n: number): number[] {
  const up = Array.from({ length: n }, (_, i) => i);
  const down = [...up].reverse();
  if (mode === "down") return down;
  if (mode === "updown") return n > 2 ? [...up, ...down.slice(1, -1)] : up;
  if (mode === "downup") return n > 2 ? [...down, ...up.slice(1, -1)] : down;
  return up;
}

/** Velocity of the k-th arp step given its source note's velocity (all 0..1). */
export function arpStepVelocity(source: number, v: ArpVelocity, k: number): number {
  if (v.mode === "source" || v.steps.length === 0) return source;
  const level = v.steps[k % v.steps.length];
  const out = v.mode === "pattern" ? source + (level - source) * v.amount : source * (1 - v.amount * (1 - level));
  return clamp(out, 0, 1);
}

/** Expands one group (a bar) of source runs into arp steps. `runs` must be sorted by start with
 * lengths already clipped to the group; `groupIndex` seeds the random mode. Empty in, empty out. */
export function expandArpGroup(arp: TrackArp, runs: ArpRun[], groupIndex = 0): ArpStep[] {
  if (runs.length === 0) return [];
  const pool = arpPool(arp, runs);
  const n = pool.length;
  const stepLen = arpRateSteps(arp.rate);
  const order = cycleOrder(arp.mode, n);
  const patternSteps = arpPatternSteps(arp.pattern);
  const rng = mulberry32((groupIndex + 1) * 2654435761);
  const out: ArpStep[] = [];
  let k = 0;
  runs.forEach((run, runIndex) => {
    const end = run.start + run.length;
    for (let j = 0; ; j++) {
      const start = run.start + j * stepLen;
      if (start >= end - EPS) break;
      let pitch: number | null;
      if (arp.mode === "pattern") {
        const p = patternSteps[k % patternSteps.length];
        pitch = p === 0 ? null : pool[(p - 1) % n];
      } else if (arp.mode === "random") {
        pitch = pool[Math.floor(rng() * n)];
      } else {
        pitch = pool[order[k % order.length]];
      }
      if (pitch !== null) {
        out.push({
          start,
          length: Math.max(1 / 64, Math.min(stepLen * arp.gate, end - start)),
          pitch,
          velocity: arpStepVelocity(run.velocity, arp.velocity, k),
          run: runIndex,
          index: k,
        });
      }
      k++;
    }
  });
  return out;
}

// --- webseq adapter: Note[] -> Note[] ---

/** Replaces a track's notes with the arp's generated notes for one pattern. Notes are grouped
 * by bar and each run is clipped at its bar line and at the pattern end. Generated notes keep
 * the source note's `lfo` participation and get ids derived from it (`<id>~<n>`), so they are
 * stable between compiles. The input is untouched. */
export function arpTrackNotes(notes: Note[], arp: TrackArp, beatsPerBar: number, totalBeats: number): Note[] {
  if (notes.length === 0 || beatsPerBar <= 0) return [];
  // A note longer than a bar is a run in every bar it sounds in: the part after its own bar
  // enters the later bars' groups as a run starting on that bar line (a carried piece).
  interface Piece { src: Note; start: number; end: number; carried: boolean }
  const groups = new Map<number, Piece[]>();
  for (const note of notes) {
    const first = Math.floor(note.start / beatsPerBar);
    const end = Math.min(note.start + note.duration, totalBeats);
    const last = Math.max(first, Math.ceil(end / beatsPerBar - 1e-9) - 1);
    for (let bar = first; bar <= last; bar++) {
      const barStart = bar * beatsPerBar;
      const piece: Piece = {
        src: note,
        start: Math.max(note.start, barStart),
        end: Math.min(end, barStart + beatsPerBar),
        carried: bar > first,
      };
      if (bar > first && piece.end <= piece.start) continue;
      const list = groups.get(bar);
      if (list) list.push(piece);
      else groups.set(bar, [piece]);
    }
  }
  const out: Note[] = [];
  for (const bar of [...groups.keys()].sort((a, b) => a - b)) {
    const pieces = groups.get(bar)!.sort((a, b) => a.start - b.start);
    const runs: ArpRun[] = pieces.map((p) => ({
      start: p.start,
      length: Math.max(0, p.end - p.start),
      pitch: p.src.pitch ?? 0,
      velocity: p.src.velocity,
    }));
    for (const step of expandArpGroup(arp, runs, bar)) {
      const { src, carried } = pieces[step.run];
      const note: Note = {
        id: carried ? `${src.id}~b${bar}~${step.index}` : `${src.id}~${step.index}`,
        trackId: src.trackId,
        start: step.start,
        duration: step.length,
        velocity: step.velocity,
      };
      const pitch = Math.max(-48, Math.min(48, step.pitch));
      if (pitch) note.pitch = pitch;
      if (src.lfo) note.lfo = src.lfo;
      if (src.ratchet) note.ratchet = src.ratchet;
      out.push(note);
    }
  }
  return out;
}
