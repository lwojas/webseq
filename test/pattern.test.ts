import { describe, expect, it } from "vitest";
import { createInitialState, addNote, removeNote, resizeNote, moveNote, setTempo, assignSample } from "../src/model/pattern";
import { notesForTrack, totalBeats } from "../src/model/types";

describe("sequencer model", () => {
  it("creates 16 tracks and a 16-beat, 1-bar pattern by default", () => {
    const state = createInitialState();
    expect(state.tracks).toHaveLength(16);
    expect(state.beatsPerBar).toBe(16);
    expect(state.bars).toBe(1);
    expect(totalBeats(state)).toBe(16);
  });

  it("adds a note at the requested start position with the default duration", () => {
    const state = addNote(createInitialState(), "track-1", 4);
    const notes = notesForTrack(state, "track-1");
    expect(notes).toHaveLength(1);
    expect(notes[0].start).toBe(4);
    expect(notes[0].duration).toBe(1);
  });

  it("removes a note", () => {
    let state = addNote(createInitialState(), "track-1", 0);
    const noteId = notesForTrack(state, "track-1")[0].id;
    state = removeNote(state, noteId);
    expect(notesForTrack(state, "track-1")).toHaveLength(0);
  });

  it("supports multiple notes on one track", () => {
    let state = createInitialState();
    state = addNote(state, "track-1", 0);
    state = addNote(state, "track-1", 4);
    state = addNote(state, "track-1", 8);
    const notes = notesForTrack(state, "track-1");
    expect(notes.map((n) => n.start)).toEqual([0, 4, 8]);
  });

  it("supports independent notes across multiple tracks", () => {
    let state = createInitialState();
    state = addNote(state, "track-1", 0);
    state = addNote(state, "track-2", 0);
    expect(notesForTrack(state, "track-1")).toHaveLength(1);
    expect(notesForTrack(state, "track-2")).toHaveLength(1);
    expect(notesForTrack(state, "track-1")[0].id).not.toBe(notesForTrack(state, "track-2")[0].id);
  });

  it("supports notes with different durations on the same track", () => {
    let state = createInitialState();
    state = addNote(state, "track-1", 0, 2);
    state = addNote(state, "track-1", 4, 4);
    const notes = notesForTrack(state, "track-1");
    expect(notes.map((n) => n.duration)).toEqual([2, 4]);
  });

  it("resizes a note's duration", () => {
    let state = addNote(createInitialState(), "track-1", 0, 1);
    const noteId = notesForTrack(state, "track-1")[0].id;
    state = resizeNote(state, noteId, 4);
    expect(state.notes[noteId].duration).toBe(4);
  });

  it("clamps a resize so it cannot overlap the next note on the same track", () => {
    let state = createInitialState();
    state = addNote(state, "track-1", 0, 1);
    state = addNote(state, "track-1", 4, 1);
    const firstId = notesForTrack(state, "track-1")[0].id;
    state = resizeNote(state, firstId, 10); // would reach beat 10, but the next note starts at 4
    expect(state.notes[firstId].duration).toBe(4);
  });

  it("clamps a resize to at least one beat", () => {
    let state = addNote(createInitialState(), "track-1", 0, 3);
    const noteId = notesForTrack(state, "track-1")[0].id;
    state = resizeNote(state, noteId, 0);
    expect(state.notes[noteId].duration).toBe(1);
  });

  it("moves a note to a new start position", () => {
    let state = addNote(createInitialState(), "track-1", 0);
    const noteId = notesForTrack(state, "track-1")[0].id;
    state = moveNote(state, noteId, 6);
    expect(state.notes[noteId].start).toBe(6);
  });

  it("does not let a moved note overlap a neighbor", () => {
    let state = createInitialState();
    state = addNote(state, "track-1", 0, 2);
    state = addNote(state, "track-1", 4, 2);
    const firstId = notesForTrack(state, "track-1")[0].id;
    state = moveNote(state, firstId, 3); // would overlap [4,6)
    expect(state.notes[firstId].start).toBeLessThanOrEqual(2);
  });

  it("refuses to add a note that would overlap an existing one", () => {
    let state = createInitialState();
    state = addNote(state, "track-1", 0, 4);
    const before = notesForTrack(state, "track-1").length;
    state = addNote(state, "track-1", 2, 1); // inside [0,4)
    expect(notesForTrack(state, "track-1")).toHaveLength(before);
  });

  it("clamps tempo to the 40-240 BPM range", () => {
    let state = setTempo(createInitialState(), 999);
    expect(state.tempo).toBe(240);
    state = setTempo(state, -10);
    expect(state.tempo).toBe(40);
  });

  it("changes tempo", () => {
    const state = setTempo(createInitialState(), 90);
    expect(state.tempo).toBe(90);
  });

  it("assigns a sample to a track", () => {
    const state = assignSample(createInitialState(), "track-3", 42, "kick.wav");
    const track = state.tracks.find((t) => t.id === "track-3")!;
    expect(track.sampleId).toBe(42);
    expect(track.name).toBe("kick.wav");
  });
});
