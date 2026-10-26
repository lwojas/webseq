// Scale-relative chords. A chord is stored on an ordinary Note as `{ root, degrees }` — never as
// the MIDI notes it sounds as:
//   root     a ladder index (model/scaleDegrees.ts): which scale note the chord is built on, counted
//            in scale steps from the track's tonic (0 = tonic, 7 = tonic an octave up in a 7-note
//            scale, -1 = the scale note below the tonic).
//   degrees  scale-step offsets from the root, ascending: [0, 2, 4] = "1 3 5" (every second scale
//            note), [0, 2, 4, 6] adds the 7th, [0, 2, 4, 6, 8] the 9th. Past the end of the scale
//            the ladder wraps into the next octave.
// Resolution against the project scale happens only at playback time (audio/compile.ts's
// playedNotes), which expands the one stored Note into several ordinary notes. The engine never
// sees a chord; the stored pattern is still one note per step, so the grid, copy/paste and bar
// tools keep working unchanged.
//
// A note either has a chord (then `pitch` is unused and removed) or a plain `pitch` — the two
// are never mixed, and nothing converts plain notes to chords except the explicit mode switch.
// Changing the project scale re-resolves chords (that is the point of scale-relative data) and
// never touches plain notes.
//
// Two independent axes sit on top of that, both optional so older projects load unchanged:
//   type       what the tones are. Absent = the legacy scale-derived stack (`degrees` alone: the
//              chord's quality follows the project scale). A named type (min7, sus4, 6/9 ...) is a
//              fixed interval table (CHORD_TYPES) built on the scale-note root, so "Minor 7" is
//              minor in every scale; `degrees` then only records the tone count.
//   inversion  0 = root position; n moves the n lowest tones up an octave, one at a time.
//   voicing    "close" (default) or "open" (the second-lowest tone lifted an octave).
// chordTones() is the single place that decides which pitches a chord occupies.

import { effectiveSampleMode } from "./chop";
import { rootMidiNote } from "./instruments";
import { MAX_NOTE_PITCH, MIN_NOTE_PITCH } from "./notes";
import { referenceMidi, scaleOf, type ProjectScale } from "./scale";
import { ladderMidi, ladderSize, nearestLadderIndex, tonicAtOrBelow } from "./scaleDegrees";
import type { Note, NoteId, PatternId, Project, Track } from "./types";

export type ChordVoicing = "close" | "open";
export const CHORD_VOICINGS: readonly ChordVoicing[] = ["close", "open"];

export interface NoteChord {
  root: number;
  degrees: number[];
  /** CHORD_TYPES id; absent for the legacy scale-derived shapes. */
  type?: string;
  /** Absent = root position. */
  inversion?: number;
  /** Absent = close. */
  voicing?: ChordVoicing;
}

export interface ChordShape {
  id: string;
  label: string;
  degrees: number[];
}

export const CHORD_SHAPES: ChordShape[] = [
  { id: "triad", label: "Triad 1·3·5", degrees: [0, 2, 4] },
  { id: "seventh", label: "Seventh 1·3·5·7", degrees: [0, 2, 4, 6] },
  { id: "ninth", label: "Ninth 1·3·5·7·9", degrees: [0, 2, 4, 6, 8] },
];

/** A fixed-quality chord: semitones above the root, ascending, at most MAX_CHORD_VOICES. Larger
 * chords drop the tones players leave out (5th of an 11th/13th, 3rd of a dominant 11th). */
export interface ChordType {
  id: string;
  label: string;
  intervals: number[];
}

