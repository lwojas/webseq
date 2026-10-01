import { describe, expect, it } from "vitest";
import {
  addNote,
  fitsWithoutOverlap,
  FREE_PLACEMENT_RESOLUTION,
  moveNote,
  quantizeToResolution,
  removeNote,
  resizeNote,
  setBars,
} from "../src/model/notes";
import { notesForTrack, totalBeats, type Note, type Pattern } from "../src/model/types";

const BEATS_PER_BAR = 16;

function emptyPattern(bars = 1): Pattern {
  return { id: "pattern-1", name: "Pattern A", bars, notes: {} };
}

/** Builds a pattern with exactly these notes, bypassing addNote's own whole-step start
 * snapping — used to set up fixtures at fractional (sub-step) positions that only arise via
 * moveNote/resizeNote in the real app (see the micro-timing describe blocks below). */
function patternWithNotes(bars: number, notes: Note[]): Pattern {
  const record: Pattern["notes"] = {};
  for (const n of notes) record[n.id] = n;
  return { id: "pattern-1", name: "Pattern A", bars, notes: record };
}

describe("note operations over a single pattern", () => {
  it("adds a note at the requested start position with the default duration", () => {
    const pattern = addNote(emptyPattern(), BEATS_PER_BAR, "track-1", 4);
    const notes = notesForTrack(pattern, "track-1");
    expect(notes).toHaveLength(1);
    expect(notes[0].start).toBe(4);
    expect(notes[0].duration).toBe(1);
  });

  it("removes a note", () => {
    let pattern = addNote(emptyPattern(), BEATS_PER_BAR, "track-1", 0);
    const noteId = notesForTrack(pattern, "track-1")[0].id;
    pattern = removeNote(pattern, noteId);
    expect(notesForTrack(pattern, "track-1")).toHaveLength(0);
  });

  it("supports multiple notes on one track", () => {
    let pattern = emptyPattern();
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 0);
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 4);
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 8);
    expect(notesForTrack(pattern, "track-1").map((n) => n.start)).toEqual([0, 4, 8]);
  });

  it("supports independent notes across multiple tracks", () => {
    let pattern = emptyPattern();
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 0);
    pattern = addNote(pattern, BEATS_PER_BAR, "track-2", 0);
    expect(notesForTrack(pattern, "track-1")).toHaveLength(1);
    expect(notesForTrack(pattern, "track-2")).toHaveLength(1);
    expect(notesForTrack(pattern, "track-1")[0].id).not.toBe(notesForTrack(pattern, "track-2")[0].id);
  });

  it("resizes a note's duration", () => {
    let pattern = addNote(emptyPattern(), BEATS_PER_BAR, "track-1", 0, 1);
    const noteId = notesForTrack(pattern, "track-1")[0].id;
    pattern = resizeNote(pattern, BEATS_PER_BAR, noteId, 4);
    expect(pattern.notes[noteId].duration).toBe(4);
  });

  it("clamps a resize so it cannot overlap the next note on the same track", () => {
    let pattern = emptyPattern();
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 0, 1);
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 4, 1);
    const firstId = notesForTrack(pattern, "track-1")[0].id;
    pattern = resizeNote(pattern, BEATS_PER_BAR, firstId, 10);
    expect(pattern.notes[firstId].duration).toBe(4);
  });

  it("moves a note to a new start position", () => {
    let pattern = addNote(emptyPattern(), BEATS_PER_BAR, "track-1", 0);
    const noteId = notesForTrack(pattern, "track-1")[0].id;
    pattern = moveNote(pattern, BEATS_PER_BAR, noteId, 6);
    expect(pattern.notes[noteId].start).toBe(6);
  });

  it("does not let a moved note overlap a neighbor", () => {
    let pattern = emptyPattern();
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 0, 2);
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 4, 2);
    const firstId = notesForTrack(pattern, "track-1")[0].id;
    pattern = moveNote(pattern, BEATS_PER_BAR, firstId, 3);
    expect(pattern.notes[firstId].start).toBeLessThanOrEqual(2);
  });

  it("refuses to add a note that would overlap an existing one", () => {
    let pattern = emptyPattern();
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 0, 4);
    const before = notesForTrack(pattern, "track-1").length;
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 2, 1);
    expect(notesForTrack(pattern, "track-1")).toHaveLength(before);
  });

  it("supports patterns of different bar lengths", () => {
    const oneBar = emptyPattern(1);
    const fourBars = emptyPattern(4);
    expect(totalBeats(oneBar, BEATS_PER_BAR)).toBe(16);
    expect(totalBeats(fourBars, BEATS_PER_BAR)).toBe(64);
  });

  it("changing bars drops notes that fall outside the new, shorter length", () => {
    let pattern = emptyPattern(4); // 64 beats
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 0);
    pattern = addNote(pattern, BEATS_PER_BAR, "track-1", 20);
    pattern = setBars(pattern, BEATS_PER_BAR, 1); // 16 beats
    expect(notesForTrack(pattern, "track-1").map((n) => n.start)).toEqual([0]);
  });

  it("tap-to-add always snaps to a whole step, independent of any drag/resize resolution", () => {
    const pattern = addNote(emptyPattern(), BEATS_PER_BAR, "track-1", 4.3);
    expect(notesForTrack(pattern, "track-1")[0].start).toBe(4);
  });
});

