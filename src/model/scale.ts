// Project-level musical scale: a *context*, not a constraint. It tells the note-entry UI which
// pitches belong to the key (to emphasise them and optionally snap new entries to them) and
// nothing else — changing it never rewrites a note, and playback reads it only to resolve chord
// notes (model/chord.ts); plain notes are untouched. Defined by
// semitone intervals so adding a scale is one table row. Pure data + functions: no React, no
// webdsp. webtracker carries a line-for-line port (src/model/scale.js) with the same test
// vectors, because the two apps share no package.

export interface ScaleDef {
  id: string;
  label: string;
  /** Semitones above the root, ascending, starting at 0. */
  intervals: number[];
}

export const SCALES: ScaleDef[] = [
  { id: "major", label: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", label: "Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", label: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", label: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", label: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", label: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian", label: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: "harmonicMinor", label: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodicMinor", label: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "pentatonicMajor", label: "Pentatonic Major", intervals: [0, 2, 4, 7, 9] },
  { id: "pentatonicMinor", label: "Pentatonic Minor", intervals: [0, 3, 5, 7, 10] },
  { id: "blues", label: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "wholeTone", label: "Whole Tone", intervals: [0, 2, 4, 6, 8, 10] },
  { id: "chromatic", label: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export const DEFAULT_SCALE_ID = "chromatic";
export const ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** The project's key. `root` is a pitch class 0..11 (0 = C). `snap` makes note entry land on
 * scale notes (Shift/explicit chromatic entry stays possible where the UI has one). `preset`
 * remembers which musical preset set root+scale, for display only. */
export interface ProjectScale {
  root: number;
  scale: string;
  snap: boolean;
  preset: string | null;
}

/** A subjective starting point (root + scale + a handy octave), never a definition of a genre. */
export interface ScalePreset {
  id: string;
  label: string;
  root: number;
  scale: string;
  /** Suggested octave for note entry (MIDI convention, 4 = C4 .. B4). */
  octave: number;
}

export const SCALE_PRESETS: ScalePreset[] = [
  { id: "liquidDnb", label: "Liquid DnB", root: 2, scale: "dorian", octave: 3 },
  { id: "minimalTechno", label: "Minimal Techno", root: 9, scale: "phrygian", octave: 2 },
  { id: "deepHouse", label: "Deep House", root: 7, scale: "dorian", octave: 3 },
  { id: "detroitTechno", label: "Detroit Techno", root: 4, scale: "minor", octave: 3 },
  { id: "ambient", label: "Ambient", root: 0, scale: "lydian", octave: 3 },
  { id: "acid", label: "Acid", root: 9, scale: "pentatonicMinor", octave: 2 },
  { id: "synthwave", label: "Synthwave", root: 9, scale: "minor", octave: 3 },
  { id: "lofi", label: "Lo-fi", root: 0, scale: "dorian", octave: 3 },
  { id: "trap", label: "Trap", root: 6, scale: "phrygian", octave: 2 },
  { id: "ukGarage", label: "UK Garage", root: 7, scale: "minor", octave: 3 },
  { id: "cinematic", label: "Cinematic", root: 2, scale: "harmonicMinor", octave: 3 },
];

export function createScale(): ProjectScale {
  return { root: 0, scale: DEFAULT_SCALE_ID, snap: false, preset: null };
}

export function scaleDef(id: string): ScaleDef {
  return SCALES.find((s) => s.id === id) ?? SCALES[SCALES.length - 1];
}

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** A scale from partial/untrusted data (an old project has none): every field defaulted/clamped. */
export function normalizeScale(raw: Partial<ProjectScale> | null | undefined): ProjectScale {
  const base = createScale();
  if (!raw || typeof raw !== "object") return base;
  const root = Number.isFinite(raw.root) ? mod12(Math.round(raw.root as number)) : base.root;
  const scale = typeof raw.scale === "string" && SCALES.some((s) => s.id === raw.scale) ? raw.scale : base.scale;
  const preset = typeof raw.preset === "string" && SCALE_PRESETS.some((p) => p.id === raw.preset) ? raw.preset : null;
  return { root, scale, snap: raw.snap === true, preset };
}

/** The project's scale, or the all-notes default for a project saved before scales existed. */
export function scaleOf(holder: { scale?: Partial<ProjectScale> | null }): ProjectScale {
  return normalizeScale(holder.scale);
}

export function rootName(root: number): string {
  return ROOT_NAMES[mod12(root)];
}

/** "D Dorian", or the preset's name when one set it: "Liquid DnB (D Dorian)". */
export function formatScale(ctx: ProjectScale): string {
  const key = `${rootName(ctx.root)} ${scaleDef(ctx.scale).label}`;
  const preset = SCALE_PRESETS.find((p) => p.id === ctx.preset);
  return preset ? `${preset.label} (${key})` : key;
}

/** Pitch classes (0..11) of root+scale, in scale order starting at the root. */
export function getScaleNotes(root: number, scale: string): number[] {
  return scaleDef(scale).intervals.map((i) => mod12(root + i));
}

/** True when every pitch is in the scale, i.e. there is nothing to emphasise. */
export function isChromatic(ctx: ProjectScale): boolean {
  return scaleDef(ctx.scale).intervals.length === 12;
}

export function isNoteInScale(ctx: ProjectScale, midi: number): boolean {
  const rel = mod12(Math.round(midi) - ctx.root);
  return scaleDef(ctx.scale).intervals.includes(rel);
}

/** 1-based scale degree of `midi` (root = 1), or null if it is not in the scale. */
export function getScaleDegree(ctx: ProjectScale, midi: number): number | null {
  const idx = scaleDef(ctx.scale).intervals.indexOf(mod12(Math.round(midi) - ctx.root));
  return idx < 0 ? null : idx + 1;
}

/** The scale note closest to `midi`; a tie goes to the lower note, so snapping is predictable. */
export function getNearestScaleNote(ctx: ProjectScale, midi: number): number {
  const target = Math.round(midi);
  for (let d = 0; d <= 6; d++) {
    if (isNoteInScale(ctx, target - d)) return target - d;
    if (isNoteInScale(ctx, target + d)) return target + d;
  }
  return target;
}

/** Every in-scale MIDI note in [minMidi, maxMidi], ascending. */
export function getNotesInRange(ctx: ProjectScale, minMidi: number, maxMidi: number): number[] {
  const out: number[] = [];
  for (let n = Math.ceil(minMidi); n <= Math.floor(maxMidi); n++) if (isNoteInScale(ctx, n)) out.push(n);
  return out;
}

/** MIDI note that a pitch *offset* is relative to. A synth with a Hz root: that root. A sample
 * (original pitch unknown): the key's tonic in octave 4, so offset 0 is the tonic and the
 * emphasised offsets are the key's degrees above it. */
export function referenceMidi(ctx: ProjectScale, trackRoot: number | null): number {
  return trackRoot === null ? 60 + ctx.root : Math.round(trackRoot);
}

export function isOffsetInScale(ctx: ProjectScale, trackRoot: number | null, offset: number): boolean {
  return isNoteInScale(ctx, referenceMidi(ctx, trackRoot) + offset);
}

/** `offset` moved to the nearest in-scale offset (unchanged when already in scale). */
export function nearestScaleOffset(ctx: ProjectScale, trackRoot: number | null, offset: number): number {
  const ref = referenceMidi(ctx, trackRoot);
  return getNearestScaleNote(ctx, ref + offset) - ref;
}

/** `ctx` with one musical preset applied (root + scale), keeping the snap setting. */
export function applyScalePreset(ctx: ProjectScale, presetId: string): ProjectScale {
  const preset = SCALE_PRESETS.find((p) => p.id === presetId);
  return preset ? { ...ctx, root: preset.root, scale: preset.scale, preset: preset.id } : ctx;
}

/** Merges a patch into the project's scale. Picking a root/scale by hand clears the preset
 * label (the key no longer is the preset); a `preset` in the patch applies that preset. */
export function patchScale(ctx: ProjectScale, patch: Partial<ProjectScale>): ProjectScale {
  if (patch.preset) return { ...applyScalePreset(ctx, patch.preset), snap: patch.snap ?? ctx.snap };
  const touchesKey = patch.root !== undefined || patch.scale !== undefined;
  return normalizeScale({ ...ctx, ...patch, preset: touchesKey ? null : (patch.preset ?? ctx.preset) });
}

/** Returns the project with its scale patched. Notes are never touched. */
export function setProjectScale<P extends { scale?: Partial<ProjectScale> | null }>(project: P, patch: Partial<ProjectScale>): P {
  return { ...project, scale: patchScale(scaleOf(project), patch) };
}