export const CHORD_TYPES: ChordType[] = [
  { id: "maj", label: "Major", intervals: [0, 4, 7] },
  { id: "min", label: "Minor", intervals: [0, 3, 7] },
  { id: "dim", label: "Diminished", intervals: [0, 3, 6] },
  { id: "aug", label: "Augmented", intervals: [0, 4, 8] },
  { id: "sus2", label: "Sus2", intervals: [0, 2, 7] },
  { id: "sus4", label: "Sus4", intervals: [0, 5, 7] },
  { id: "6", label: "6", intervals: [0, 4, 7, 9] },
  { id: "m6", label: "Minor 6", intervals: [0, 3, 7, 9] },
  { id: "69", label: "6/9", intervals: [0, 4, 7, 9, 14] },
  { id: "maj7", label: "Major 7", intervals: [0, 4, 7, 11] },
  { id: "m7", label: "Minor 7", intervals: [0, 3, 7, 10] },
  { id: "7", label: "Dominant 7", intervals: [0, 4, 7, 10] },
  { id: "dim7", label: "Diminished 7", intervals: [0, 3, 6, 9] },
  { id: "m7b5", label: "Half-dim 7", intervals: [0, 3, 6, 10] },
  { id: "maj9", label: "Major 9", intervals: [0, 4, 7, 11, 14] },
  { id: "m9", label: "Minor 9", intervals: [0, 3, 7, 10, 14] },
  { id: "9", label: "Dominant 9", intervals: [0, 4, 7, 10, 14] },
  { id: "11", label: "11", intervals: [0, 7, 10, 14, 17] },
  { id: "m11", label: "Minor 11", intervals: [0, 3, 10, 14, 17] },
  { id: "13", label: "13", intervals: [0, 4, 10, 14, 21] },
];

export function chordType(id: string | undefined): ChordType | undefined {
  return id === undefined ? undefined : CHORD_TYPES.find((t) => t.id === id);
}

/** The chord fields that select `typeId` (a CHORD_TYPES id or a legacy CHORD_SHAPES id). `degrees`
 * is only the tone count for a named type: that is what the instance pool and the label read. */
export function chordTypePatch(typeId: string): Pick<NoteChord, "degrees" | "type"> | null {
  const type = chordType(typeId);
  if (type) return { type: type.id, degrees: stackDegrees(type.intervals.length) };
  const shape = chordShape(typeId);
  return shape ? { type: undefined, degrees: [...shape.degrees] } : null;
}

/** Id the type menu shows for `chord`: its named type, else its legacy shape, else null (custom). */
export function chordTypeId(chord: NoteChord): string | null {
  return chordType(chord.type)?.id ?? shapeIdOf(chord.degrees);
}

/** Largest valid inversion: one less than the tone count (a chord of n tones has n positions). */
export function maxInversion(chord: NoteChord): number {
  return Math.max(0, chord.degrees.length - 1);
}

const stackDegrees = (n: number) => [0, 2, 4, 6, 8].slice(0, n);

export const DEFAULT_CHORD_DEGREES = CHORD_SHAPES[0].degrees;

/** Most tones one chord may have. Each tone of a synth chord needs its own engine instance
 * (webdsp instruments are monophonic), so this bounds the instances one track can use. */
export const MAX_CHORD_VOICES = 5;

export function chordShape(id: string): ChordShape | undefined {
  return CHORD_SHAPES.find((s) => s.id === id);
}

/** The shape id whose degrees equal `degrees`, or null for a custom stack. */
export function shapeIdOf(degrees: readonly number[]): string | null {
  return CHORD_SHAPES.find((s) => s.degrees.length === degrees.length && s.degrees.every((d, i) => d === degrees[i]))?.id ?? null;
}

/** A chord from untrusted data (a saved project, a clipboard): integer root, 1..MAX_CHORD_VOICES
 * ascending unique non-negative integer degrees. Null when nothing usable is left. */
export function normalizeChord(raw: unknown): NoteChord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { root, degrees, type, inversion, voicing } = raw as Partial<NoteChord>;
  if (!Number.isFinite(root) || !Array.isArray(degrees)) return null;
  const clean = [...new Set(degrees.filter((d) => Number.isFinite(d) && d >= 0 && d <= 24).map((d) => Math.round(d)))].sort((a, b) => a - b);
  if (clean.length === 0) return null;
  // An unknown type (a newer project, a corrupt one) is dropped: the chord falls back to its degrees.
  const known = typeof type === "string" ? chordType(type) : undefined;
  const tones = known ? known.intervals.length : Math.min(clean.length, MAX_CHORD_VOICES);
  const out: NoteChord = { root: Math.round(root as number), degrees: known ? stackDegrees(tones) : clean.slice(0, MAX_CHORD_VOICES) };
  if (known) out.type = known.id;
  const inv = Number.isFinite(inversion) ? Math.min(tones - 1, Math.max(0, Math.round(inversion as number))) : 0;
  if (inv > 0) out.inversion = inv;
  if (voicing === "open") out.voicing = "open";
  return out;
}