describe("quantizeToResolution", () => {
  it("snaps to the nearest whole step at resolution 1 (preserves pre-ECS-52 Math.round behavior)", () => {
    expect(quantizeToResolution(4.3, 1)).toBe(4);
    expect(quantizeToResolution(4.6, 1)).toBe(5);
  });

  it("snaps to the nearest 1/2, 1/4 and 1/8 step at those resolutions", () => {
    expect(quantizeToResolution(4.3, 0.5)).toBe(4.5);
    expect(quantizeToResolution(4.3, 0.25)).toBe(4.25);
    expect(quantizeToResolution(4.3, 0.125)).toBe(4.25);
  });

  it("snaps to the fine free-placement resolution without float fuzz", () => {
    const snapped = quantizeToResolution(4.301, FREE_PLACEMENT_RESOLUTION);
    expect(snapped).toBeCloseTo(4.296875, 10); // 275/64
    // Power-of-two resolutions round-trip exactly — no float-fuzz residue.
    expect(snapped * 64).toBe(Math.round(snapped * 64));
  });
});

describe("micro-timing: grid-resolution snapping and modifier-key override", () => {
  it("moveNote snaps to the selected musical-grid resolution instead of a whole step", () => {
    let pattern = addNote(emptyPattern(4), BEATS_PER_BAR, "track-1", 0);
    const noteId = notesForTrack(pattern, "track-1")[0].id;
    pattern = moveNote(pattern, BEATS_PER_BAR, noteId, 4.3, 0.25);
    expect(pattern.notes[noteId].start).toBe(4.25);
  });

  it("resizeNote snaps duration to the selected musical-grid resolution", () => {
    let pattern = addNote(emptyPattern(4), BEATS_PER_BAR, "track-1", 0, 1);
    const noteId = notesForTrack(pattern, "track-1")[0].id;
    pattern = resizeNote(pattern, BEATS_PER_BAR, noteId, 2.6, 0.5);
    expect(pattern.notes[noteId].duration).toBe(2.5);
  });

  it("defaults to whole-step snapping when no resolution is given (preserves existing behavior)", () => {
    let pattern = addNote(emptyPattern(4), BEATS_PER_BAR, "track-1", 0);
    const noteId = notesForTrack(pattern, "track-1")[0].id;
    pattern = moveNote(pattern, BEATS_PER_BAR, noteId, 4.3);
    expect(pattern.notes[noteId].start).toBe(4);
  });

  it("moveNote under the free-placement (Alt/Option) resolution lands on a fine sub-step position", () => {
    let pattern = addNote(emptyPattern(4), BEATS_PER_BAR, "track-1", 0);
    const noteId = notesForTrack(pattern, "track-1")[0].id;
    pattern = moveNote(pattern, BEATS_PER_BAR, noteId, 4.301, FREE_PLACEMENT_RESOLUTION);
    expect(pattern.notes[noteId].start).toBeCloseTo(4.296875, 10); // 275/64
  });

  it("resizeNote under free placement can produce a sub-step duration below the old 1-step minimum", () => {
    let pattern = addNote(emptyPattern(4), BEATS_PER_BAR, "track-1", 0, 1);
    const noteId = notesForTrack(pattern, "track-1")[0].id;
    pattern = resizeNote(pattern, BEATS_PER_BAR, noteId, 0.1, FREE_PLACEMENT_RESOLUTION);
    expect(pattern.notes[noteId].duration).toBeCloseTo(0.09375, 10); // 6/64
    expect(pattern.notes[noteId].duration).toBeGreaterThan(0);
  });

  it("never produces a non-positive duration, even when resizing far below the free-placement resolution", () => {
    let pattern = addNote(emptyPattern(4), BEATS_PER_BAR, "track-1", 0, 1);
    const noteId = notesForTrack(pattern, "track-1")[0].id;
    pattern = resizeNote(pattern, BEATS_PER_BAR, noteId, -5, FREE_PLACEMENT_RESOLUTION);
    expect(pattern.notes[noteId].duration).toBeGreaterThan(0);
  });
});

