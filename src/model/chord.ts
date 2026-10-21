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
// Inversions are a later feature: they would be an extra optional field on NoteChord applied in
// chordLadderIndices, the single place that decides which ladder steps a chord occupies.

import { effectiveSampleMode } from "./chop";
import { rootMidiNote } from "./instruments";
import { MAX_NOTE_PITCH, MIN_NOTE_PITCH } from "./notes";
import { referenceMidi, scaleOf, type ProjectScale } from "./scale";
import { ladderMidi, nearestLadderIndex, tonicAtOrBelow } from "./scaleDegrees";
import type { Note, NoteId, PatternId, Project, Track } from "./types";

export interface NoteChord {
  root: number;
  degrees: number[];
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
  const { root, degrees } = raw as Partial<NoteChord>;
  if (!Number.isFinite(root) || !Array.isArray(degrees)) return null;
  const clean = [...new Set(degrees.filter((d) => Number.isFinite(d) && d >= 0 && d <= 24).map((d) => Math.round(d)))].sort((a, b) => a - b);
  if (clean.length === 0) return null;
  return { root: Math.round(root as number), degrees: clean.slice(0, MAX_CHORD_VOICES) };
}

/** The ladder indices a chord occupies, ascending (root first). */
export function chordLadderIndices(chord: NoteChord): number[] {
  return chord.degrees.map((d) => chord.root + d);
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

/** Concrete MIDI notes of `chord` under `ctx`, root first. */
export function chordMidis(ctx: ProjectScale, trackRoot: number | null, chord: NoteChord): number[] {
  const base = trackLadderBase(ctx, trackRoot);
  return chordLadderIndices(chord).map((k) => ladderMidi(ctx, base, k));
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

/** Edits a chord note's root and/or degrees (normalised). A plain note is left alone. */
export function setNoteChord(project: Project, patternId: PatternId, noteId: NoteId, patch: Partial<NoteChord>): Project {
  return updateNote(project, patternId, noteId, (note) => {
    if (!note.chord) return note;
    const next = normalizeChord({ ...note.chord, ...patch });
    if (!next) return note;
    return next.root === note.chord.root && next.degrees.join() === note.chord.degrees.join() ? note : { ...note, chord: next };
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
