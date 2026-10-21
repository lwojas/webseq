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

import { MAX_TRACK_LFOS, withLfoAdded, withLfoPatched, withLfoRemoved } from "./lfoStack";
import type { InstrumentKindId, Project, Track, TrackId, TrackInstrument, TrackLfo } from "./types";

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
      { id: "grit", label: "Grit", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "pluck", label: "Pluck", min: 0, max: 1, step: 0.01, default: 0 },
      { id: "pump", label: "Pump", min: 0, max: 1, step: 0.01, default: 0.5 },
      {
        id: "pumpRate",
        label: "Pump Rate",
        min: -1,
        max: 5,
        step: 1,
        default: -1, // Link: follows Rate
        options: ["Link", "1/1", "1/2", "1/4", "1/8", "1/16", "1/32"].map((label, i) => ({ value: i - 1, label })),
      },
      { id: "pumpAttack", label: "Pump Attack", min: 0, max: 1, step: 0.01, default: 0 },
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
  // Sustained stereo pad (webdsp docs/pad-instrument.md). Free-running (not tempo-synced). A new
  // note on a sounding track moves the previous one into its release, so give pad notes a
  // `duration` and let consecutive notes overlap.
  pad: {
    kind: "pad",
    label: "Pad",
    category: "synth",
    sustained: true,
    params: [
      { id: "tune", label: "Root", min: 27.5, max: 440, step: 0.5, unit: "Hz", default: 110 },
      { id: "tone", label: "Tone", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "movement", label: "Movement", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "detune", label: "Detune", min: 0, max: 1, step: 0.01, default: 0.4 },
      { id: "space", label: "Space", min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: "attack", label: "Attack", min: 0.02, max: 8, step: 0.01, unit: "s", default: 0.8 },
      { id: "release", label: "Release", min: 0.1, max: 12, step: 0.1, unit: "s", default: 3 },
    ],
  },
  // Two-operator FM bass/lead (webdsp docs/fm-instrument.md). Sustained: each note's length is its
  // held time. Ratio is a stepped colour switch (hollow/odd, inharmonic metal ...). Timbre is the
  // resting FM depth and Snap a bright onset that decays; Legato/Slide behave as on the Bass.
  fm: {
    kind: "fm",
    label: "FM",
    category: "synth",
    sustained: true,
    params: [
      { id: "tune", label: "Root", min: 27.5, max: 880, step: 0.5, unit: "Hz", default: 110 },
      {
        id: "ratio",
        label: "Ratio",
        min: 0,
        max: 7,
        step: 1,
        default: 1,
        options: ["1:2", "1:1", "2:1", "3:1", "4:1", "5:1", "1.41", "3.5"].map((label, value) => ({ value, label })),
      },
      { id: "timbre", label: "Timbre", min: 0, max: 1, step: 0.01, default: 0.35 },
      { id: "snap", label: "Snap", min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: "tone", label: "Tone", min: 0, max: 1, step: 0.01, default: 0.75 },
      { id: "attack", label: "Attack", min: 0.001, max: 0.25, step: 0.001, unit: "s", default: 0.003 },
      { id: "decay", label: "Decay", min: 0.03, max: 2, step: 0.01, unit: "s", default: 0.3 },
      { id: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: "release", label: "Release", min: 0.01, max: 1.5, step: 0.01, unit: "s", default: 0.1 },
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
  // Seven detuned saws as one stereo voice (webdsp docs/hypersaw-instrument.md). Sustained: each
  // note's length is its held time. Detune is in cents (outer pair), Spread the stereo width (it
  // widens with detune), Density the centre-vs-sides mix.
  hypersaw: {
    kind: "hypersaw",
    label: "Hypersaw",
    category: "synth",
    sustained: true,
    params: [
      { id: "tune", label: "Root", min: 27.5, max: 880, step: 0.5, unit: "Hz", default: 110 },
      { id: "detune", label: "Detune", min: 0, max: 100, step: 0.5, unit: "ct", default: 25 },
      { id: "spread", label: "Spread", min: 0, max: 1, step: 0.01, default: 0.8 },
      { id: "density", label: "Density", min: 0, max: 1, step: 0.01, default: 0.7 },
      { id: "cutoff", label: "Cutoff", min: 200, max: 16000, step: 1, unit: "Hz", default: 5000 },
      { id: "attack", label: "Attack", min: 0.001, max: 4, step: 0.001, unit: "s", default: 0.01 },
      { id: "decay", label: "Decay", min: 0.02, max: 4, step: 0.01, unit: "s", default: 0.5 },
      { id: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01, default: 0.8 },
      { id: "release", label: "Release", min: 0.01, max: 6, step: 0.01, unit: "s", default: 0.4 },
    ],
  },
  // Pulse-width-modulated character synth (webdsp docs/pwm-beast-instrument.md). Sustained.
  // Width/PWM/Rate/Shape set the pulse and its movement (Shape 1 = the note envelope drives the
  // width), Harmonics is the fold stage, Drive the asymmetric drive, Env Amt how far the internal
  // envelope opens the filter.
  pwmbeast: {
    kind: "pwmbeast",
    label: "PWM Beast",
    category: "synth",
    sustained: true,
    params: [
      { id: "tune", label: "Root", min: 27.5, max: 440, step: 0.5, unit: "Hz", default: 55 },
      { id: "width", label: "Width", min: 0.05, max: 0.95, step: 0.01, default: 0.3 },
      { id: "pwm", label: "PWM", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "rate", label: "PWM Rate", min: 0.1, max: 200, step: 0.1, unit: "Hz", default: 3.5 },
      { id: "shape", label: "PWM Shape", min: 0, max: 1, step: 0.01, default: 0.35 },
      { id: "harmonics", label: "Harmonics", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "drive", label: "Drive", min: 0, max: 1, step: 0.01, default: 0.4 },
      { id: "cutoff", label: "Cutoff", min: 60, max: 8000, step: 1, unit: "Hz", default: 500 },
      { id: "resonance", label: "Resonance", min: 0, max: 1, step: 0.01, default: 0.45 },
      { id: "envamt", label: "Env Amt", min: 0, max: 1, step: 0.01, default: 0.7 },
      { id: "sub", label: "Sub", min: 0, max: 1, step: 0.01, default: 0.25 },
      { id: "attack", label: "Attack", min: 0.001, max: 0.25, step: 0.001, unit: "s", default: 0.003 },
      { id: "decay", label: "Decay", min: 0.03, max: 2, step: 0.01, unit: "s", default: 0.3 },
      { id: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: "release", label: "Release", min: 0.01, max: 1.5, step: 0.01, unit: "s", default: 0.12 },
    ],
  },
  // Digital Machines (webdsp docs/digital-machines.md): five FM instruments on one shared kernel. Tune,
  // Decay and the depth control are the first three controls of every Machine. Thump, Metal and Crack
  // are one-shots; Tone and Chaos are sustained when Hold > 0 (and the note's length is then the held
  // time; with Hold 0 they are plucks/hits that the note length merely truncates).
  dm_thump: {
    kind: "dm_thump",
    label: "FM Thump",
    category: "drum",
    sustained: false,
    params: [
      { id: "tune", label: "Tune", min: 25, max: 400, step: 0.5, unit: "Hz", default: 55 },
      { id: "decay", label: "Decay", min: 0.05, max: 2, step: 0.01, unit: "s", default: 0.45 },
      { id: "fm", label: "FM", min: 0, max: 1, step: 0.01, default: 0.35 },
      { id: "sweep", label: "Sweep", min: 0, max: 4, step: 0.05, unit: "oct", default: 2 },
      { id: "punch", label: "Punch", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "ratio", label: "Ratio", min: 0, max: 1, step: 0.01, default: 0.17 },
      { id: "body", label: "Body", min: 0, max: 1, step: 0.01, default: 0.3 },
      { id: "drive", label: "Drive", min: 0, max: 1, step: 0.01, default: 0.2 },
    ],
  },
  dm_metal: {
    kind: "dm_metal",
    label: "FM Metal",
    category: "drum",
    sustained: false,
    params: [
      { id: "tune", label: "Tune", min: 80, max: 1500, step: 1, unit: "Hz", default: 320 },
      { id: "decay", label: "Decay", min: 0.02, max: 2, step: 0.01, unit: "s", default: 0.12 },
      { id: "fm", label: "FM", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "spread", label: "Spread", min: 0, max: 1, step: 0.01, default: 0.67 },
      { id: "tone", label: "Tone", min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: "noise", label: "Noise", min: 0, max: 1, step: 0.01, default: 0.3 },
      { id: "chick", label: "Chick", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "drive", label: "Drive", min: 0, max: 1, step: 0.01, default: 0.15 },
    ],
  },
  dm_tone: {
    kind: "dm_tone",
    label: "FM Tone",
    category: "synth",
    sustained: true,
    params: [
      { id: "tune", label: "Root", min: 27.5, max: 880, step: 0.5, unit: "Hz", default: 110 },
      { id: "decay", label: "Decay", min: 0.03, max: 3, step: 0.01, unit: "s", default: 0.5 },
      { id: "fm", label: "FM", min: 0, max: 1, step: 0.01, default: 0.5 },
      {
        id: "structure",
        label: "Structure",
        min: 0,
        max: 5,
        step: 1,
        default: 0,
        options: ["Stack", "Twin", "Fan", "Major", "Minor", "Sus"].map((label, value) => ({ value, label })),
      },
      { id: "ratio", label: "Ratio", min: 0, max: 1, step: 0.01, default: 0.111 },
      { id: "damp", label: "Damp", min: 0, max: 1, step: 0.01, default: 0.4 },
      { id: "attack", label: "Attack", min: 0.001, max: 0.25, step: 0.001, unit: "s", default: 0.002 },
      { id: "hold", label: "Hold", min: 0, max: 1, step: 0.01, default: 0 },
      { id: "drive", label: "Drive", min: 0, max: 1, step: 0.01, default: 0.1 },
    ],
  },
  dm_crack: {
    kind: "dm_crack",
    label: "FM Crack",
    category: "drum",
    sustained: false,
    params: [
      { id: "tune", label: "Tune", min: 80, max: 600, step: 1, unit: "Hz", default: 190 },
      { id: "decay", label: "Decay", min: 0.04, max: 1, step: 0.01, unit: "s", default: 0.18 },
      { id: "fm", label: "FM", min: 0, max: 1, step: 0.01, default: 0.4 },
      { id: "body", label: "Body", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "noise", label: "Noise", min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: "burst", label: "Burst", min: 0, max: 1, step: 0.01, default: 0 },
      { id: "tone", label: "Tone", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "drive", label: "Drive", min: 0, max: 1, step: 0.01, default: 0.2 },
    ],
  },
  dm_chaos: {
    kind: "dm_chaos",
    label: "FM Chaos",
    category: "synth",
    sustained: true,
    params: [
      { id: "tune", label: "Root", min: 27.5, max: 1760, step: 0.5, unit: "Hz", default: 220 },
      { id: "decay", label: "Decay", min: 0.03, max: 3, step: 0.01, unit: "s", default: 0.4 },
      { id: "chaos", label: "Chaos", min: 0, max: 1, step: 0.01, default: 0.4 },
      { id: "ratio", label: "Ratio", min: 0, max: 1, step: 0.01, default: 0.143 },
      { id: "fold", label: "Fold", min: 0, max: 1, step: 0.01, default: 0.3 },
      { id: "noise", label: "Noise", min: 0, max: 1, step: 0.01, default: 0 },
      { id: "sweep", label: "Sweep", min: 0, max: 3, step: 0.05, unit: "oct", default: 0 },
      { id: "hold", label: "Hold", min: 0, max: 1, step: 0.01, default: 0 },
    ],
  },
  // Percussion Synth (webdsp docs/percussion-synth.md): two oscillators + noise, one shared pitch sweep, FM,
  // a resonant LP/HP and a drive stage. Ids are the engine's own (lowercase) names. Registered as a
  // one-shot like the drums: `sustain` and `release` are not exposed, so the engine keeps sustain 0 and a hit
  // ends itself (no `duration` is sent); a long Decay is the route to bass/drone hits.
  percsynth: {
    kind: "percsynth",
    label: "Perc Synth",
    category: "synth",
    sustained: false,
    params: [
      { id: "tune", label: "Tune", min: 25, max: 800, step: 0.5, unit: "Hz", default: 55 },
      {
        id: "osc1wave", label: "Osc 1", min: 0, max: 2, step: 1, default: 0,
        options: ["Sine/Tri", "Saw", "Square"].map((label, value) => ({ value, label })),
      },
      { id: "osc1level", label: "Osc 1 Level", min: 0, max: 1, step: 0.01, default: 0.9 },
      {
        id: "osc2wave", label: "Osc 2", min: 0, max: 2, step: 1, default: 1,
        options: ["Sine/Tri", "Saw", "Square"].map((label, value) => ({ value, label })),
      },
      { id: "osc2pitch", label: "Osc 2 Pitch", min: -24, max: 48, step: 0.1, unit: "st", default: 12 },
      { id: "osc2level", label: "Osc 2 Level", min: 0, max: 1, step: 0.01, default: 0 },
      { id: "osc2fm", label: "FM", min: 0, max: 1, step: 0.01, default: 0 },
      { id: "pitchenv", label: "Sweep", min: 0, max: 6, step: 0.05, unit: "oct", default: 2.5 },
      { id: "pitchdecay", label: "Sweep Time", min: 0.005, max: 2, step: 0.005, unit: "s", default: 0.07 },
      { id: "osc2env", label: "Osc 2 Sweep", min: 0, max: 2, step: 0.01, default: 1 },
      { id: "noise", label: "Noise", min: 0, max: 1, step: 0.01, default: 0 },
      { id: "noisetone", label: "Noise Tone", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "noisedecay", label: "Noise Decay", min: 0.003, max: 2, step: 0.001, unit: "s", default: 0.04 },
      {
        id: "filtertype", label: "Filter", min: 0, max: 1, step: 1, default: 0,
        options: ["Low-pass", "High-pass"].map((label, value) => ({ value, label })),
      },
      { id: "cutoff", label: "Cutoff", min: 40, max: 16000, step: 1, unit: "Hz", default: 5000 },
      { id: "resonance", label: "Resonance", min: 0, max: 1, step: 0.01, default: 0.15 },
      { id: "filterenv", label: "Filter Env", min: -1, max: 1, step: 0.01, default: 0 },
      { id: "filterdecay", label: "Filter Decay", min: 0.01, max: 2, step: 0.01, unit: "s", default: 0.15 },
      { id: "attack", label: "Attack", min: 0.0005, max: 0.25, step: 0.0005, unit: "s", default: 0.001 },
      { id: "decay", label: "Decay", min: 0.02, max: 4, step: 0.01, unit: "s", default: 0.35 },
      { id: "drive", label: "Drive", min: 0, max: 1, step: 0.01, default: 0.2 },
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

// --- LFO modulation slots (webdsp docs/lfo-modulation.md) ---
// The model only stores what the user chose. Which controls are valid targets, and the waveform /
// division option lists, come from the engine at runtime (AudioRuntime.getModulationTargets /
// getModulationInfo) so nothing here lists targets per synth. The LFO stack itself is shared with
// FX (lfoStack.ts).
export { createLfo, DEFAULT_LFO_DIVISION, LFO_MAX_RATE_HZ, LFO_MIN_RATE_HZ, LFO_WAVEFORMS, MAX_TRACK_LFOS } from "./lfoStack";

function updateInstrument(project: Project, trackId: TrackId, update: (i: TrackInstrument) => TrackInstrument): Project {
  return updateTrack(project, trackId, (t) => (t.instrument ? { ...t, instrument: update(t.instrument) } : t));
}

function withLfos(i: TrackInstrument, lfos: TrackLfo[]): TrackInstrument {
  const { lfos: _drop, ...rest } = i;
  return lfos.length ? { ...rest, lfos } : rest;
}

/** Adds an LFO (up to MAX_TRACK_LFOS) aimed at `target`. */
export function addInstrumentLfo(project: Project, trackId: TrackId, target: string): Project {
  return updateInstrument(project, trackId, (i) => ((i.lfos?.length ?? 0) >= MAX_TRACK_LFOS ? i : withLfos(i, withLfoAdded(i.lfos, target))));
}

/** Edits LFO `index`. Numeric fields are clamped to their ranges. */
export function setInstrumentLfo(project: Project, trackId: TrackId, index: number, patch: Partial<TrackLfo>): Project {
  return updateInstrument(project, trackId, (i) => (i.lfos?.[index] ? withLfos(i, withLfoPatched(i.lfos, index, patch)) : i));
}

export function removeInstrumentLfo(project: Project, trackId: TrackId, index: number): Project {
  return updateInstrument(project, trackId, (i) => (i.lfos?.[index] ? withLfos(i, withLfoRemoved(i.lfos, index)) : i));
}
