// Pure note CRUD over a single Pattern. Everything here takes a Pattern (+ the project's
// beatsPerBar, needed only to clamp against the pattern's total beat count) and returns a new
// Pattern — no React, no webdsp, no notion of "which pattern is currently selected" (that's
// app/UI state, see App.tsx). This is the direct descendant of the original single-pattern
// prototype's pattern.ts, generalized to operate on one Pattern among many rather than the
// entire sequencer state.

import type { Note, NoteId, Pattern, TrackId } from "./types";
import { notesForTrack, totalBeats } from "./types";

export const MIN_NOTE_DURATION = 1;
export const DEFAULT_NOTE_DURATION = 1;
export const DEFAULT_VELOCITY = 1;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The open beat range a note on `trackId` may occupy without overlapping a neighbor, given
 * the neighbors currently on that track (excluding `excludeNoteId`, if resizing/moving an
 * existing note). Keeps the grid's overlap-free invariant without a general constraint
 * solver: a note simply cannot extend past the next note's start or before the previous
 * note's end. */
function openRange(
  pattern: Pattern,
  beatsPerBar: number,
  trackId: TrackId,
  excludeNoteId: NoteId | null,
): { min: number; max: number }[] {
  const neighbors = notesForTrack(pattern, trackId).filter((n) => n.id !== excludeNoteId);
  const bounds: { min: number; max: number }[] = [];
  let cursor = 0;
  for (const n of neighbors) {
    bounds.push({ min: cursor, max: n.start });
    cursor = n.start + n.duration;
  }
  bounds.push({ min: cursor, max: totalBeats(pattern, beatsPerBar) });
  return bounds;
}

/** True if [start, start+duration) fits inside one of the track's currently-open gaps. */
export function fitsWithoutOverlap(
  pattern: Pattern,
  beatsPerBar: number,
  trackId: TrackId,
  start: number,
  duration: number,
  excludeNoteId: NoteId | null = null,
): boolean {
  const end = start + duration;
  return openRange(pattern, beatsPerBar, trackId, excludeNoteId).some((r) => start >= r.min && end <= r.max);
}

export function addNote(
  pattern: Pattern,
  beatsPerBar: number,
  trackId: TrackId,
  start: number,
  duration: number = DEFAULT_NOTE_DURATION,
  velocity: number = DEFAULT_VELOCITY,
): Pattern {
  const clampedStart = Math.max(0, Math.min(Math.round(start), totalBeats(pattern, beatsPerBar) - 1));
  if (!fitsWithoutOverlap(pattern, beatsPerBar, trackId, clampedStart, duration)) return pattern;
  const id = nextId("note");
  const note: Note = { id, trackId, start: clampedStart, duration, velocity };
  return { ...pattern, notes: { ...pattern.notes, [id]: note } };
}

export function removeNote(pattern: Pattern, noteId: NoteId): Pattern {
  if (!(noteId in pattern.notes)) return pattern;
  const notes = { ...pattern.notes };
  delete notes[noteId];
  return { ...pattern, notes };
}

/** Resizes a note's duration (dragging its right edge), clamped to at least
 * MIN_NOTE_DURATION beat and to whatever room the next note/loop end leaves open. */
export function resizeNote(pattern: Pattern, beatsPerBar: number, noteId: NoteId, newDuration: number): Pattern {
  const note = pattern.notes[noteId];
  if (!note) return pattern;
  const rounded = Math.max(MIN_NOTE_DURATION, Math.round(newDuration));
  const ranges = openRange(pattern, beatsPerBar, note.trackId, note.id);
  const containing = ranges.find((r) => note.start >= r.min && note.start < r.max);
  const maxDuration = containing ? containing.max - note.start : rounded;
  const clamped = Math.min(rounded, Math.max(MIN_NOTE_DURATION, maxDuration));
  return { ...pattern, notes: { ...pattern.notes, [noteId]: { ...note, duration: clamped } } };
}

/** Moves a note to a new start position (dragging its body), clamped within the pattern and
 * to not overlap its neighbors. */
export function moveNote(pattern: Pattern, beatsPerBar: number, noteId: NoteId, newStart: number): Pattern {
  const note = pattern.notes[noteId];
  if (!note) return pattern;
  const rounded = Math.round(newStart);
  const ranges = openRange(pattern, beatsPerBar, note.trackId, note.id);
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
  return { ...pattern, notes: { ...pattern.notes, [noteId]: { ...note, start: best } } };
}

export function setVelocity(pattern: Pattern, noteId: NoteId, velocity: number): Pattern {
  const note = pattern.notes[noteId];
  if (!note) return pattern;
  const clamped = Math.min(1, Math.max(0, velocity));
  return { ...pattern, notes: { ...pattern.notes, [noteId]: { ...note, velocity: clamped } } };
}

/** Changes the loop length in bars. Notes that would fall outside the new, shorter pattern
 * are dropped; nothing else about the model changes shape. */
export function setBars(pattern: Pattern, beatsPerBar: number, bars: number): Pattern {
  const clampedBars = Math.max(1, Math.round(bars));
  const newTotal = clampedBars * beatsPerBar;
  const notes: Pattern["notes"] = {};
  for (const [id, note] of Object.entries(pattern.notes)) {
    if (note.start < newTotal) notes[id] = note;
  }
  return { ...pattern, bars: clampedBars, notes };
}
