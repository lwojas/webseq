// Synthesized-instrument definitions and track-level operations. The application-side mirror of
// webdsp's instrument catalogue (docs/instruments.md): which kinds exist, their controls, and
// each control's range/default. Like FX_DEFS in fx.ts this is deliberately a static table so
// the UI renders without a live AudioRuntime (the audio-context gesture veil means the engine
// may not exist yet) and so the model stays free of any webdsp import; src/audio/instruments.ts
// addresses the engine by the *same* ids (webdsp reports control names such as "pitchDrop", and
// those are used verbatim as keys here) and the engine clamps to its own advertised ranges, so
// a drift in these numbers can only ever cost a slider's travel, never correctness.
//
// A track plays either a sample (Track.assetId) or one synth instrument (Track.instrument) —
// never both; the setters here and project.ts's assignAsset keep that exclusive.

import type { InstrumentKindId, Project, Track, TrackId, TrackInstrument } from "./types";

export interface InstrumentParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  default: number;
  /** A stepped control (webdsp's Pulse Rate): rendered as a toggle of these labelled values
   * instead of a slider, like FX enum params. */
  options?: { value: number; label: string }[];
}

export interface InstrumentDef {
  kind: InstrumentKindId;
  label: string;
  /** "drum" one-shots end themselves; "bass" is sustained and needs a note duration (webdsp's
   * bass-client-guide.md: always pass `duration` for sequenced bass notes). */
  category: "drum" | "bass" | "synth";
  sustained: boolean;
  params: InstrumentParamDef[];
}