/** Moves the `inversion` lowest tones up an octave, one at a time, then (open voicing) lifts the
 * second-lowest tone an octave, and returns the tones ascending. `octave` is the octave size in
 * the same units as `tones` (12 semitones, or the scale's note count for ladder indices). Pure and
 * deterministic; an inversion beyond the tone count is clamped to the last position. */
export function arrangeTones(tones: readonly number[], octave: number, inversion = 0, voicing: ChordVoicing = "close"): number[] {
  let t = [...tones].sort((a, b) => a - b);
  const steps = Math.min(Math.max(0, Math.round(inversion)), Math.max(0, t.length - 1));
  for (let i = 0; i < steps; i++) t = [...t.slice(1), t[0] + octave];
  if (voicing === "open" && t.length >= 3) t = [t[0], ...t.slice(2), t[1] + octave];
  return t.sort((a, b) => a - b);
}

/** The pitches a chord occupies, ascending, as ladder indices (legacy stack) or semitones above
 * the root's pitch (named type), after inversion and voicing. Which of the two is `kind`. */
export function chordTones(ctx: ProjectScale, chord: NoteChord): { kind: "ladder" | "semitones"; tones: number[] } {
  const type = chordType(chord.type);
  if (type) return { kind: "semitones", tones: arrangeTones(type.intervals, 12, chord.inversion, chord.voicing) };
  return { kind: "ladder", tones: arrangeTones(chord.degrees.map((d) => chord.root + d), ladderSize(ctx), chord.inversion, chord.voicing) };
}

/** The tonic that ladder index 0 sits on under scale `ctx`, for a track whose root is `trackRoot`
 * (rootMidiNote: a synth's real root, or null for a sample): at or below the track's reference
 * note, i.e. the synth's root or the key's tonic in octave 4 for a sample. */
export function trackLadderBase(ctx: ProjectScale, trackRoot: number | null): number {
  return tonicAtOrBelow(ctx, Math.round(referenceMidi(ctx, trackRoot)));
}

function clampPitch(p: number): number {
  return Math.min(MAX_NOTE_PITCH, Math.max(MIN_NOTE_PITCH, p));
}

/** Concrete MIDI notes of `chord` under `ctx`, lowest first (the root, unless inverted). */
export function chordMidis(ctx: ProjectScale, trackRoot: number | null, chord: NoteChord): number[] {
  const base = trackLadderBase(ctx, trackRoot);
  const { kind, tones } = chordTones(ctx, chord);
  if (kind === "ladder") return tones.map((k) => ladderMidi(ctx, base, k));
  const rootMidi = ladderMidi(ctx, base, chord.root);
  return tones.map((t) => rootMidi + t);
}

/** The same notes as Note.pitch offsets from the track's own pitch — what the engine receives. */
export function chordPitchOffsets(ctx: ProjectScale, trackRoot: number | null, chord: NoteChord): number[] {
  const ref = Math.round(referenceMidi(ctx, trackRoot));
  return chordMidis(ctx, trackRoot, chord).map((m) => clampPitch(m - ref));
}

/** A note as the playback path sees it: ordinary, plus which chord tone it is (0 = root / any
 * non-chord note). `voice` is playback-only and never stored. */
export type PlayedNote = Note & { voice?: number };

/** Replaces each chord note by its tones as ordinary notes (same start, length, velocity, LFO).
 * A track whose notes have no chords returns its own array untouched. Chop tracks (pitch = slice)
 * never expand: a chord has no meaning there, so such a note plays as a plain note. */
export function expandChordNotes(track: Track, notes: Note[], scale: Partial<ProjectScale> | null | undefined): PlayedNote[] {
  if (!notes.some((n) => n.chord)) return notes;
  const ctx = scaleOf({ scale });
  const chop = effectiveSampleMode(track) === "chop";
  const trackRoot = rootMidiNote(track);
  const out: PlayedNote[] = [];
  for (const note of notes) {
    // Re-validated: a saved or recovered project is not trusted to hold well-formed chords.
    const chord = chop ? null : normalizeChord(note.chord);
    if (!chord) {
      const { chord: _unused, ...plain } = note;
      out.push(plain);
      continue;
    }
    chordPitchOffsets(ctx, trackRoot, chord).forEach((offset, i) => {
      const { chord: _c, pitch: _p, ...rest } = note;
      out.push({ ...rest, id: `${note.id}#${i}`, ...(offset ? { pitch: offset } : {}), voice: i });
    });
  }
  return out;
}