describe("micro-timing: fractional overlap boundaries", () => {
  it("fits a note flush against a fractional neighbor boundary, with no float-fuzz gap required", () => {
    const pattern = patternWithNotes(4, [{ id: "n1", trackId: "track-1", start: 2.25, duration: 0.25, velocity: 1 }]);
    expect(fitsWithoutOverlap(pattern, BEATS_PER_BAR, "track-1", 0, 2.25)).toBe(true); // ends exactly at the neighbor's start
    expect(fitsWithoutOverlap(pattern, BEATS_PER_BAR, "track-1", 0, 2.2501)).toBe(false); // overlaps by a hair
  });

  it("clamps a resize to a neighbor's fractional start rather than overlapping it", () => {
    const pattern = patternWithNotes(4, [
      { id: "n1", trackId: "track-1", start: 0, duration: 1, velocity: 1 },
      { id: "n2", trackId: "track-1", start: 2.25, duration: 0.25, velocity: 1 },
    ]);
    const resized = resizeNote(pattern, BEATS_PER_BAR, "n1", 10, FREE_PLACEMENT_RESOLUTION);
    expect(resized.notes["n1"].duration).toBe(2.25);
  });

  it("clamps a move so a fine-resolution note cannot cross into a neighbor's fractional range", () => {
    const pattern = patternWithNotes(4, [
      { id: "n1", trackId: "track-1", start: 0, duration: 1, velocity: 1 },
      { id: "n2", trackId: "track-1", start: 2.25, duration: 0.25, velocity: 1 },
    ]);
    const moved = moveNote(pattern, BEATS_PER_BAR, "n1", 1.26, FREE_PLACEMENT_RESOLUTION);
    expect(moved.notes["n1"].start).toBe(1.25); // clamped: 2.25 - its own 1-beat duration
  });

  it("keeps overlap checks exact at power-of-two sub-step boundaries (no float-fuzz false negatives)", () => {
    // Every boundary below is a multiple of 1/64, the finest supported resolution.
    const pattern = patternWithNotes(4, [{ id: "n1", trackId: "track-1", start: 0, duration: 0.125, velocity: 1 }]);
    expect(fitsWithoutOverlap(pattern, BEATS_PER_BAR, "track-1", 0.125, 0.125)).toBe(true);
    expect(fitsWithoutOverlap(pattern, BEATS_PER_BAR, "track-1", 0.1249, 0.125)).toBe(false);
  });
});
