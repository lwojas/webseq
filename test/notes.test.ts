import { describe, expect, it } from "vitest";
import { addNote, moveNote, removeNote, resizeNote, setBars } from "../src/model/notes";
import { notesForTrack, totalBeats, type Pattern } from "../src/model/types";

const BEATS_PER_BAR = 16;

function emptyPattern(bars = 1): Pattern {
  return { id: "pattern-1", name: "Pattern A", bars, notes: {} };
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
});
