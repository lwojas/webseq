// Pure note CRUD over a single Pattern. Everything here takes a Pattern (+ the project's
// beatsPerBar, needed only to clamp against the pattern's total beat count) and returns a new
// Pattern — no React, no webdsp, no notion of "which pattern is currently selected" (that's
// app/UI state, see App.tsx). This is the direct descendant of the original single-pattern
// prototype's pattern.ts, generalized to operate on one Pattern among many rather than the
// entire sequencer state.

import type { Note, NoteId, Pattern, TrackId } from "./types";
import { notesForTrack, totalBeats } from "./types";

/** Snap resolutions a user can pick in the toolbar, in steps (a step = one 16th note — see
 * Project.beatsPerBar). Power-of-two fractions only, so quantizing to any of them and back is
 * exactly representable in IEEE doubles and never introduces float-fuzz into the overlap
 * comparisons in `openRange`/`fitsWithoutOverlap`. */
export type GridResolution = 1 | 0.5 | 0.25 | 0.125;
export const GRID_RESOLUTIONS: GridResolution[] = [1, 0.5, 0.25, 0.125];
export const DEFAULT_GRID_RESOLUTION: GridResolution = 1;

/** Fixed quantization applied when Alt/Option overrides musical-grid snapping for free
 * placement. Fine enough to feel continuous while still a power-of-two fraction of a step, so
 * free-placed notes never carry raw pixel-derived floats into the model (see
 * quantizeToResolution). */
export const FREE_PLACEMENT_RESOLUTION = 1 / 64;

export const MIN_NOTE_DURATION = FREE_PLACEMENT_RESOLUTION;
export const DEFAULT_NOTE_DURATION = 1;
export const DEFAULT_VELOCITY = 1;

/** Snaps `value` (beats) to the nearest multiple of `resolution` (also beats). The one place
 * addNote/resizeNote/moveNote quantize a proposed position — see their call sites below. */
export function quantizeToResolution(value: number, resolution: number): number {
  return Math.round(value / resolution) * resolution;
}

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
  const clampedStart = Math.max(
    0,
    Math.min(quantizeToResolution(start, DEFAULT_GRID_RESOLUTION), totalBeats(pattern, beatsPerBar) - 1),
  );
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

/** Deliberate whole-track clear (ECS-107): removes every note belonging to `trackId` in this
 * one Pattern only — other tracks, other patterns, assets and track configuration are untouched
 * by design (see App.tsx's keydown handler and TrackRow's header button, the only two call
 * sites, which both require an explicit track selection first). Identity-preserving when the
 * track already has no notes here, same as removeNote above. */
export function clearTrackNotes(pattern: Pattern, trackId: TrackId): Pattern {
  if (notesForTrack(pattern, trackId).length === 0) return pattern;
  const notes: Pattern["notes"] = {};
  for (const [id, note] of Object.entries(pattern.notes)) {
    if (note.trackId !== trackId) notes[id] = note;
  }
  return { ...pattern, notes };
}

/** The clipboard contract (ECS-112): a copied note is just its own shape minus `id`/`trackId` —
 * self-contained plain data, not a reference into any project/pattern, so it survives the
 * source track/pattern/project changing or disappearing before paste. `start` stays absolute
 * (beats from this pattern's start), not relative to some anchor — there is no "paste cursor"
 * concept in this app (no selected empty cell, only a selected track), so pasting reproduces
 * the exact beat positions that were copied, just under the destination trackId. */
export type CopiedNote = Pick<Note, "start" | "duration" | "velocity">;

/** Pastes `copied` onto `trackId` in this Pattern, preserving each note's original start/
 * duration/velocity exactly (no re-quantization — unlike addNote, these values already came
 * from valid notes). Each note is placed independently and in order, so later notes in the
 * batch see earlier ones just pasted; a note that doesn't fit (collides with an existing note,
 * or — for a shorter destination pattern — runs past its end) is silently skipped rather than
 * replacing/truncating anything, the same non-destructive refusal addNote already applies to a
 * single placement. There is no undo, so skipping is the only safe response to a collision. */
export function pasteNotes(
  pattern: Pattern,
  beatsPerBar: number,
  trackId: TrackId,
  copied: CopiedNote[],
): { pattern: Pattern; pasted: number; skipped: number } {
  let next = pattern;
  let pasted = 0;
  let skipped = 0;
  for (const c of copied) {
    if (!fitsWithoutOverlap(next, beatsPerBar, trackId, c.start, c.duration)) {
      skipped += 1;
      continue;
    }
    const id = nextId("note");
    const note: Note = { id, trackId, start: c.start, duration: c.duration, velocity: c.velocity };
    next = { ...next, notes: { ...next.notes, [id]: note } };
    pasted += 1;
  }
  return { pattern: next, pasted, skipped };
}

/** Resizes a note's duration (dragging its right edge), snapped to `resolution` (a toolbar
 * grid resolution, or FREE_PLACEMENT_RESOLUTION while Alt/Option overrides snapping — see
 * NoteBlock/App.tsx), clamped to at least MIN_NOTE_DURATION beat and to whatever room the
 * next note/loop end leaves open. */
export function resizeNote(
  pattern: Pattern,
  beatsPerBar: number,
  noteId: NoteId,
  newDuration: number,
  resolution: number = DEFAULT_GRID_RESOLUTION,
): Pattern {
  const note = pattern.notes[noteId];
  if (!note) return pattern;
  const quantized = Math.max(MIN_NOTE_DURATION, quantizeToResolution(newDuration, resolution));
  const ranges = openRange(pattern, beatsPerBar, note.trackId, note.id);
  const containing = ranges.find((r) => note.start >= r.min && note.start < r.max);
  const maxDuration = containing ? containing.max - note.start : quantized;
  const clamped = Math.min(quantized, Math.max(MIN_NOTE_DURATION, maxDuration));
  return { ...pattern, notes: { ...pattern.notes, [noteId]: { ...note, duration: clamped } } };
}

/** Moves a note to a new start position (dragging its body), snapped to `resolution` (see
 * resizeNote's doc comment), clamped within the pattern and to not overlap its neighbors. */
export function moveNote(
  pattern: Pattern,
  beatsPerBar: number,
  noteId: NoteId,
  newStart: number,
  resolution: number = DEFAULT_GRID_RESOLUTION,
): Pattern {
  const note = pattern.notes[noteId];
  if (!note) return pattern;
  const quantized = quantizeToResolution(newStart, resolution);
  const ranges = openRange(pattern, beatsPerBar, note.trackId, note.id);
  let best = note.start;
  let bestDistance = Infinity;
  for (const r of ranges) {
    const lo = r.min;
    const hi = r.max - note.duration;
    if (hi < lo) continue;
    const candidate = Math.min(hi, Math.max(lo, quantized));
    const distance = Math.abs(candidate - quantized);
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
