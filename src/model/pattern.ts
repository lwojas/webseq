// Pure state-transition functions over SequencerState. No React, no webdsp — every
// function here takes a state and returns a new state, so it's usable from a reducer, a
// test, or anything else without modification.

import type { Note, NoteId, SequencerState, Track, TrackId } from "./types";
import { notesForTrack, totalBeats } from "./types";

export const MIN_TEMPO = 40;
export const MAX_TEMPO = 240;
export const DEFAULT_TEMPO = 120;
export const DEFAULT_TRACK_COUNT = 16;
export const DEFAULT_BEATS_PER_BAR = 16;
export const MIN_NOTE_DURATION = 1;
export const DEFAULT_NOTE_DURATION = 1;
export const DEFAULT_VELOCITY = 1;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialState(
  trackCount = DEFAULT_TRACK_COUNT,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  bars = 1,
  tempo = DEFAULT_TEMPO,
): SequencerState {
  const tracks: Track[] = Array.from({ length: trackCount }, (_, i) => ({
    id: `track-${i + 1}`,
    sampleId: null,
    name: `Track ${String(i + 1).padStart(2, "0")}`,
  }));
  return { tempo, beatsPerBar, bars, tracks, notes: {} };
}

export function clampTempo(tempo: number): number {
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(tempo)));
}

export function setTempo(state: SequencerState, tempo: number): SequencerState {
  return { ...state, tempo: clampTempo(tempo) };
}

export function assignSample(
  state: SequencerState,
  trackId: TrackId,
  sampleId: number,
  name: string,
): SequencerState {
  return {
    ...state,
    tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, sampleId, name } : t)),
  };
}

/** The open beat range a note on `trackId` may occupy without overlapping a neighbor,
 * given the neighbors currently on that track (excluding `excludeNoteId`, if resizing/
 * moving an existing note). Keeps the grid's overlap-free invariant without a general
 * constraint solver: a note simply cannot extend past the next note's start or before the
 * previous note's end. */
function openRange(
  state: SequencerState,
  trackId: TrackId,
  excludeNoteId: NoteId | null,
): { min: number; max: number }[] {
  const neighbors = notesForTrack(state, trackId).filter((n) => n.id !== excludeNoteId);
  const bounds: { min: number; max: number }[] = [];
  let cursor = 0;
  for (const n of neighbors) {
    bounds.push({ min: cursor, max: n.start });
    cursor = n.start + n.duration;
  }
  bounds.push({ min: cursor, max: totalBeats(state) });
  return bounds;
}

/** True if [start, start+duration) fits inside one of the track's currently-open gaps. */
export function fitsWithoutOverlap(
  state: SequencerState,
  trackId: TrackId,
  start: number,
  duration: number,
  excludeNoteId: NoteId | null = null,
): boolean {
  const end = start + duration;
  return openRange(state, trackId, excludeNoteId).some((r) => start >= r.min && end <= r.max);
}

export function addNote(
  state: SequencerState,
  trackId: TrackId,
  start: number,
  duration: number = DEFAULT_NOTE_DURATION,
  velocity: number = DEFAULT_VELOCITY,
): SequencerState {
  const clampedStart = Math.max(0, Math.min(Math.round(start), totalBeats(state) - 1));
  if (!fitsWithoutOverlap(state, trackId, clampedStart, duration)) return state;
  const id = nextId("note");
  const note: Note = { id, trackId, start: clampedStart, duration, velocity };
  return { ...state, notes: { ...state.notes, [id]: note } };
}

export function removeNote(state: SequencerState, noteId: NoteId): SequencerState {
  if (!(noteId in state.notes)) return state;
  const notes = { ...state.notes };
  delete notes[noteId];
  return { ...state, notes };
}

/** Resizes a note's duration (dragging its right edge), clamped to at least
 * MIN_NOTE_DURATION beat and to whatever room the next note/loop end leaves open. */
export function resizeNote(state: SequencerState, noteId: NoteId, newDuration: number): SequencerState {
  const note = state.notes[noteId];
  if (!note) return state;
  const rounded = Math.max(MIN_NOTE_DURATION, Math.round(newDuration));
  const ranges = openRange(state, note.trackId, note.id);
  const containing = ranges.find((r) => note.start >= r.min && note.start < r.max);
  const maxDuration = containing ? containing.max - note.start : rounded;
  const clamped = Math.min(rounded, Math.max(MIN_NOTE_DURATION, maxDuration));
  return { ...state, notes: { ...state.notes, [noteId]: { ...note, duration: clamped } } };
}

/** Moves a note to a new start position (dragging its body), clamped within the pattern
 * and to not overlap its neighbors. */
export function moveNote(state: SequencerState, noteId: NoteId, newStart: number): SequencerState {
  const note = state.notes[noteId];
  if (!note) return state;
  const rounded = Math.round(newStart);
  const ranges = openRange(state, note.trackId, note.id);
  let best = note.start;
  let bestDistance = Infinity;
  for (const r of ranges) {
    const lo = r.min;
    const hi = r.max - note.duration;
    if (hi < lo) continue;
    const candidate = Math.min(hi, Math.max(lo, rounded));
    const distance = Math.abs(candidate - rounded);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return { ...state, notes: { ...state.notes, [noteId]: { ...note, start: best } } };
}

export function setVelocity(state: SequencerState, noteId: NoteId, velocity: number): SequencerState {
  const note = state.notes[noteId];
  if (!note) return state;
  const clamped = Math.min(1, Math.max(0, velocity));
  return { ...state, notes: { ...state.notes, [noteId]: { ...note, velocity: clamped } } };
}

/** Changes the loop length in bars. Notes that would fall outside the new, shorter loop
 * are dropped; nothing else about the model changes shape — see SequencerState.bars. */
export function setBars(state: SequencerState, bars: number): SequencerState {
  const clampedBars = Math.max(1, Math.round(bars));
  const newTotal = clampedBars * state.beatsPerBar;
  const notes: SequencerState["notes"] = {};
  for (const [id, note] of Object.entries(state.notes)) {
    if (note.start < newTotal) notes[id] = note;
  }
  return { ...state, bars: clampedBars, notes };
}