/** Chord roots a user can pick on `track`: every scale note whose pitch fits the engine's
 * +-4 octave offset range (and, for a synth with a Hz root, the audible band), ascending. */
export function chordRootOptions(ctx: ProjectScale, trackRoot: number | null): { index: number; midi: number }[] {
  const base = trackLadderBase(ctx, trackRoot);
  const ref = Math.round(referenceMidi(ctx, trackRoot));
  const synthRoot = trackRoot !== null;
  const out: { index: number; midi: number }[] = [];
  for (let k = -60; k <= 60; k++) {
    const midi = ladderMidi(ctx, base, k);
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    if (Math.abs(midi - ref) > MAX_NOTE_PITCH) continue;
    if (synthRoot && (hz < 20 || hz > 16000)) continue;
    out.push({ index: k, midi });
  }
  return out;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "A1", "C#4": a MIDI note's name with its octave (MIDI convention, 60 = C4). */
export function midiNoteName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

// --- editing (Note <-> Chord mode) ---

function updateNote(project: Project, patternId: PatternId, noteId: NoteId, update: (note: Note, track: Track) => Note): Project {
  const pattern = project.patterns.find((p) => p.id === patternId);
  const note = pattern?.notes[noteId];
  const track = note && project.tracks.find((t) => t.id === note.trackId);
  if (!pattern || !note || !track) return project;
  const next = update(note, track);
  if (next === note) return project;
  return {
    ...project,
    patterns: project.patterns.map((p) => (p.id === patternId ? { ...p, notes: { ...p.notes, [noteId]: next } } : p)),
  };
}

/** Switches one note between Note and Chord mode, keeping what it sounds like where it can:
 * Note -> Chord roots the chord on the nearest scale note to the note's pitch (a triad);
 * Chord -> Note keeps the chord's root as the plain pitch. Chop tracks refuse chords. */
export function setNoteMode(project: Project, patternId: PatternId, noteId: NoteId, mode: "note" | "chord"): Project {
  const ctx = scaleOf(project);
  return updateNote(project, patternId, noteId, (note, track) => {
    if (mode === "chord") {
      if (note.chord || effectiveSampleMode(track) === "chop") return note;
      const trackRoot = rootMidiNote(track);
      const base = trackLadderBase(ctx, trackRoot);
      const ref = Math.round(referenceMidi(ctx, trackRoot));
      const { pitch, ...rest } = note;
      return { ...rest, chord: { root: nearestLadderIndex(ctx, base, ref + (pitch ?? 0)), degrees: [...DEFAULT_CHORD_DEGREES] } };
    }
    if (!note.chord) return note;
    const { chord, ...rest } = note;
    const offset = chordPitchOffsets(ctx, rootMidiNote(track), chord)[0];
    return offset ? { ...rest, pitch: offset } : rest;
  });
}

/** Edits a chord note's root, degrees, type, inversion and/or voicing (normalised). A plain note is left alone. */
export function setNoteChord(project: Project, patternId: PatternId, noteId: NoteId, patch: Partial<NoteChord>): Project {
  return updateNote(project, patternId, noteId, (note) => {
    if (!note.chord) return note;
    const next = normalizeChord({ ...note.chord, ...patch });
    if (!next) return note;
    return JSON.stringify(next) === JSON.stringify(note.chord) ? note : { ...note, chord: next };
  });
}

/** How many engine instances a synth track needs to voice its largest chord (1 = no chords). */
export function chordVoicesNeeded(project: Project): Map<string, number> {
  const needed = new Map<string, number>();
  for (const pattern of project.patterns) {
    for (const note of Object.values(pattern.notes)) {
      const chord = note.chord && normalizeChord(note.chord);
      if (!chord) continue;
      needed.set(note.trackId, Math.max(needed.get(note.trackId) ?? 1, chord.degrees.length));
    }
  }
  return needed;
}