export const INSTRUMENT_DEFS: Record<InstrumentKindId, InstrumentDef> = {
  kick: {
    kind: "kick",
    label: "Kick",
    category: "drum",
    sustained: false,
    params: [
      { id: "tune", label: "Tune", min: 30, max: 120, step: 1, unit: "Hz", default: 50 },
      { id: "pitchDrop", label: "Pitch Drop", min: 0, max: 4, step: 0.05, unit: "oct", default: 2.5 },
      { id: "pitchDecay", label: "Pitch Decay", min: 0.005, max: 0.25, step: 0.005, unit: "s", default: 0.04 },
      { id: "decay", label: "Decay", min: 0.05, max: 2, step: 0.01, unit: "s", default: 0.45 },
      { id: "punch", label: "Punch", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "drive", label: "Drive", min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
  },
  snare: {
    kind: "snare",
    label: "Snare",
    category: "drum",
    sustained: false,
    params: [
      { id: "tune", label: "Tune", min: 100, max: 400, step: 1, unit: "Hz", default: 185 },
      { id: "decay", label: "Decay", min: 0.05, max: 0.8, step: 0.01, unit: "s", default: 0.22 },
      { id: "snap", label: "Snap", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "noise", label: "Noise", min: 0, max: 1, step: 0.01, default: 0.6 },
    ],
  },
  clap: {
    kind: "clap",
    label: "Clap",
    category: "drum",
    sustained: false,
    params: [
      { id: "tune", label: "Tune", min: 600, max: 3000, step: 10, unit: "Hz", default: 1300 },
      { id: "decay", label: "Decay", min: 0.05, max: 0.8, step: 0.01, unit: "s", default: 0.25 },
      { id: "spread", label: "Spread", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "snap", label: "Snap", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  tom: {
    kind: "tom",
    label: "Tom",
    category: "drum",
    sustained: false,
    params: [
      { id: "tune", label: "Tune", min: 60, max: 400, step: 1, unit: "Hz", default: 120 },
      { id: "pitchDrop", label: "Pitch Drop", min: 0, max: 2, step: 0.05, unit: "oct", default: 0.6 },
      { id: "decay", label: "Decay", min: 0.1, max: 1.5, step: 0.01, unit: "s", default: 0.45 },
      { id: "body", label: "Body", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "damp", label: "Damp", min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
  },
  hihat: {
    kind: "hihat",
    label: "Hi-Hat",
    category: "drum",
    sustained: false,
    params: [
      { id: "tune", label: "Tune", min: -12, max: 12, step: 0.5, unit: "st", default: 0 },
      { id: "decay", label: "Decay", min: 0.02, max: 1.2, step: 0.01, unit: "s", default: 0.08 },
      { id: "metal", label: "Metal", min: 0, max: 1, step: 0.01, default: 0.7 },
      { id: "tone", label: "Tone", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  bass: {
    kind: "bass",
    label: "Bass",
    category: "bass",
    sustained: true,
    params: [
      { id: "tune", label: "Root", min: 27.5, max: 110, step: 0.5, unit: "Hz", default: 55 },
      { id: "body", label: "Body", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "bite", label: "Bite", min: 0, max: 1, step: 0.01, default: 0.4 },
      { id: "cutoff", label: "Cutoff", min: 40, max: 4000, step: 1, unit: "Hz", default: 400 },
      { id: "resonance", label: "Resonance", min: 0, max: 1, step: 0.01, default: 0.25 },
      { id: "attack", label: "Attack", min: 0.001, max: 0.25, step: 0.001, unit: "s", default: 0.003 },
      { id: "decay", label: "Decay", min: 0.03, max: 2, step: 0.01, unit: "s", default: 0.35 },
      { id: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: "release", label: "Release", min: 0.01, max: 1.5, step: 0.01, unit: "s", default: 0.1 },
      // Legato: a note landing while the previous is still held (duration reaching the next note)
      // continues the voice with no re-attack and glides over Slide; a gap re-attacks.
      {
        id: "legato",
        label: "Legato",
        min: 0,
        max: 1,
        step: 1,
        default: 0,
        options: ["Off", "On"].map((label, value) => ({ value, label })),
      },
      { id: "slide", label: "Slide", min: 0, max: 0.5, step: 0.01, unit: "s", default: 0 },
    ],
  },
  pulse: {
    kind: "pulse",
    label: "Pulse",
    category: "synth",
    sustained: true,
    params: [
      { id: "tune", label: "Root", min: 27.5, max: 440, step: 0.5, unit: "Hz", default: 110 },
      { id: "cutoff", label: "Cutoff", min: 60, max: 6000, step: 1, unit: "Hz", default: 500 },
      { id: "resonance", label: "Resonance", min: 0, max: 1, step: 0.01, default: 0.25 },
      { id: "pump", label: "Pump", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "repeat", label: "Repeat", min: 0, max: 1, step: 0.01, default: 0.4 },
      {
        id: "rate",
        label: "Rate",
        min: 0,
        max: 5,
        step: 1,
        default: 2,
        options: ["1/1", "1/2", "1/4", "1/8", "1/16", "1/32"].map((label, value) => ({ value, label })),
      },
      { id: "diffuse", label: "Diffuse", min: 0, max: 1, step: 0.01, default: 0.3 },
      { id: "attack", label: "Attack", min: 0.001, max: 0.25, step: 0.001, unit: "s", default: 0.003 },
      { id: "release", label: "Release", min: 0.01, max: 1.5, step: 0.01, unit: "s", default: 0.08 },
    ],
  },
};

export const INSTRUMENT_KINDS = Object.keys(INSTRUMENT_DEFS) as InstrumentKindId[];

export function defaultInstrumentParams(kind: InstrumentKindId): Record<string, number> {
  const params: Record<string, number> = {};
  for (const def of INSTRUMENT_DEFS[kind].params) params[def.id] = def.default;
  return params;
}

export function createInstrument(kind: InstrumentKindId): TrackInstrument {
  return { kind, params: defaultInstrumentParams(kind) };
}

/** The synth definition for `track`, or null for a sample/empty track or a kind this build
 * doesn't know (a project saved by a newer version) — callers treat null as "no synth". */
export function instrumentDefFor(track: Pick<Track, "instrument">): InstrumentDef | null {
  const kind = track.instrument?.kind;
  return kind ? (INSTRUMENT_DEFS[kind] ?? null) : null;
}

/** MIDI note number (fractional) of a synth track's root, from its `tune` control when that is
 * in Hz — webdsp's note `pitch` is semitones on top of it, so root + pitch is the sounding
 * note. Null for samples (original pitch unknown) and synths whose tune is not a frequency. */
export function rootMidiNote(track: Pick<Track, "instrument">): number | null {
  const inst = track.instrument;
  const def = inst ? INSTRUMENT_DEFS[inst.kind] : undefined;
  const tune = def?.params.find((p) => p.id === "tune");
  if (!inst || !tune || tune.unit !== "Hz") return null;
  const hz = inst.params.tune ?? tune.default;
  return hz > 0 ? 69 + 12 * Math.log2(hz / 440) : null;
}

function updateTrack(project: Project, trackId: TrackId, update: (t: Track) => Track): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? update(t) : t)) };
}

/** Makes `trackId` play synth `kind` (fresh default params), or `null` to remove the synth.
 * Switching to a synth clears the track's sample assignment and takes the instrument's name;
 * switching back to a different kind keeps nothing of the old kind's params, since the control
 * sets differ. Removing the synth leaves the track empty (unassigned). Selecting the kind
 * already in place is a no-op, so a stray click never resets tweaked params. */
export function setTrackInstrument(project: Project, trackId: TrackId, kind: InstrumentKindId | null): Project {
  return updateTrack(project, trackId, (t) => {
    if (kind === null) return t.instrument ? { ...t, instrument: null } : t;
    if (t.instrument?.kind === kind) return t;
    return { ...t, instrument: createInstrument(kind), assetId: null, name: INSTRUMENT_DEFS[kind].label };
  });
}

export function setInstrumentParam(project: Project, trackId: TrackId, paramId: string, value: number): Project {
  return updateTrack(project, trackId, (t) => {
    if (!t.instrument) return t;
    const def = INSTRUMENT_DEFS[t.instrument.kind]?.params.find((p) => p.id === paramId);
    if (!def) return t;
    const clamped = Math.min(def.max, Math.max(def.min, value));
    return { ...t, instrument: { ...t.instrument, params: { ...t.instrument.params, [paramId]: clamped } } };
  });
}
